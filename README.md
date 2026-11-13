# Neatsignal
(Entirely hand-coded by Ifedayo, without AI)

> Friction detection, triage, and eval mining for LLM agent traces.

Agent reliability isn't a dev-only problem. It’s a shared context problem. 

Production agents generate huge volumes of traces. These runs are too important to ignore, but auditing them by hand doesn't scale, and running a full LLM eval on every span costs too much. Most agent failures don't throw 500 errors. The agent just silently ignores a constraint, loops on a tool, or frustrates the user while the span reports `200 OK`.

Neatsignal is a lightweight engine that extracts signal from noisy traces:

- Zero-LLM heuristics first: detects tool loops, consecutive empty responses, and user prompt collapses without spending API tokens.
- Friction indexing: scores session quality with a `friction` accumulator.
- Trace-to-eval mining (future-extension): turns high-friction production runs into golden eval datasets and regression tests, so each silent failure in production becomes a test case.

Neatsignal extends the Neatlogs mission of moving teams from noisy traces to fast, automated fixes.

Isn't that neet? :)

## Heuristics

- **Tool Thrash & Loop Detection**: Detects repetitive tool calls with near-identical arguments across sliding windows.
- **Empty Tool Response Tracking**: Identifies failing or hollow tool executions while permitting legitimate empty queries.
- **Capability Contradiction Detection**: Flags runs where tool outputs return unsupported capabilities or failures that the agent glosses over.
- **Prompt Dynamics & Sentiment**: Tracks sudden spikes in user prompt length (re-explanations) and sudden drops (user giving up vs. confirming progress).
- **LLM Grounded Verification**: Optionally verifies friction observations via OpenRouter decisions to eliminate false positives.

## Installation

```bash
pnpm install
```

## Usage

Analyze an OpenTelemetry trace file (`.json`):

```bash
# Basic trace scan
pnpm exec tsx src/main.ts analyze path/to/trace.json

# With OpenRouter decision verification
export OPENROUTER_API_KEY="your-key"
pnpm exec tsx src/main.ts analyze path/to/trace.json
```

## Friction Scoring Tiers

| Score Range | Severity | Description |
| :--- | :--- | :--- |
| **0% – 20%** | Smooth sailing | Clean back-and-forth with minimal resistance. |
| **21% – 35%** | Mild friction | Minor speed bumps or brief clarifications. |
| **36% – 50%** | Moderate friction | Hiccups requiring minor course correction. |
| **51% – 75%** | High friction | Interaction struggled; user repeatedly intervened. |
| **> 75%** | Severe friction | Critical breakdown, tool loops, or user churn. |

## License

ISC
