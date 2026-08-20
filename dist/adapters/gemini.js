/**
 * Runs every function call in a Gemini generateContent response through the
 * gate and returns the entries to append to your `contents` array: the
 * model's own turn (replayed verbatim, since Gemini 3.x attaches a
 * thoughtSignature that must round-trip unchanged) plus one user turn
 * carrying a functionResponse part per call.
 */
export async function handleResponse(gate, response) {
    const functionCalls = response.functionCalls ?? [];
    if (functionCalls.length === 0) {
        return { done: true, text: response.text ?? "", messages: [response.candidates[0].content] };
    }
    const parts = [];
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
