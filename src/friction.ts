import { EMPTY_RESP_THRESHOLD, MAX_TOOL_LOOP_DOOM, NAIVE_SIM_THRESHOLD, NEGATIVE_SIGNALS, PENALTY_TOOL_EMPTY_RESP, POSITIVE_SIGNALS, PREV_PROMPT_WINDOW, SPIKE_RATIO_THRESHOLD, SUSPICIOUSLY_SHORT_PROMPT, TOOL_CONSEC_THRESHOLD, TOOL_WINDOW_SIZE, VALIDITY_THRESHOLD } from "./constants.js";
import type { JournalEntry, Score } from "./friction.type.js";
import type { MessageEntry, ToolCall } from "./trace.type.js";
import { checkToolArgsSimilarity, countMatches, countWords, error, isEmptyToolCall, percent, warn } from "./utils.js";
import picocolors from "picocolors";

export class FrictionMonitor {
  private journal: JournalEntry[] = [];
  private toolMap = new Map<string, { count: number, emptyOutputs: number, calls: (ToolCall & { idx: number })[] }>();
  private userPromptCache: string[] = [];

  constructor(
    public readonly messages: MessageEntry[]
  ) { }

  getMessage(idx: number) {
    if (idx < 0 || idx >= this.messages.length) return null;
    return this.messages[idx];
  }

  async scan() {
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];

      // Heuristic 1 & 2
      this.handleToolCall(message!, i);

      // Heuristic 3. Flag sudden reduction in user prompt length.
      this.handleUserPromptReduction(message!, i);

      // Heuristic 4. Flag sudden rise in user prompt length.
      this.handleUserPromptGrowth(message!, i);
    }

    const score = await this.score();
    this.present(score);
  }

  present(score: Score) {
    console.log(`==========================================`)
    console.log(`${picocolors.green('Scan complete!')}`)
    console.log(`${picocolors.green('Summary:')}`)
    console.log(` Total observations: ${score.totalObservations.toLocaleString()} (${score.validObservations.toLocaleString()} verified)`);
    console.log(` Calculated friction: ${score.calculatedFriction.toLocaleString()} (max: ${score.maxFriction.toLocaleString()})`);
    console.log(` Overall friction score: ${percent(score.frictionScore)})`);


    console.log(`==========================================`)

  }
  async score(): Promise<Score> {
    const validated = await this.validateJournal();

    const calculatedFriction = validated.reduce((acc, e) => acc + e.calculatedDelta, 0);
    const maxFriction = validated.reduce((acc, e) => acc + e.maxDelta, 0);

    // Optionally route valid observations to an LLM to give recommended fixes or evals. (Future-scope)
    let recommendations = '';

    return {
      totalObservations: this.journal.length,
      validObservations: validated.length,
      calculatedFriction, maxFriction,
      frictionScore: maxFriction > 0 ? calculatedFriction / maxFriction : 0,
      recommendations
    }
  }

  async validateJournal(): Promise<JournalEntry[]> {
    if (this.journal.length == 0) return [];
    if (!process.env.OPENROUTER_API_KEY) {
      warn(`Journal validation is not active as OPENROUTER_API_KEY is not set.`);
      return this.journal;
    }

    const questions: Record<string, any> = {};

    const getMessageAsText = (msg: MessageEntry | undefined) => {
      if (!msg) return '';
      if (msg.role == "user") return msg.content;
      if (msg.role == "tool") return JSON.stringify(msg)

      return '';
    }

    for (let i = 0; i < this.journal.length; i++) {
      const obs = this.journal[i];
      questions[`question_${i}`] = {
        type: "boolean",
        instructions: `Is the following observation factually accurate and valid based on the context given? \n\n"${obs?.note}".${obs?.includeContent ? `\n\nThis is the content of the message: \n${getMessageAsText(this.messages[obs.msgIdx])}` : ''}`,
        criteria: {
          true: "The observation is grounded, accurate, and truly occurred.",
          false: "The observation is hallucinated, unsubstantiated, or incorrect."
        }
      };
    }

    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "typesafe/jev-latest",
        state: '',
        questions: questions
      })
    });

    if (!response.ok) {
      const err = await response.text();
      error(`OpenRouter Jev error: ${err}`);
    }

    const data: any = await response.json();
    return this.journal.map((obs, idx) => {
      const ans = data.answers[`question_${idx}`];
      const prob = ans?.noul ?? ans?.probability ?? 0.0;
      return prob > VALIDITY_THRESHOLD ? obs : null;
    }).filter(a => !!a);

  }
  handleUserPromptGrowth(message: MessageEntry, idx: number) {
    if (message?.role != "user" || !message.content
      || countWords(message.content) <= SUSPICIOUSLY_SHORT_PROMPT) return;
    if (this.userPromptCache.length === 0) return;

    const averageLength = this.userPromptCache.reduce((acc, p) => acc + countWords(p), 0) / this.userPromptCache.length;

    // User is writing long message. Likely reexplaining themselves.
    const currentLength = countWords(message.content);
    const factor = currentLength / averageLength;
    const delta = factor * 5;
    const entry: JournalEntry = {
      msgIdx: idx,
      calculatedDelta: factor * delta,
      maxDelta: factor * delta,
      includeContent: true,
      note: `User prompt is ${percent(factor)} longer than before. `
    }

    // 4.1 - Long re-explanation or rant
    if (factor > 4) {
      entry.note += `They are likely re-explaining themselves. Current length ${currentLength} words.`;
    }
    // 4.2 - Providing clarity to the agent or giving follow-up
    else if (factor > 2) {
      entry.note += `They are likely querying the agent, clarifying or giving follow-up. Current length ${currentLength} words.`;
    }

    if (factor > SPIKE_RATIO_THRESHOLD) this.addJournal(entry);

    // 4.3 - Count positive keyword triggers
    // Increase maxDelta without increasing calculatedDelta to bring down the overall friction score.
    const positiveTriggers = countMatches(message.content, POSITIVE_SIGNALS);
    if (positiveTriggers.length > 0) {
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

  handleUserPromptReduction(message: MessageEntry, idx: number) {
    if (message?.role != "user" || !message.content
      || countWords(message.content) > SUSPICIOUSLY_SHORT_PROMPT) return;
    if (this.userPromptCache.length === 0) return;

    const averageLength = this.userPromptCache.reduce((acc, p) => acc + countWords(p), 0) / this.userPromptCache.length;

    // 3.1 - Average prompt length is usually longer
    const currentLength = countWords(message.content);
    const factor = currentLength > 0 ? averageLength / currentLength : 0;
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
    if (negativeTriggers.length > 0) {
      const deltaPerTrigger = 2;
      this.addJournal({
        msgIdx: idx,
        includeContent: true,
        calculatedDelta: deltaPerTrigger * negativeTriggers.length,
        maxDelta: deltaPerTrigger * negativeTriggers.length,
        note: `User prompt has ${negativeTriggers.length} negative trigger matches. (Matches: ${negativeTriggers.join(', ')})`
      });
    }

    // 3.3 - Count positive keyword triggers
    // Increase maxDelta without increasing calculatedDelta to bring down the overall friction score.
    const positiveTriggers = countMatches(message.content, POSITIVE_SIGNALS);
    if (positiveTriggers.length > 0) {
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
      calls: [
        ...entry.calls.filter(call => (idx - call.idx) <= TOOL_WINDOW_SIZE),
        { ...message.tool_call, idx }
      ]
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
    this.journal.push({ ...entry, note: entry.note.trim() });
  }
}
