import { test } from "node:test";
import assert from "node:assert/strict";
import { AgenticGate } from "../dist/index.js";
import { z } from "zod";

function makeGate(options) {
  return new AgenticGate(options);
}

test("passes valid input through to execute() and returns its result", async () => {
  const gate = makeGate();
  gate.registerTool({
    name: "double",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x * 2,
  });

  const result = await gate.interceptAndExecute("double", { x: 5 });
  assert.deepEqual(result, { success: true, data: 10 });
});

test("rejects invalid input before execute() runs", async () => {
  const gate = makeGate();
  let executed = false;
  gate.registerTool({
    name: "double",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => {
      executed = true;
      return x * 2;
    },
  });

  const result = await gate.interceptAndExecute("double", { x: "not-a-number" });
  assert.equal(result.success, false);
  assert.match(result.error, /Validation Gate Failed/);
  assert.equal(executed, false);
});

test("returns an error for an unregistered tool", async () => {
  const gate = makeGate();
  const result = await gate.interceptAndExecute("nope", {});
  assert.equal(result.success, false);
  assert.match(result.error, /not registered/);
});

test("surfaces execute() throwing as an execution failure", async () => {
  const gate = makeGate();
  gate.registerTool({
    name: "boom",
    schema: z.object({}),
    execute: async () => {
      throw new Error("downstream API down");
    },
  });

  const result = await gate.interceptAndExecute("boom", {});
  assert.equal(result.success, false);
  assert.match(result.error, /Execution Failed.*downstream API down/);
});

test("circuit breaker trips after maxConsecutiveFailures and blocks further calls", async () => {
  const gate = makeGate({ maxConsecutiveFailures: 2 });
  let executeCalls = 0;
  gate.registerTool({
    name: "flaky",
    schema: z.object({ x: z.number() }),
    execute: async () => {
      executeCalls++;
      return "ok";
    },
  });

  await gate.interceptAndExecute("flaky", { x: "bad" }); // fail 1
  await gate.interceptAndExecute("flaky", { x: "bad" }); // fail 2 -> trips

  const tripped = await gate.interceptAndExecute("flaky", { x: 1 }); // valid, but circuit open
  assert.equal(tripped.success, false);
  assert.match(tripped.error, /Circuit Breaker OPEN/);
  assert.equal(executeCalls, 0, "execute() must not run while the circuit is open");
});

test("resetCircuit re-enables a tripped tool", async () => {
  const gate = makeGate({ maxConsecutiveFailures: 1 });
  gate.registerTool({
    name: "flaky",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x,
  });

  await gate.interceptAndExecute("flaky", { x: "bad" }); // trips immediately
  const blocked = await gate.interceptAndExecute("flaky", { x: 1 });
  assert.equal(blocked.success, false);

  gate.resetCircuit("flaky");
  const recovered = await gate.interceptAndExecute("flaky", { x: 1 });
  assert.deepEqual(recovered, { success: true, data: 1 });
});

test("a success resets the consecutive failure count", async () => {
  const gate = makeGate({ maxConsecutiveFailures: 2 });
  gate.registerTool({
    name: "sometimes",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x,
  });

  await gate.interceptAndExecute("sometimes", { x: "bad" }); // fail 1
  await gate.interceptAndExecute("sometimes", { x: 1 }); // success -> resets count
  await gate.interceptAndExecute("sometimes", { x: "bad" }); // fail 1 again, not fail 2

  const stillOpen = await gate.interceptAndExecute("sometimes", { x: 2 });
  assert.equal(stillOpen.success, true, "circuit should not be open after only one fresh failure");
});

test("maxConsecutiveFailures: 0 disables the circuit breaker", async () => {
  const gate = makeGate({ maxConsecutiveFailures: 0 });
  gate.registerTool({
    name: "always-fails",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x,
  });

  for (let i = 0; i < 10; i++) {
    const result = await gate.interceptAndExecute("always-fails", { x: "bad" });
    assert.doesNotMatch(result.error, /Circuit Breaker OPEN/);
  }
});

test("onGateSuccess and onGateFailure hooks fire with the right event shape", async () => {
  const events = [];
  const gate = makeGate({
    maxConsecutiveFailures: 1,
    onGateSuccess: (e) => events.push({ type: "success", ...e }),
    onGateFailure: (e) => events.push({ type: "failure", ...e }),
  });
  gate.registerTool({
    name: "hooked",
    schema: z.object({ x: z.number() }),
    execute: async ({ x }) => x,
  });

  await gate.interceptAndExecute("hooked", { x: "bad" }); // validation failure, count=1, trips
  await gate.interceptAndExecute("hooked", { x: 1 }); // circuit-open failure
  gate.resetCircuit("hooked");
  await gate.interceptAndExecute("hooked", { x: 1 }); // success

  assert.deepEqual(
    events.map((e) => [e.type, e.reason ?? null]),
    [
      ["failure", "validation"],
      ["failure", "circuit-open"],
      ["success", null],
    ]
  );
  assert.equal(events[0].consecutiveFailures, 1);
  assert.equal(events[2].data, 1);
});
