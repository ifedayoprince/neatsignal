import { length } from "zod";
import { EMPTY_RESP_THRESHOLD, MAX_TOOL_LOOP_DOOM, NAIVE_SIM_THRESHOLD, NEGATIVE_SIGNALS, PENALTY_TOOL_EMPTY_RESP, POSITIVE_SIGNALS, PREV_PROMPT_WINDOW, SUSPICIOUSLY_SHORT_PROMPT, TOOL_CONSEC_THRESHOLD, TOOL_WINDOW_SIZE } from "./constants.js";
import type { JournalEntry } from "./friction.type.js";
import type { MessageEntry, ToolCall } from "./trace.type.js";
import { checkToolArgsSimilarity, countMatches, countWords, isEmptyToolCall, percent } from "./utils.js";

export class FrictionMonitor {
  private maxFriction: number = 0;
  private calculatedFriction: number = 0;

  private journal: JournalEntry[] = [];
  private toolMap = new Map<string, { count: number, emptyOutputs: number, calls: ToolCall[] }>();
  private userPromptCache: string[] = [];

  constructor(
    public readonly messages: MessageEntry[]
  ) { }

  getMessage(idx: number) {
    if (idx < 0 || idx > this.messages.length) return null;
    return this.messages[idx];
  }

  scan() {
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];

      // Heuristic 1 & 2
      this.handleToolCall(message!, i);

      // Heuristic 3. Flag sudden reduction in user prompt length.
      this.handleUserPromptReduction(message!, i);

      // Heuristic 4. Flag sudden rise in user prompt length.
       
    }
  }

  handleUserPromptReduction(message: MessageEntry, idx: number) {
    if (message?.role != "user" || !message.content
      || countWords(message.content) > SUSPICIOUSLY_SHORT_PROMPT) return;

    const averageLength = this.userPromptCache.reduce((acc, p) => acc + countWords(p), 0) / this.userPromptCache.length;

    // 3.1 - Average prompt length is usually longer
    const currentLength = countWords(message.content);
    const factor = averageLength / currentLength;
    if (factor > 2) {
      const delta = 10;
      this.addJournal({
        msgIdx: idx,
        calculatedDelta: factor * delta,
        maxDelta: delta,
        includeContent: true,
        note: `\nUser prompts are usually ${percent(factor)} longer than current prompt length. Current length ${currentLength} words.`
      });
    }

    // 3.2 - Count negative keyword triggers
    const negativeTriggers = countMatches(message.content, NEGATIVE_SIGNALS);
    if (negativeTriggers.length > 1) {
      const deltaPerTrigger = 2;
      this.addJournal({
        msgIdx: idx,
        includeContent: true,
        calculatedDelta: deltaPerTrigger * negativeTriggers.length,
        maxDelta: deltaPerTrigger * negativeTriggers.length,
        note: `User prompt has ${negativeTriggers.length} negative trigger matches. (Matches: ${negativeTriggers.join(', ')})`
      });
    }

    // 3.3 - Count positive keyword triggers/ 
    // Increase maxDelta without increasing calculatedDelta to bring down the overall friction score.
    const positiveTriggers = countMatches(message.content, POSITIVE_SIGNALS);
    if (positiveTriggers.length > 1) {
      const deltaPerTrigger = 3;
      this.addJournal({
        msgIdx: idx,
        calculatedDelta: 0,
        includeContent: true,
        maxDelta: deltaPerTrigger * positiveTriggers.length,
        note: `User prompt has ${positiveTriggers.length} positive trigger matches. (Matches: ${positiveTriggers.join(', ')})`
      });
    }

    this.cacheUserPrompt(message.content);
  }
  handleToolCall(message: MessageEntry, idx: number) {
    if (message?.role != "tool" || !message.tool_call) return;

    // Stop watching tools that have passed the gap window
    const prevTool = this.getMessage(idx - TOOL_WINDOW_SIZE);
    if (prevTool?.role == "tool" && prevTool?.tool_call?.name)
      this.toolMap.delete(prevTool?.tool_call?.name)

    // Watch this tool and increment it's counter
    let entry = this.toolMap.get(message.tool_call?.name);
    if (!entry)
      entry = {
        count: 0,
        emptyOutputs: 0,
        calls: []
      };

    const isEmpty = isEmptyToolCall(message.tool_call);
    entry = {
      count: entry.count + 1,
      emptyOutputs: entry.emptyOutputs + (isEmpty ? 1 : 0),
      calls: [...entry.calls, message.tool_call]
    };

    this.toolMap.set(message.tool_call?.name, entry);

    // Heuristic 1. Flag tools being repeatedly called.
    if (entry.count > TOOL_CONSEC_THRESHOLD) {
      const similarity = checkToolArgsSimilarity(entry.calls);
      if (similarity > NAIVE_SIM_THRESHOLD) {
        this.addJournal({
          msgIdx: idx,
          calculatedDelta: similarity * MAX_TOOL_LOOP_DOOM,
          maxDelta: MAX_TOOL_LOOP_DOOM,
          note: `
Tool ${message.tool_call.name} has repeated tool calls with similar args (~${(similarity * 100).toFixed(2)}%)
${entry.calls.map((call, idx) => `Call ${idx} has args ${JSON.stringify(call?.params)}`)}
`.trim()
        });
        this.toolMap.delete(message.tool_call.name);
      }
    }

    // Heuristic 2. Flag tools returning empty responses.
    const emptyOutputCalls = entry.calls.filter(call => isEmptyToolCall(call!));
    const emptyThreshold = emptyOutputCalls.length / entry.calls.length;
    if (emptyThreshold > EMPTY_RESP_THRESHOLD) {
      this.addJournal({
        msgIdx: idx,
        calculatedDelta: emptyThreshold * PENALTY_TOOL_EMPTY_RESP,
        maxDelta: PENALTY_TOOL_EMPTY_RESP,
        note: `
Tool ${message.tool_call.name} has repeated tool calls with empty responses (~${(emptyThreshold * 100).toFixed(2)}%)
${entry.calls.map((call, idx) => `Call ${idx} has args ${JSON.stringify(call?.params)}`)}
`.trim()
      });
    }
  }

  cacheUserPrompt(prompt: string) {
    this.userPromptCache = [...this.userPromptCache, prompt];
    if (this.userPromptCache.length > PREV_PROMPT_WINDOW)
      this.userPromptCache = this.userPromptCache.slice(-1 * PREV_PROMPT_WINDOW);
  }
  addJournal(entry: JournalEntry) {
    this.journal.push(entry);
    this.maxFriction += entry.maxDelta;
    this.calculatedFriction += entry.calculatedDelta;
  }
}
