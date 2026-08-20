import { test } from "node:test";
import assert from "node:assert/strict";
import { AgenticGate } from "../dist/index.js";
import { handleResponse } from "../dist/adapters/anthropic.js";
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

test("done: true when there's no tool_use block, returns the final text", async () => {
  const gate = makeGateWithTool();
  const response = { content: [{ type: "text", text: "All done." }] };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, true);
  assert.equal(outcome.text, "All done.");
  assert.deepEqual(outcome.messages, [{ role: "assistant", content: response.content }]);
});

test("a valid tool_use is executed and returns an assistant turn plus a user turn with a tool_result", async () => {
  const gate = makeGateWithTool();
  const response = {
    content: [{ type: "tool_use", id: "toolu_1", name: "double", input: { x: 5 } }],
  };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, false);
  assert.deepEqual(outcome.messages[0], { role: "assistant", content: response.content });
  assert.deepEqual(outcome.messages[1], {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify(10) }],
  });
});

test("an invalid tool_use produces a tool_result with is_error: true", async () => {
  const gate = makeGateWithTool();
  const response = {
    content: [{ type: "tool_use", id: "toolu_2", name: "double", input: { x: "not-a-number" } }],
  };

  const outcome = await handleResponse(gate, response);

  const toolResult = outcome.messages[1].content[0];
  assert.equal(toolResult.is_error, true);
  assert.match(toolResult.content, /Validation Gate Failed/);
});

test("multiple tool_use blocks all land in one user turn", async () => {
  const gate = makeGateWithTool();
  const response = {
    content: [
      { type: "tool_use", id: "toolu_a", name: "double", input: { x: 1 } },
      { type: "tool_use", id: "toolu_b", name: "double", input: { x: 2 } },
    ],
  };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.messages.length, 2); // one assistant turn + one user turn
  assert.equal(outcome.messages[1].content.length, 2);
  assert.deepEqual(
    outcome.messages[1].content.map((r) => [r.tool_use_id, r.content]),
    [
      ["toolu_a", JSON.stringify(2)],
      ["toolu_b", JSON.stringify(4)],
    ]
  );
});
