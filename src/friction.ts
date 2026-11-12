import figlet from "figlet";
import { EMPTY_RESP_THRESHOLD, MAX_TOOL_LOOP_DOOM, NAIVE_SIM_THRESHOLD, NEGATIVE_SIGNALS, PENALTY_TOOL_EMPTY_RESP, POSITIVE_SIGNALS, PREV_PROMPT_WINDOW, SPIKE_RATIO_THRESHOLD, SUSPICIOUSLY_SHORT_PROMPT, TOOL_CONSEC_THRESHOLD, TOOL_WINDOW_SIZE } from "./constants.js";
import type { JournalEntry, Score } from "./friction.type.js";
import type { MessageEntry, ToolCall } from "./trace.type.js";
import { checkToolArgsSimilarity, countMatches, countWords, error, isEmptyToolCall, percent, warn } from "./utils.js";
import picocolors from "picocolors";

export class FrictionMonitor {
  private journal: JournalEntry[] = [];
  private toolMap = new Map<string, { emptyOutputs: number, calls: (ToolCall & { idx: number })[] }>();
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
    await this.present(score);
  }

  async present(score: Score) {
    const color = (str: string) => {
      if (score.frictionScore > 0.75) return picocolors.red(str);
      if (score.frictionScore > 0.5) return picocolors.magenta(str);
      if (score.frictionScore > 0.35) return picocolors.yellow(str);
      if (score.frictionScore > 0.25) return picocolors.cyan(str);
      return picocolors.green(str)
    }

    const getRemark = () => {
      // > 75%: Critical breakdown
      if (score.frictionScore > 0.75) {
        return "Severe friction. The user had a painful experience. Expect loops, rants, or total derailment.";
      }
      // 51% - 75%: Significant struggle
      if (score.frictionScore > 0.50) {
        return "High friction. The interaction was quite rocky; the user had to repeatedly correct or steer the agent.";
      }
      // 36% - 50%: Bumpy but recoverable
      if (score.frictionScore > 0.35) {
        return "Moderate friction. A few hiccups and re-explanations, but they managed to push through.";
      }
      // 21% - 35%: Minor resistance
      if (score.frictionScore > 0.20) {
        return "Mild friction. Mostly decent with just a couple of minor speed bumps.";
      }
      // <= 20%: Excellent
      return "Smooth sailing! Clean back-and-forth with minimal resistance.";
    };

    console.log(`==========================================`)
    console.log(`${picocolors.green('Scan complete!')}`)
    console.log(`${picocolors.green('Summary:')}`)
    console.log(` Total observations: ${score.totalObservations.toLocaleString()} (${score.validObservations.toLocaleString()} verified)`);
    console.log(` Calculated friction: ${score.calculatedFriction.toLocaleString()} (max: ${score.maxFriction.toLocaleString()})`);
    console.log(` Overall friction score:\n\n`);
    console.log(`${color(await figlet(percent(score.frictionScore), {
      horizontalLayout: "full"
    }))}`);
    console.log(`   Verdict: ${getRemark()}`);

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
        type: "choice",
        instructions: `Rate this observation. Is it valid or not given the content of the message? \n\n"${obs?.note}".${obs?.includeContent ? `\n\nThis is the content of the message: \n<content>\n${getMessageAsText(this.messages[obs.msgIdx])}\n</content>` : ''}`,
        criteria: {
          true: "The observation is accurate.",
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
        model: "perplexity/pplx-decider-v1.3:free",
        state: `Evaluate each observation strictly against the provided trace and message context.

- Questions: Answer TRUE if supported by the evidence in the context, otherwise FALSE (e.g., judging tone, frustration, or user intent).
- Statements: Rate TRUE if the claim is factually accurate and grounded in the text; rate FALSE if unsubstantiated, hallucinated, or incorrect.
- Verifiability: Ignore relative or comparative claims you lack full session history to verify (e.g., claims about average prompt lengths). Base your judgment solely on verifiable facts present in the provided context.`,
        questions: questions
      })
    });

    if (!response.ok) {
      const err = await response.text();
      error(`OpenRouter Jev error: ${err}`);
    }

    // console.log(questions)
    const data: any = await response.json();
    return this.journal.map((obs, idx) => {
      const ans = data.answers[`question_${idx}`];
      // console.log(ans)
      return ans.choice == "true" ? obs : null;
    }).filter(a => !!a);

  }
  handleUserPromptGrowth(message: MessageEntry, idx: number) {
    if (message?.role != "user" || !message.content
      || countWords(message.content) <= SUSPICIOUSLY_SHORT_PROMPT) return;
    if (this.userPromptCache.length > 0) {
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
        entry.note += `They are likely re-explaining themselves. Confirm. Current length ${currentLength} words.`;
      }
      // 4.2 - Providing clarity to the agent or giving follow-up
      else if (factor > 2) {
        entry.note += `They are likely querying the agent, clarifying or giving follow-up. Confirm. Current length ${currentLength} words.`;
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
          note: `User prompt has ${positiveTriggers.length} positive trigger matches. Check if this is true (Matches: ${positiveTriggers.join(', ')})`
        });
      }
    }

    this.cacheUserPrompt(message.content);
  }

  handleUserPromptReduction(message: MessageEntry, idx: number) {
    if (message?.role != "user" || !message.content
      || countWords(message.content) > SUSPICIOUSLY_SHORT_PROMPT) return;
    if (this.userPromptCache.length > 0) {

      const averageLength = this.userPromptCache.reduce((acc, p) => acc + countWords(p), 0) / this.userPromptCache.length;

      // 3.1 - Average prompt length is usually longer
      const currentLength = countWords(message.content);
      const factor = currentLength > 0 ? averageLength / currentLength : 0;
      if (factor > 2) {
        const delta = 10;
        this.addJournal({
          msgIdx: idx,
          calculatedDelta: factor * delta,
          maxDelta: factor * delta,
          includeContent: true,
          note: `\nUser prompts are usually ${percent(factor)} longer than current prompt length. Current length ${currentLength} words. Are they frustrated or annoyed?`
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
          note: `User prompt has ${negativeTriggers.length} negative trigger matches. Check if this is true (Matches: ${negativeTriggers.join(', ')})`
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
          note: `User prompt has ${positiveTriggers.length} positive trigger matches. Check if this is true (Matches: ${positiveTriggers.join(', ')})`
        });
      }
    }

    this.cacheUserPrompt(message.content);
  }
  handleToolCall(message: MessageEntry, idx: number) {
    if (message?.role != "tool" || !message.tool_call) return;

    // Watch this tool and increment it's counter
    let entry = this.toolMap.get(message.tool_call?.name);
    if (!entry)
      entry = {
        emptyOutputs: 0,
        calls: []
      };

    const isEmpty = isEmptyToolCall(message.tool_call);
    entry = {
      emptyOutputs: entry.emptyOutputs + (isEmpty ? 1 : 0),
      calls: [
        ...entry.calls.filter(call => (idx - call.idx) <= TOOL_WINDOW_SIZE),
        { ...message.tool_call, idx }
      ]
    };

    this.toolMap.set(message.tool_call?.name, entry);

    // Heuristic 1. Flag tools being repeatedly called.
    if (entry.calls.length > TOOL_CONSEC_THRESHOLD) {
      const similarity = checkToolArgsSimilarity(entry.calls);
      if (similarity > NAIVE_SIM_THRESHOLD) {
        this.addJournal({
          msgIdx: idx,
          calculatedDelta: similarity * MAX_TOOL_LOOP_DOOM,
          maxDelta: MAX_TOOL_LOOP_DOOM,
          note: `
Tool ${message.tool_call.name} has repeated tool calls with similar args (~${(similarity * 100).toFixed(2)}%)
${entry.calls.map((call, idx) => `Call ${idx} has args ${JSON.stringify(call?.params)}`).join('\n')}

Confirm Yes or No
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
${entry.calls.map((call, idx) => `Call ${idx} has args ${JSON.stringify(call?.params)}`).join('\n')}

Confirm Yes or No
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
