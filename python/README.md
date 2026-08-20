# agentic-gate (Python)

[![PyPI version](https://img.shields.io/pypi/v/agentic-gate.svg)](https://pypi.org/project/agentic-gate/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Deterministic schema validation gates and circuit breakers for LLM function calling — a Pydantic-based port of the [`agentic-gate`](https://www.npmjs.com/package/agentic-gate) npm package. Same engine, same guarantees, Python API.

See the [main repo README](https://github.com/Akhilesh-Varute/agentic-gate) for the full problem statement and architecture diagram. This document covers the Python-specific API.

## Install

```bash
pip install agentic-gate
```

The only dependency is `pydantic>=2.0.0`.

## Quick start

```python
import asyncio
from typing import Literal
from pydantic import BaseModel
from agentic_gate import AgenticGate

class RestartEc2Args(BaseModel):
    instance_id: str
    region: Literal["us-east-1", "us-west-2", "ap-south-1"]

async def restart_ec2(args: RestartEc2Args):
    # Your real downstream call (boto3, an HTTP client, etc.)
    return {"status": "success", "instance_id": args.instance_id, "region": args.region}

async def main():
    gate = AgenticGate()
    gate.register_tool("restart_ec2_instance", RestartEc2Args, execute=restart_ec2)

    # Feed it raw, untrusted arguments straight from the LLM's tool-call payload
    result = await gate.intercept_and_execute(
        "restart_ec2_instance",
        {"instance_id": "i-0123456789abcdef0", "region": "eu-central-1"},  # not in the enum
    )

    if not result.success:
        print(result.error)
        # "[Validation Gate Failed]: region: Input should be 'us-east-1', 'us-west-2' or 'ap-south-1'"
        # Feed this string back into the LLM's message history so it can self-correct.

asyncio.run(main())
```

## Circuit breaker + telemetry

```python
gate = AgenticGate(
    max_consecutive_failures=3,  # 0 disables the breaker
    on_gate_failure=lambda e: metrics.increment(f"gate.failure.{e.reason}", tags={"tool": e.tool_name}),
    on_gate_success=lambda e: metrics.increment("gate.success", tags={"tool": e.tool_name}),
)

# After 3 consecutive failures for "restart_ec2_instance", the gate short-circuits:
# GateResult(success=False, error="[Circuit Breaker OPEN]: Tool 'restart_ec2_instance' has failed 3 consecutive times...")

gate.reset_circuit("restart_ec2_instance")  # once the underlying issue is fixed
```

## Async external-state validation

Pydantic only checks the *shape* of the arguments — it can't tell you whether
`i-0123456789abcdef0` is an EC2 instance that actually exists. For that, pass
a `validate` callback: it runs after the schema passes and before `execute`,
and raising rejects the call exactly like a schema failure (same circuit
breaker, same telemetry, reason `"async-validation"`):

```python
import boto3

ec2 = boto3.client("ec2")

async def validate_instance_exists(args: RestartEc2Args):
    response = ec2.describe_instances(InstanceIds=[args.instance_id])
    if not response["Reservations"]:
        raise ValueError(f"Instance '{args.instance_id}' does not exist in {args.region}")

gate.register_tool(
    "restart_ec2_instance",
    RestartEc2Args,
    execute=restart_ec2,
    validate=validate_instance_exists,
)
```

## Less boilerplate with an adapter

Wiring the gate into a real provider loop means pulling the tool call out of
the response, running the gate, and rebuilding a provider-shaped result
message every time. `agentic_gate.adapters.*` does that for you — one per
provider, since each has its own response shape:

```python
from agentic_gate.adapters.bedrock import handle_response
# or .openai, .anthropic, .gemini

for attempt in range(1, MAX_RETRIES + 1):
    response = client.converse(modelId=MODEL_ID, messages=messages, toolConfig=tool_config)
    outcome = await handle_response(gate, response)
    messages.extend(outcome.messages)

    if outcome.done:
        print(outcome.text)
        break
```

Each adapter works off the response object's shape (dict *or* the SDK's own
Pydantic-style attribute access — both are supported) rather than importing
the provider's SDK, so none of them add a dependency. Available for
`bedrock`, `openai`, `anthropic`, and `gemini`; see
[`examples/`](./examples) for a runnable script per provider (`bedrock_converse.py` and
`gemini_example.py` are verified against real APIs; `openai_example.py` and
`anthropic_example.py` follow the identical, SDK-verified pattern).

## API

### `AgenticGate(max_consecutive_failures=3, on_gate_success=None, on_gate_failure=None)`

- `max_consecutive_failures` — trips the circuit breaker after this many
  consecutive failures for a given tool. `0` disables it.
- `on_gate_success(event: GateSuccessEvent)` / `on_gate_failure(event: GateFailureEvent)` —
  telemetry hooks called on every `intercept_and_execute`.

### `gate.register_tool(name, schema, execute, validate=None)`

- `schema` — a Pydantic `BaseModel` subclass.
- `execute(args: schema) -> Awaitable[Any]` — runs only if validation (and
  `validate`, if given) succeeds.
- `validate(args: schema) -> Awaitable[None]` — optional; raise to reject.

### `await gate.intercept_and_execute(tool_name, raw_arguments) -> GateResult`

`GateResult` has `success: bool`, `data: Any | None`, `error: str | None`.

### `gate.reset_circuit(tool_name)`

Manually clears a tool's failure count, e.g. after fixing the underlying issue.

## Development

```bash
cd python
python -m venv .venv
./.venv/bin/pip install -e ".[dev]"   # Windows: .venv\Scripts\pip
pytest
```

## License

MIT — see [LICENSE](./LICENSE).
