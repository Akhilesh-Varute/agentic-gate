import { AgenticGate } from "../gate.js";
export interface BedrockToolUseBlock {
    toolUse: {
        toolUseId: string;
        name: string;
        input: unknown;
    };
}
export interface BedrockContentBlock {
    text?: string;
    toolUse?: {
        toolUseId: string;
        name: string;
        input: unknown;
    };
    [key: string]: unknown;
}
export interface BedrockMessage {
    role: string;
    content: BedrockContentBlock[];
}
export interface BedrockConverseResponse {
    output: {
        message: BedrockMessage;
    };
}
export interface AdapterOutcome {
    /** true when the model returned a final answer with no toolUse blocks */
    done: boolean;
    /** the model's final text, only set when done is true */
    text?: string;
    /** messages to append to your conversation array, in order */
    messages: unknown[];
}
/**
 * Runs every toolUse block in an AWS Bedrock Converse API response through
 * the gate and returns the messages to append: the assistant's own message
 * (replayed verbatim) plus one user message carrying a toolResult block per
 * call — Bedrock requires all toolResults for one assistant turn to arrive
 * together in a single user message.
 */
export declare function handleResponse(gate: AgenticGate, response: BedrockConverseResponse): Promise<AdapterOutcome>;
//# sourceMappingURL=bedrock.d.ts.map