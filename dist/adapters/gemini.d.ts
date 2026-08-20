import { AgenticGate } from "../gate.js";
export interface GeminiFunctionCall {
    name: string;
    args: unknown;
}
export interface GeminiContent {
    role?: string;
    parts: unknown[];
}
export interface GeminiGenerateContentResponse {
    functionCalls?: GeminiFunctionCall[];
    text?: string;
    candidates: Array<{
        content: GeminiContent;
    }>;
}
export interface AdapterOutcome {
    /** true when the model returned a final answer with no function calls */
    done: boolean;
    /** the model's final text, only set when done is true */
    text?: string;
    /** messages to append to your `contents` array, in order */
    messages: unknown[];
}
/**
 * Runs every function call in a Gemini generateContent response through the
 * gate and returns the entries to append to your `contents` array: the
 * model's own turn (replayed verbatim, since Gemini 3.x attaches a
 * thoughtSignature that must round-trip unchanged) plus one user turn
 * carrying a functionResponse part per call.
 */
export declare function handleResponse(gate: AgenticGate, response: GeminiGenerateContentResponse): Promise<AdapterOutcome>;
//# sourceMappingURL=gemini.d.ts.map