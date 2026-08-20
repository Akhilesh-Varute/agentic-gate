import pytest
from pydantic import BaseModel

from agentic_gate import AgenticGate


class DoubleArgs(BaseModel):
    x: int


async def test_passes_valid_input_through_to_execute_and_returns_its_result():
    gate = AgenticGate()
    gate.register_tool("double", DoubleArgs, execute=lambda args: _double(args))

    result = await gate.intercept_and_execute("double", {"x": 5})

    assert result.success is True
    assert result.data == 10


async def _double(args: DoubleArgs):
    return args.x * 2


async def test_rejects_invalid_input_before_execute_runs():
    gate = AgenticGate()
    executed = False

    async def execute(args: DoubleArgs):
        nonlocal executed
        executed = True
        return args.x * 2

    gate.register_tool("double", DoubleArgs, execute=execute)

    result = await gate.intercept_and_execute("double", {"x": "not-a-number"})

    assert result.success is False
    assert "Validation Gate Failed" in result.error
    assert executed is False


async def test_returns_an_error_for_an_unregistered_tool():
    gate = AgenticGate()
    result = await gate.intercept_and_execute("nope", {})
    assert result.success is False
    assert "not registered" in result.error


async def test_surfaces_execute_raising_as_an_execution_failure():
    class EmptyArgs(BaseModel):
        pass

    gate = AgenticGate()

    async def boom(_args: EmptyArgs):
        raise RuntimeError("downstream API down")

    gate.register_tool("boom", EmptyArgs, execute=boom)

    result = await gate.intercept_and_execute("boom", {})

    assert result.success is False
    assert "Execution Failed" in result.error
    assert "downstream API down" in result.error


async def test_validate_runs_after_schema_validation_and_before_execute():
    calls = []

    class RestartArgs(BaseModel):
        instance_id: str

    async def validate(args: RestartArgs):
        calls.append("validate")
        if args.instance_id != "i-real":
            raise ValueError(f"instance '{args.instance_id}' does not exist")

    async def execute(args: RestartArgs):
        calls.append("execute")
        return {"restarted": args.instance_id}

    gate = AgenticGate()
    gate.register_tool("restart_instance", RestartArgs, execute=execute, validate=validate)

    result = await gate.intercept_and_execute("restart_instance", {"instance_id": "i-real"})

    assert result.success is True
    assert result.data == {"restarted": "i-real"}
    assert calls == ["validate", "execute"]


async def test_validate_raising_rejects_the_call_before_execute_runs():
    class RestartArgs(BaseModel):
        instance_id: str

    executed = False

    async def validate(args: RestartArgs):
        if args.instance_id != "i-real":
            raise ValueError(f"instance '{args.instance_id}' does not exist")

    async def execute(args: RestartArgs):
        nonlocal executed
        executed = True
        return {"restarted": args.instance_id}

    gate = AgenticGate()
    gate.register_tool("restart_instance", RestartArgs, execute=execute, validate=validate)

    result = await gate.intercept_and_execute("restart_instance", {"instance_id": "i-fake"})

    assert result.success is False
    assert "Async Validation Failed" in result.error
    assert "does not exist" in result.error
    assert executed is False


async def test_failing_validate_counts_toward_circuit_breaker_and_fires_on_gate_failure():
    class RestartArgs(BaseModel):
        instance_id: str

    events = []

    async def validate(_args: RestartArgs):
        raise ValueError("instance does not exist")

    async def execute(args: RestartArgs):
        return {"restarted": args.instance_id}

    gate = AgenticGate(max_consecutive_failures=1, on_gate_failure=lambda e: events.append(e))
    gate.register_tool("restart_instance", RestartArgs, execute=execute, validate=validate)

    await gate.intercept_and_execute("restart_instance", {"instance_id": "i-fake"})
    tripped = await gate.intercept_and_execute("restart_instance", {"instance_id": "i-fake"})

    assert events[0].reason == "async-validation"
    assert events[0].consecutive_failures == 1
    assert "Circuit Breaker OPEN" in tripped.error


async def test_circuit_breaker_trips_after_max_consecutive_failures_and_blocks_further_calls():
    class FlakyArgs(BaseModel):
        x: int

    execute_calls = 0

    async def execute(_args: FlakyArgs):
        nonlocal execute_calls
        execute_calls += 1
        return "ok"

    gate = AgenticGate(max_consecutive_failures=2)
    gate.register_tool("flaky", FlakyArgs, execute=execute)

    await gate.intercept_and_execute("flaky", {"x": "bad"})
    await gate.intercept_and_execute("flaky", {"x": "bad"})

    tripped = await gate.intercept_and_execute("flaky", {"x": 1})

    assert tripped.success is False
    assert "Circuit Breaker OPEN" in tripped.error
    assert execute_calls == 0


async def test_reset_circuit_re_enables_a_tripped_tool():
    class FlakyArgs(BaseModel):
        x: int

    async def execute(args: FlakyArgs):
        return args.x

    gate = AgenticGate(max_consecutive_failures=1)
    gate.register_tool("flaky", FlakyArgs, execute=execute)

    await gate.intercept_and_execute("flaky", {"x": "bad"})
    blocked = await gate.intercept_and_execute("flaky", {"x": 1})
    assert blocked.success is False

    gate.reset_circuit("flaky")
    recovered = await gate.intercept_and_execute("flaky", {"x": 1})
    assert recovered.success is True
    assert recovered.data == 1


async def test_a_success_resets_the_consecutive_failure_count():
    class SometimesArgs(BaseModel):
        x: int

    async def execute(args: SometimesArgs):
        return args.x

    gate = AgenticGate(max_consecutive_failures=2)
    gate.register_tool("sometimes", SometimesArgs, execute=execute)

    await gate.intercept_and_execute("sometimes", {"x": "bad"})  # fail 1
    await gate.intercept_and_execute("sometimes", {"x": 1})  # success -> resets count
    await gate.intercept_and_execute("sometimes", {"x": "bad"})  # fail 1 again, not fail 2

    still_open = await gate.intercept_and_execute("sometimes", {"x": 2})
    assert still_open.success is True


async def test_max_consecutive_failures_zero_disables_the_circuit_breaker():
    class AlwaysFailsArgs(BaseModel):
        x: int

    async def execute(args: AlwaysFailsArgs):
        return args.x

    gate = AgenticGate(max_consecutive_failures=0)
    gate.register_tool("always_fails", AlwaysFailsArgs, execute=execute)

    for _ in range(10):
        result = await gate.intercept_and_execute("always_fails", {"x": "bad"})
        assert "Circuit Breaker OPEN" not in (result.error or "")


async def test_on_gate_success_and_on_gate_failure_hooks_fire_with_the_right_event_shape():
    class HookedArgs(BaseModel):
        x: int

    events = []

    async def execute(args: HookedArgs):
        return args.x

    gate = AgenticGate(
        max_consecutive_failures=1,
        on_gate_success=lambda e: events.append(("success", e)),
        on_gate_failure=lambda e: events.append(("failure", e)),
    )
    gate.register_tool("hooked", HookedArgs, execute=execute)

    await gate.intercept_and_execute("hooked", {"x": "bad"})  # validation failure, trips circuit
    await gate.intercept_and_execute("hooked", {"x": 1})  # circuit-open failure
    gate.reset_circuit("hooked")
    await gate.intercept_and_execute("hooked", {"x": 1})  # success

    kinds = [(kind, getattr(event, "reason", None)) for kind, event in events]
    assert kinds == [("failure", "validation"), ("failure", "circuit-open"), ("success", None)]
    assert events[0][1].consecutive_failures == 1
    assert events[2][1].data == 1
