/**
 * Runs every tool_use block in an Anthropic Messages API response through the
 * gate and returns the messages to append: the assistant's own turn (content
 * replayed verbatim) plus one user turn carrying a tool_result block per call
 * — Anthropic requires all tool_results for one assistant turn to arrive
 * together in a single user message.
 */
export async function handleResponse(gate, response) {
    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
    if (toolUseBlocks.length === 0) {
        const text = response.content.find((block) => block.type === "text")?.text ?? "";
        return { done: true, text, messages: [{ role: "assistant", content: response.content }] };
    }
    const toolResults = [];
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
