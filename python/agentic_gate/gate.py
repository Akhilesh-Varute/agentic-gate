from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional, Type

from pydantic import BaseModel, ValidationError

from .types import GateFailureEvent, GateFailureReason, GateResult, GateSuccessEvent, ToolDefinition

DEFAULT_MAX_CONSECUTIVE_FAILURES = 3


class AgenticGate:
    def __init__(
        self,
        max_consecutive_failures: int = DEFAULT_MAX_CONSECUTIVE_FAILURES,
        on_gate_success: Optional[Callable[[GateSuccessEvent], None]] = None,
        on_gate_failure: Optional[Callable[[GateFailureEvent], None]] = None,
    ) -> None:
        self._tools: Dict[str, ToolDefinition] = {}
        self._consecutive_failures: Dict[str, int] = {}
        self._max_consecutive_failures = max_consecutive_failures
        self._on_gate_success = on_gate_success
        self._on_gate_failure = on_gate_failure

    def register_tool(
        self,
        name: str,
        schema: Type[BaseModel],
        execute: Callable[[BaseModel], Awaitable[Any]],
        validate: Optional[Callable[[BaseModel], Awaitable[None]]] = None,
    ) -> None:
        """Registers a tool with its validation schema and execution function."""
        self._tools[name] = ToolDefinition(name=name, schema=schema, execute=execute, validate=validate)

    def reset_circuit(self, tool_name: str) -> None:
        """Manually resets the circuit breaker's failure count for a tool,
        e.g. after an operator has addressed the underlying issue."""
        self._consecutive_failures.pop(tool_name, None)

    async def intercept_and_execute(self, tool_name: str, raw_arguments: Any) -> GateResult:
        """Intercepts raw tool arguments from an LLM, validates them against the
        registered Pydantic schema (and the tool's optional async validate()
        check), and executes the downstream tool only if both succeed."""
        tool = self._tools.get(tool_name)

        if tool is None:
            return self._fail(
                tool_name,
                raw_arguments,
                "unregistered",
                f"Tool '{tool_name}' is not registered in the validation engine.",
            )

        # Step 0: Circuit Breaker — refuse to touch the schema/execute() once a
        # tool has failed too many times in a row, to stop runaway LLM retry loops.
        if self._is_circuit_open(tool_name):
            failures = self._consecutive_failures.get(tool_name, 0)
            return self._fail(
                tool_name,
                raw_arguments,
                "circuit-open",
                f"[Circuit Breaker OPEN]: Tool '{tool_name}' has failed {failures} consecutive "
                f'times. Call gate.reset_circuit("{tool_name}") once the underlying issue is resolved.',
            )

        # Step 1: Intercept & Validate
        try:
            parsed = tool.schema.model_validate(raw_arguments)
        except ValidationError as err:
            formatted = "; ".join(
                f"{'.'.join(str(loc) for loc in e['loc']) or 'parameter'}: {e['msg']}" for e in err.errors()
            )
            return self._fail(tool_name, raw_arguments, "validation", f"[Validation Gate Failed]: {formatted}")

        # Step 2: Async External-State Validation (e.g. does this resource actually exist?)
        if tool.validate is not None:
            try:
                await tool.validate(parsed)
            except Exception as err:  # noqa: BLE001 - deliberately broad, mirrors execute()'s catch
                return self._fail(tool_name, raw_arguments, "async-validation", f"[Async Validation Failed]: {err}")

        # Step 3: Safe Downstream Execution
        try:
            output = await tool.execute(parsed)
            self._consecutive_failures.pop(tool_name, None)
            if self._on_gate_success:
                self._on_gate_success(GateSuccessEvent(tool_name=tool_name, args=parsed, data=output))
            return GateResult(success=True, data=output)
        except Exception as err:  # noqa: BLE001 - deliberately broad, mirrors gate.ts's catch
            return self._fail(tool_name, raw_arguments, "execution", f"[Execution Failed]: {err}")

    def _is_circuit_open(self, tool_name: str) -> bool:
        if self._max_consecutive_failures <= 0:
            return False
        return self._consecutive_failures.get(tool_name, 0) >= self._max_consecutive_failures

    def _fail(self, tool_name: str, args: Any, reason: GateFailureReason, error: str) -> GateResult:
        if reason == "unregistered":
            consecutive_failures = 0
        else:
            consecutive_failures = self._consecutive_failures.get(tool_name, 0) + 1
            self._consecutive_failures[tool_name] = consecutive_failures

        if self._on_gate_failure:
            self._on_gate_failure(
                GateFailureEvent(
                    tool_name=tool_name,
                    args=args,
                    error=error,
                    reason=reason,
                    consecutive_failures=consecutive_failures,
                )
            )
        return GateResult(success=False, error=error)
