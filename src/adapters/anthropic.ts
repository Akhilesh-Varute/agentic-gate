import { AgenticGate } from "../gate.js";

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
}

export interface AdapterOutcome {
  /** true when the model returned a final answer with no tool_use blocks */
  done: boolean;
  /** the model's final text, only set when done is true */
  text?: string;
  /** messages to append to your conversation array, in order */
  messages: unknown[];
}

/**
 * Runs every tool_use block in an Anthropic Messages API response through the
 * gate and returns the messages to append: the assistant's own turn (content
 * replayed verbatim) plus one user turn carrying a tool_result block per call
 * — Anthropic requires all tool_results for one assistant turn to arrive
 * together in a single user message.
 */
export async function handleResponse(
  gate: AgenticGate,
  response: AnthropicMessageResponse
): Promise<AdapterOutcome> {
  const toolUseBlocks = response.content.filter((block) => block.type === "tool_use") as unknown as AnthropicToolUseBlock[];

  if (toolUseBlocks.length === 0) {
    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    return { done: true, text, messages: [{ role: "assistant", content: response.content }] };
  }

  const toolResults: unknown[] = [];
  for (const block of toolUseBlocks) {
    const gateResult = await gate.interceptAndExecute(block.name, block.input);
    toolResults.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: gateResult.success ? JSON.stringify(gateResult.data) : gateResult.error,
      ...(gateResult.success ? {} : { is_error: true }),
    });
  }

  return {
    done: false,
    messages: [
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ],
  };
}
