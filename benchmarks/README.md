# Benchmark: what the gate stops

A small, reproducible benchmark of agentic-gate's validation and circuit breaker.

**What is real:** the gate, the Zod schemas and the circuit breaker (this repo's `dist/`).
**What is simulated:** the model. It is a script, not an LLM, so the results are exactly repeatable. The "downstream system" is a stand-in that accepts whatever it is given.

## Scenarios

| Scenario | Tool | Bad payload the simulated model sends |
|---|---|---|
| Support refund | `issue_refund` | `orderId: "the latest order"`, `amount: "about 40"` |
| Payment transfer | `create_transfer` | `amount: -250`, `currency: "RUPEES"`, `executeOn: "yesterday"` |
| Coding agent | `run_query` | `table: "order_items_v2"`, `limit: 100000` |

Two agent behaviours are tested for each scenario:

- **Stubborn loop:** the model resends the same bad call every turn (capped at 50 turns).
- **Self-correcting:** the model sends one bad call, reads the error, then sends a valid call.

## Run it

```bash
npm install
npm run build
node benchmarks/bench.mjs
```

Results are printed and written to `benchmarks/results.json`.

## Results (as published)

In a 50-attempt loop, across three scenarios:

| | Without a gate | With agentic-gate |
|---|---|---|
| Bad calls that reached the downstream system | 150 | 0 |
| Model turns before the loop stopped | 50 per scenario (the cap) | 4 per scenario |

With a self-correcting model, the bad first call reached the downstream system in all 3 scenarios without a gate, and in none with it.

The circuit breaker uses its default of 3 consecutive failures: calls 1 to 3 are rejected by validation, and call 4 is rejected by the open breaker, which is where the harness stops the agent.

## Stage breakdown

The headline numbers only count bad calls blocked, and a gate that rejects everything would score 0 there too. So the benchmark also runs valid calls that must reach the tool, and reports which stage decided each call (refund tool, with a lookup-style `validate()`):

| Case | Tool invocations | Stage |
|---|---|---|
| Negative amount | 0 | `validation` |
| Valid amount, existing order | 1 | accepted |
| Valid amount, nonexistent order | 0 | `async-validation` |
| Valid amount, validator timeout | 0 | `validation-unavailable` |
| Valid call as a JSON string | 1 | accepted |
| Truncated JSON string | 0 | `parse` |

Result: valid-call acceptance 2/2, invalid-call escape 0/4.

**Reworded repeats:** the same bad call resent with key order and an irrelevant extra key changed each turn still trips the breaker on turn 4, because it counts consecutive failures per tool, not per argument hash.

## Notes

- "Without a gate" means calls go straight to the downstream function, with no validation.
- These numbers show what the gate blocks in a controlled setup. They are not a claim about token cost or about any specific model.
