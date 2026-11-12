export interface ToolCall {
    name: string;
    params: Record<string, any>;
    output: Record<string, any>;
}

export interface MessageEntry {
    role: "user" | "assistant" | "tool" | "system",
    content?: string;
    tool_call?: ToolCall;
    status?: {
        code?: 'OK' | 'ERROR' | 'UNSET';
        description?: string;
    } | undefined;
}

export interface RawOtelSpan {
    trace_id: string;
    span_id: string;
    parent_span_id?: string | null;
    name: string;
    start_time: string;
    end_time: string;
    status?: {
        code?: 'OK' | 'ERROR' | 'UNSET';
        description?: string;
    };
    attributes?: {
        'openinference.span.kind'?: 'CHAIN' | 'LLM' | 'TOOL' | 'AGENT';
        'input.value'?: string;
        'output.value'?: string;
        'llm.model_name'?: string;
        'llm.system_prompt'?: string;
        'llm.token_count.total'?: number;
        'tool.name'?: string;
        'tool.parameters'?: string;
        'tool.output'?: string;
        [key: string]: unknown;
    };
}

export interface RawTraceFile {
    trace_id?: string;
    session_id?: string;
    spans: RawOtelSpan[];
}
