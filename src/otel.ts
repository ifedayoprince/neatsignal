import type { MessageEntry, RawTraceFile } from "./trace.type.js";
import { warn } from "./utils.js";

export function normalizeOtel(content: RawTraceFile) {
    let normalizedMessages: MessageEntry[] = [];
    for (const span of content?.spans) {
        if (!span.attributes) {
            warn(`Span ${span.span_id} lacks 'attributes' property. Skipping...`);
            continue;
        }

        if (span.attributes['openinference.span.kind'] == 'CHAIN')
            continue;

        if (span.attributes['openinference.span.kind'] == 'LLM') {
            let messages = JSON.parse(span.attributes['input.value'] ?? '{}');
            messages = messages.filter((msg: any) => msg.role != 'tool')
            normalizedMessages = normalizedMessages.concat(messages);

            if (!!span.attributes['output.value']) {
                const val = span.attributes['output.value'];
                const output = val.trim().startsWith('{')
                    ? JSON.parse(val)
                    : val;

                if (output.tool_calls)
                    delete output.tool_calls;

                if (Object.keys(output).length > 1)
                    normalizedMessages.push({
                        role: 'assistant',
                        content: output
                    })
            }

        } else if (span.attributes['openinference.span.kind'] == 'TOOL') {
            normalizedMessages.push({
                role: 'tool',
                tool_call: {
                    name: span.attributes['tool.name'] ?? "",
                    params: JSON.parse(span.attributes['tool.parameters'] ?? '{}'),
                    output: JSON.parse(span.attributes['tool.output'] ?? '{}')
                },
                status: span.status
            })
        }
    }

    return normalizedMessages;
}