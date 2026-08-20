import { test } from "node:test";
import assert from "node:assert/strict";
import { AgenticGate } from "../dist/index.js";
import { handleResponse } from "../dist/adapters/gemini.js";
import { z } from "zod";

function makeGateWithTool() {
  const gate = new AgenticGate();
  gate.registerTool({
    name: "double",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x * 2,
  });
  return gate;
}

test("done: true when there are no function calls, returns the final text", async () => {
  const gate = makeGateWithTool();
  const candidateContent = { role: "model", parts: [{ text: "All done." }] };
  const response = { functionCalls: [], text: "All done.", candidates: [{ content: candidateContent }] };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, true);
  assert.equal(outcome.text, "All done.");
  assert.deepEqual(outcome.messages, [candidateContent]);
});

test("a valid function call is executed and returns the model turn plus a user turn with a functionResponse", async () => {
  const gate = makeGateWithTool();
  const candidateContent = {
    role: "model",
    parts: [{ functionCall: { name: "double", args: { x: 5 } }, thoughtSignature: "sig-123" }],
  };
  const response = {
    functionCalls: [{ name: "double", args: { x: 5 } }],
    candidates: [{ content: candidateContent }],
  };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, false);
  // The model turn must be replayed verbatim (including thoughtSignature).
  assert.equal(outcome.messages[0], candidateContent);
  assert.deepEqual(outcome.messages[1], {
    role: "user",
    parts: [{ functionResponse: { name: "double", response: { result: 10 } } }],
  });
});

test("an invalid function call produces a functionResponse carrying the gate error", async () => {
  const gate = makeGateWithTool();
  const candidateContent = { role: "model", parts: [{ functionCall: { name: "double", args: { x: "bad" } } }] };
  const response = {
    functionCalls: [{ name: "double", args: { x: "bad" } }],
    candidates: [{ content: candidateContent }],
  };

  const outcome = await handleResponse(gate, response);

  const functionResponse = outcome.messages[1].parts[0].functionResponse;
  assert.match(functionResponse.response.error, /Validation Gate Failed/);
});

test("multiple function calls all land in one user turn as separate parts", async () => {
  const gate = makeGateWithTool();
  const candidateContent = { role: "model", parts: [] };
  const response = {
    functionCalls: [
      { name: "double", args: { x: 1 } },
      { name: "double", args: { x: 2 } },
    ],
    candidates: [{ content: candidateContent }],
  };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.messages.length, 2);
  assert.equal(outcome.messages[1].parts.length, 2);
  assert.deepEqual(
    outcome.messages[1].parts.map((p) => p.functionResponse.response.result),
    [2, 4]
  );
});
