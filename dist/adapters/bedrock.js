/**
 * Runs every toolUse block in an AWS Bedrock Converse API response through
 * the gate and returns the messages to append: the assistant's own message
 * (replayed verbatim) plus one user message carrying a toolResult block per
 * call — Bedrock requires all toolResults for one assistant turn to arrive
 * together in a single user message.
 */
export async function handleResponse(gate, response) {
    const assistantMessage = response.output.message;
    const toolUseBlocks = assistantMessage.content.filter((block) => block.toolUse !== undefined);
    if (toolUseBlocks.length === 0) {
        const text = assistantMessage.content.find((block) => block.text !== undefined)?.text ?? "";
        return { done: true, text, messages: [assistantMessage] };
    }
    const toolResults = [];
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
