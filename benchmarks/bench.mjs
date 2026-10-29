// Reproducible benchmark for agentic-gate (simulated model, real gate).
// Run from the repo root after `npm run build`: node benchmarks/bench.mjs
// The "model" is scripted. The gate, schemas and circuit breaker are the real agentic-gate package.
import { z } from "zod";
import { AgenticGate } from "../dist/index.js";
import { writeFileSync } from "node:fs";

const MAX_TURNS = 50; // hard cap on a runaway agent loop

// ---- Scenarios: each has a schema, a deliberately bad payload, a good payload, and a naive downstream system ----
const scenarios = [
  {
    id: "support-refund",
    label: "Support refund",
    tool: "issue_refund",
    schema: z.object({
      orderId: z.string().regex(/^ORD-\d{6}$/, "orderId must look like ORD-123456"),
      amount: z.number().positive("amount must be a positive number").max(5000),
    }),
    bad: { orderId: "the latest order", amount: "about 40" },
    good: { orderId: "ORD-482913", amount: 40 },
    // naive downstream: does whatever it is given, cannot tell the payload is bad
    downstream: (args) => ({ ok: true, note: "refund request accepted" }),
    isBad: (args) => !/^ORD-\d{6}$/.test(String(args.orderId)) || typeof args.amount !== "number" || !(args.amount > 0),
  },
  {
    id: "payment-transfer",
    label: "Payment transfer",
    tool: "create_transfer",
    schema: z.object({
      amount: z.number().positive("amount must be greater than 0").max(100000),
      currency: z.enum(["INR", "USD", "EUR", "GBP"], { errorMap: () => ({ message: "currency must be one of INR, USD, EUR, GBP" }) }),
      executeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "executeOn must be YYYY-MM-DD"),
    }),
    bad: { amount: -250, currency: "RUPEES", executeOn: "yesterday" },
    good: { amount: 250, currency: "INR", executeOn: "2026-11-01" },
    downstream: (args) => ({ ok: true, note: "transfer queued" }),
    isBad: (args) => !(args.amount > 0) || !["INR", "USD", "EUR", "GBP"].includes(args.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(String(args.executeOn)),
  },
  {
    id: "coding-agent-loop",
    label: "Coding agent",
    tool: "run_query",
    schema: z.object({
      table: z.enum(["orders", "customers", "invoices"], { errorMap: () => ({ message: "table must be one of orders, customers, invoices" }) }),
      limit: z.number().int().min(1).max(1000, "limit must be between 1 and 1000"),
    }),
    bad: { table: "order_items_v2", limit: 100000 },
    good: { table: "orders", limit: 100 },
    downstream: (args) => ({ ok: true, note: "query executed" }),
    isBad: (args) => !["orders", "customers", "invoices"].includes(args.table) || !(args.limit >= 1 && args.limit <= 1000),
  },
];

// ---- Agents ----
// "stubborn": repeats the same bad call every turn (the classic retry loop).
// "self-correcting": sends the bad call once, reads the error, then sends the good call.
async function runWithoutGate(s, agent) {
  let turns = 0, reachedBad = 0, downstreamCalls = 0;
  while (turns < MAX_TURNS) {
    turns++;
    const args = agent === "stubborn" ? s.bad : turns === 1 ? s.bad : s.good;
    downstreamCalls++;
    if (s.isBad(args)) reachedBad++;
    s.downstream(args); // no gate: whatever the model sends goes straight through
    if (agent === "self-correcting" && turns === 2) break;
    // naive system accepts everything, so a stubborn model never gets feedback and never stops by itself
  }
  return { turns, downstreamCalls, reachedBad };
}

async function runWithGate(s, agent) {
  const gate = new AgenticGate({ maxConsecutiveFailures: 3 });
  let downstreamCalls = 0;
  gate.registerTool({
    name: s.tool,
    schema: s.schema,
    execute: async (args) => { downstreamCalls++; return s.downstream(args); },
  });
  let turns = 0, reachedBad = 0, circuitOpenAtTurn = null, lastError = null, firstError = null;
  while (turns < MAX_TURNS) {
    turns++;
    const args = agent === "stubborn" ? s.bad : turns === 1 ? s.bad : s.good;
    const before = downstreamCalls;
    const r = await gate.interceptAndExecute(s.tool, args);
    if (downstreamCalls > before && s.isBad(args)) reachedBad++;
    if (!r.success) { lastError = r.error; if (!firstError) firstError = r.error; }
    if (r.success) break; // self-corrected and succeeded
    if (r.error && r.error.startsWith("[Circuit Breaker OPEN]")) { circuitOpenAtTurn = turns; break; } // harness stops the agent
  }
  return { turns, downstreamCalls, reachedBad, circuitOpenAtTurn, firstError, lastError };
}

