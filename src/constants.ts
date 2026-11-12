export const TOOL_CONSEC_THRESHOLD = 3;          // Min occurrences to trigger check
export const TOOL_WINDOW_SIZE = 6;               // Lookback window allowing for spaced-out calls
export const NAIVE_SIM_THRESHOLD = 0.70;         // Fast string similarity cutoff (e.g. Jaccard/Levenshtein)
export const SEMANTIC_SIM_THRESHOLD = 0.82;      // Embedding cosine similarity cutoff
export const MAX_TOOL_LOOP_DOOM = 25.0;          // Max friction impact for tool loops

export const EMPTY_RESP_THRESHOLD = 0.70;         // Percentage of calls returned empty responses before penalty
export const PENALTY_TOOL_EMPTY_RESP = 15.0;     // Friction added per empty response streak
export const MAX_TOOL_EMPTY = 15.0;

export const SUSPICIOUSLY_SHORT_PROMPT = 10;     // In words
export const SPIKE_RATIO_THRESHOLD = 2.5;        // Current length / Avg previous length
export const PREV_PROMPT_WINDOW = 3;             // N previous messages for average calculation

export const MAX_FRUSTRATION = 20.0;
export const MAX_REPETITION = 20.0;
export const MAX_SATISFACTION = 10.0;

export const NEGATIVE_SIGNALS = ["no", "not asked", "retry", "wrong", "stop", "undo", "again"];
export const POSITIVE_SIGNALS = ["exactly", "nice", "well done", "continue", "thanks", "looks good", "yes", "perfect"];
