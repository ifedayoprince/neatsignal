# Methodology for Neatsignal

Receive trace file via CLI
`neatsignal analyze test_trace.json`

- `analyze`     - Analyzes and gives recommendation for fixes.
- `score`       - Gives just the Friction score.

Friction score is a measure of the user's experience using your agent. It is a percentage-based value where 100 means 100% friction (a terrible run) and 0% means no friction (the ideal run).

## Neatsignal's Processing Workflow
1. Load the trace file
    - Set Friction to 0% initially.

2. Keep a running map of the tools the agent used in the chat and the args passed.

3. If a tool is called TOOL_CONSEC times, we run a naive string similarity check on the args. If high similarity, we run a semantic compare using embeddings looking
    - Even if another tool was called that breaks the consecutivity, there is a tolerance of how spaced out the tool calls can be to be counted as consecutive and still trigger this similarity check.
    - If high similarity, we give a friction score. 
    `Calculated Friction += similarity * MAX_TOOL_LOOP_DOOM`
    `Max Friction += MAX_TOOL_LOOP_DOOM`
    - We can then normalize onto the 100 point scale
    `Friction = Calculated Friction/Max Friction`

4. If a tool repeatedly returns empty responses. Increase friction.

5. If there is a sudden change in the user's prompt length, and the new prompt does not include common positive signals, we flag it.
    - If `New prompt length` less than or equal to SUSPICOUSLY_SHORT_PROMPT (default to 10 words, can be changed as real data comes in), AND it includes negative words
    e.g. 'No', 'Not asked', 'Retry', e.t.c. (can be made more exhaustive over time).
    Trigger LITE to contextually take the last 3 user prompts and grade the interaction on an FRS scale. 
        + `Frustration` (User indicates annoyance or frustration)
        + `Repetition` (User having to repeat themselves)
        + `Satisfaction` (User is satisfied)
    `Calculated Friction += (Frustration * MAX_FRUSTRATION) + (Repetition * MAX_REPETION) - (Satisfaction * MAX_SATISFACTION)`
    `Max Friction += MAX_FRUSTRATION + MAX_REPETITION + MAX_SATISFACTION`
    - If `New prompt length` drops but huge sign of positive keywords
    e.g. 'Exactly', Nice, Weldone, Continue, Thanks, Looks good, Yes, e.t.c. (can be made more exhaustive over time)
    `Max Friction += Number of matches`

    - Huge rise in `New prompt length` (the user is likely reexplaining). 
    `(New prompt length / Average prompt length of previous N messages) >> 1`
    Trigger LITE to analyze and grade on the `FRS` scale.

6. At the end. Fetch the journal of all the observations and run it through an LLM to generate a summary of the observations and suggested improvements.

END


LITE is a decision model (e.g. Jev), it is not triggered mid-processing. It is triggered at the end so observations that need intelligent judgement can be batched and send off.

## Future Improvements

1. Sensitivity to certain heuristics can be tuned.
2. Keyword lists can be increased.
3. Values for `SUSPICOUSLY_SHORT_PROMPT` and the `MAX_...` fields can be tuned as more real-world data and behaviour is revealed.
4. Support direct/real-time ingestion for proactive notification of clients
5. Improve heuristics to futher reduce calls the LITE model.
6. For larger traces, we could split the trace and walkthrough random chunks of it in parallel.

Written by Ifedayo
11/11/2026