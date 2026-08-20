import { AgenticGate } from "../gate.js";

export interface OpenAIToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

export interface OpenAIAssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChatCompletionResponse {
  choices: Array<{ message: OpenAIAssistantMessage }>;
}

export interface AdapterOutcome {
  /** true when the model returned a final answer with no tool calls */
  done: boolean;
  /** the model's final text, only set when done is true */
  text?: string;
  /** messages to append to your conversation array, in order */
  messages: unknown[];
}

/**
 * Runs every tool call in an OpenAI chat completion response through the gate
 * and returns the messages to append to your conversation: the assistant's
 * own message, plus one "tool" role message per call carrying either the
 * execution result or the gate's rejection error for the model to read.
 */
export async function handleResponse(
  gate: AgenticGate,
  response: OpenAIChatCompletionResponse
): Promise<AdapterOutcome> {
  const assistantMessage = response.choices[0].message;
  const toolCalls = assistantMessage.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return { done: true, text: assistantMessage.content ?? "", messages: [assistantMessage] };
  }

  const messages: unknown[] = [assistantMessage];

  for (const toolCall of toolCalls) {
    const rawArgs = JSON.parse(toolCall.function.arguments);
    const gateResult = await gate.interceptAndExecute(toolCall.function.name, rawArgs);

    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: gateResult.success ? JSON.stringify(gateResult.data) : gateResult.error,
    });
  }

  return { done: false, messages };
}
