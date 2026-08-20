import { test } from "node:test";
import assert from "node:assert/strict";
import { AgenticGate } from "../dist/index.js";
import { handleResponse } from "../dist/adapters/bedrock.js";
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

test("done: true when there's no toolUse block, returns the final text", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = { role: "assistant", content: [{ text: "All done." }] };
  const response = { output: { message: assistantMessage } };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, true);
  assert.equal(outcome.text, "All done.");
  assert.deepEqual(outcome.messages, [assistantMessage]);
});

test("a valid toolUse is executed and returns the assistant message plus a user message with a toolResult", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: [{ toolUse: { toolUseId: "tu_1", name: "double", input: { x: 5 } } }],
  };
  const response = { output: { message: assistantMessage } };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, false);
  assert.deepEqual(outcome.messages[0], assistantMessage);
  assert.deepEqual(outcome.messages[1], {
    role: "user",
    content: [{ toolResult: { toolUseId: "tu_1", status: "success", content: [{ json: 10 }] } }],
  });
});

test("an invalid toolUse produces a toolResult with status: error", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: [{ toolUse: { toolUseId: "tu_2", name: "double", input: { x: "not-a-number" } } }],
  };
  const response = { output: { message: assistantMessage } };

  const outcome = await handleResponse(gate, response);

  const toolResult = outcome.messages[1].content[0].toolResult;
  assert.equal(toolResult.status, "error");
  assert.match(toolResult.content[0].text, /Validation Gate Failed/);
});

test("multiple toolUse blocks all land in one user message", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: [
      { toolUse: { toolUseId: "tu_a", name: "double", input: { x: 1 } } },
      { toolUse: { toolUseId: "tu_b", name: "double", input: { x: 2 } } },
    ],
  };
  const response = { output: { message: assistantMessage } };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.messages.length, 2);
  assert.equal(outcome.messages[1].content.length, 2);
  assert.deepEqual(
    outcome.messages[1].content.map((r) => [r.toolResult.toolUseId, r.toolResult.content[0].json]),
    [
      ["tu_a", 2],
      ["tu_b", 4],
    ]
  );
});
