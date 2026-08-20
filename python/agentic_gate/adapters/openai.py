from __future__ import annotations

import json
from typing import Any

from ..gate import AgenticGate
from ._util import get, to_plain
from .types import AdapterOutcome


async def handle_response(gate: AgenticGate, response: Any) -> AdapterOutcome:
    """Runs every tool call in an OpenAI chat completion response through the
    gate and returns the messages to append to your conversation: the
    assistant's own message, plus one "tool" role message per call carrying
    either the execution result or the gate's rejection error for the model
    to read.

    Accepts either the raw `openai` SDK response object or an equivalent
    plain dict (e.g. if you're calling the API directly)."""
    message = get(get(response, "choices")[0], "message")
    tool_calls = get(message, "tool_calls") or []

    if not tool_calls:
        return AdapterOutcome(done=True, text=get(message, "content") or "", messages=[to_plain(message)])

    messages: list = [to_plain(message)]

    for call in tool_calls:
        function = get(call, "function")
        name = get(function, "name")
        raw_args = json.loads(get(function, "arguments"))
        gate_result = await gate.intercept_and_execute(name, raw_args)

        messages.append(
            {
                "role": "tool",
                "tool_call_id": get(call, "id"),
                "content": json.dumps(gate_result.data) if gate_result.success else gate_result.error,
            }
        )

    return AdapterOutcome(done=False, messages=messages)
