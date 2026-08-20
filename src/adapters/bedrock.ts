import { AgenticGate } from "../gate.js";

export interface BedrockToolUseBlock {
  toolUse: { toolUseId: string; name: string; input: unknown };
}

export interface BedrockContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: unknown };
  [key: string]: unknown;
}

export interface BedrockMessage {
  role: string;
  content: BedrockContentBlock[];
}

export interface BedrockConverseResponse {
  output: { message: BedrockMessage };
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
export async function handleResponse(
  gate: AgenticGate,
  response: BedrockConverseResponse
): Promise<AdapterOutcome> {
  const assistantMessage = response.output.message;
  const toolUseBlocks = assistantMessage.content.filter((block) => block.toolUse !== undefined) as unknown as BedrockToolUseBlock[];

  if (toolUseBlocks.length === 0) {
    const text = assistantMessage.content.find((block) => block.text !== undefined)?.text ?? "";
    return { done: true, text, messages: [assistantMessage] };
  }

  const toolResults: unknown[] = [];
  for (const block of toolUseBlocks) {
    const { toolUseId, name, input } = block.toolUse;
    const gateResult = await gate.interceptAndExecute(name, input);
    toolResults.push({
      toolResult: {
        toolUseId,
        status: gateResult.success ? "success" : "error",
        content: gateResult.success ? [{ json: gateResult.data }] : [{ text: gateResult.error }],
      },
    });
  }

  return {
    done: false,
    messages: [assistantMessage, { role: "user", content: toolResults }],
  };
}
