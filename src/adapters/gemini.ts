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
  candidates: Array<{ content: GeminiContent }>;
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
export async function handleResponse(
  gate: AgenticGate,
  response: GeminiGenerateContentResponse
): Promise<AdapterOutcome> {
  const functionCalls = response.functionCalls ?? [];

  if (functionCalls.length === 0) {
    return { done: true, text: response.text ?? "", messages: [response.candidates[0].content] };
  }

  const parts: unknown[] = [];
  for (const call of functionCalls) {
    const gateResult = await gate.interceptAndExecute(call.name, call.args);
    parts.push({
      functionResponse: {
        name: call.name,
        response: gateResult.success ? { result: gateResult.data } : { error: gateResult.error },
      },
    });
  }

  return {
    done: false,
    messages: [response.candidates[0].content, { role: "user", parts }],
  };
}
