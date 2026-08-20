from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional, Type

from pydantic import BaseModel

GateFailureReason = Literal["unregistered", "validation", "async-validation", "execution", "circuit-open"]


@dataclass
class ToolDefinition:
    name: str
    schema: Type[BaseModel]
    execute: Callable[[BaseModel], Awaitable[Any]]
    # Optional async check against real external state, run after the schema
    # passes but before execute() — e.g. confirming an EC2 instance ID actually
    # exists via boto3 before allowing the action to proceed. Raise an
    # exception (with a message safe to feed back to the LLM) to reject the
    # call; returning normally allows execute() to run.
    validate: Optional[Callable[[BaseModel], Awaitable[None]]] = None


@dataclass
class GateResult:
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None


@dataclass
class GateSuccessEvent:
    tool_name: str
    args: Any
    data: Any


@dataclass
class GateFailureEvent:
    tool_name: str
    args: Any
    error: str
    reason: GateFailureReason
    consecutive_failures: int