const results = [];
for (const s of scenarios) {
  const loopNo = await runWithoutGate(s, "stubborn");
  const loopYes = await runWithGate(s, "stubborn");
  const fixNo = await runWithoutGate(s, "self-correcting");
  const fixYes = await runWithGate(s, "self-correcting");
  results.push({ id: s.id, label: s.label, loop: { without: loopNo, with: loopYes }, selfCorrect: { without: fixNo, with: fixYes } });
}

const total = (pick) => results.reduce((a, r) => a + pick(r), 0);
const summary = {
  maxTurns: MAX_TURNS,
  maxConsecutiveFailures: 3,
  loop: {
    badCallsReachedSystemWithout: total((r) => r.loop.without.reachedBad),
    badCallsReachedSystemWith: total((r) => r.loop.with.reachedBad),
    modelTurnsWithout: total((r) => r.loop.without.turns),
    modelTurnsWith: total((r) => r.loop.with.turns),
  },
  selfCorrect: {
    badCallsReachedSystemWithout: total((r) => r.selfCorrect.without.reachedBad),
    badCallsReachedSystemWith: total((r) => r.selfCorrect.with.reachedBad),
  },
};
// ---- Stage breakdown: valid calls must pass, invalid calls must be stopped, and we report which stage decided ----
// A gate that rejects everything also scores 0 bad executions, so valid-call acceptance is measured too.
async function runCase(c) {
  let invocations = 0, reason = "accepted";
  const gate = new AgenticGate({
    maxConsecutiveFailures: 3,
    validateTimeoutMs: 50,
    onGateFailure: (e) => { reason = e.reason; },
  });
  gate.registerTool({
    name: "issue_refund",
    schema: scenarios[0].schema,
    validate: c.validate,
    execute: async () => { invocations++; return { ok: true }; },
  });
  const r = await gate.interceptAndExecute("issue_refund", c.args);
  return { name: c.name, expectInvocations: c.expect, invocations, stage: reason, pass: invocations === c.expect, error: r.error ?? null };
}

const knownOrders = new Set(["ORD-482913"]);
const lookup = async ({ orderId }) => { if (!knownOrders.has(orderId)) throw new Error(`Order '${orderId}' does not exist`); };
const hang = () => new Promise(() => {});
const caseList = [
  { name: "negative amount", args: { orderId: "ORD-482913", amount: -5 }, validate: lookup, expect: 0 },
  { name: "valid amount + existing order", args: { orderId: "ORD-482913", amount: 40 }, validate: lookup, expect: 1 },
  { name: "valid amount + nonexistent order", args: { orderId: "ORD-000001", amount: 40 }, validate: lookup, expect: 0 },
  { name: "valid amount + validator timeout", args: { orderId: "ORD-482913", amount: 40 }, validate: hang, expect: 0 },
  { name: "valid call as JSON string", args: '{"orderId":"ORD-482913","amount":40}', validate: lookup, expect: 1 },
  { name: "truncated JSON string", args: '{"orderId":"ORD-482913","amount":4', validate: lookup, expect: 0 },
];
const cases = [];
for (const c of caseList) cases.push(await runCase(c));

// Reworded repeats: same bad call with key order and an irrelevant extra key varied each turn.
// The breaker counts consecutive failures per tool, so rewording does not reset or evade it.
async function runReworded() {
  let invocations = 0, circuitOpenAtTurn = null;
  const gate = new AgenticGate({ maxConsecutiveFailures: 3 });
  gate.registerTool({ name: "issue_refund", schema: scenarios[0].schema, execute: async () => { invocations++; return { ok: true }; } });
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const args = turn % 2 ? { orderId: "latest", amount: -1 } : { amount: -1, note: `try ${turn}`, orderId: "latest" };
    const r = await gate.interceptAndExecute("issue_refund", args);
    if (r.error?.startsWith("[Circuit Breaker OPEN]")) { circuitOpenAtTurn = turn; break; }
  }
  return { invocations, circuitOpenAtTurn };
}
const reworded = await runReworded();

const validCases = cases.filter((c) => c.expectInvocations === 1);
const invalidCases = cases.filter((c) => c.expectInvocations === 0);
const stageSummary = {
  validCallAcceptanceRate: `${validCases.filter((c) => c.invocations === 1).length}/${validCases.length}`,
  invalidCallEscapeRate: `${invalidCases.filter((c) => c.invocations > 0).length}/${invalidCases.length}`,
  rewordedRepeat: reworded,
};

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ summary, results, stageSummary, cases }, null, 2));
console.log(JSON.stringify({ summary, results, stageSummary, cases }, null, 2));
