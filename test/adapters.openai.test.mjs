import { test } from "node:test";
import assert from "node:assert/strict";
import { AgenticGate } from "../dist/index.js";
import { handleResponse } from "../dist/adapters/openai.js";
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

test("done: true and no tool_calls returns the final text and the raw assistant message", async () => {
  const gate = makeGateWithTool();
  const response = {
    choices: [{ message: { role: "assistant", content: "All done." } }],
  };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, true);
  assert.equal(outcome.text, "All done.");
  assert.deepEqual(outcome.messages, [response.choices[0].message]);
});

test("a valid tool call is executed and returns an assistant message plus a tool result message", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call_1", function: { name: "double", arguments: JSON.stringify({ x: 5 }) } }],
  };
  const response = { choices: [{ message: assistantMessage }] };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, false);
  assert.equal(outcome.messages.length, 2);
  assert.equal(outcome.messages[0], assistantMessage);
  assert.deepEqual(outcome.messages[1], {
    role: "tool",
    tool_call_id: "call_1",
    content: JSON.stringify(10),
  });
});

test("an invalid tool call's gate error is fed back as the tool message content", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call_2", function: { name: "double", arguments: JSON.stringify({ x: "not-a-number" }) } }],
  };
  const response = { choices: [{ message: assistantMessage }] };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.done, false);
  assert.equal(outcome.messages[1].tool_call_id, "call_2");
  assert.match(outcome.messages[1].content, /Validation Gate Failed/);
});

test("multiple tool calls in one response each get their own tool result message", async () => {
  const gate = makeGateWithTool();
  const assistantMessage = {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_a", function: { name: "double", arguments: JSON.stringify({ x: 1 }) } },
      { id: "call_b", function: { name: "double", arguments: JSON.stringify({ x: 2 }) } },
    ],
  };
  const response = { choices: [{ message: assistantMessage }] };

  const outcome = await handleResponse(gate, response);

  assert.equal(outcome.messages.length, 3); // assistant + 2 tool results
  assert.deepEqual(
    outcome.messages.slice(1).map((m) => [m.tool_call_id, m.content]),
    [
      ["call_a", JSON.stringify(2)],
      ["call_b", JSON.stringify(4)],
    ]
  );
});
