from __future__ import annotations

from typing import Any

from ..gate import AgenticGate
from ._util import get
from .types import AdapterOutcome


async def handle_response(gate: AgenticGate, response: Any) -> AdapterOutcome:
    """Runs every function call in a Gemini generateContent response through
    the gate and returns the entries to append to your `contents` list: the
    model's own turn (replayed verbatim — the actual SDK object, not a
    reconstructed dict, since Gemini 3.x attaches a thought_signature that
    must round-trip unchanged) plus one user turn carrying a
    function_response part per call."""
    function_calls = get(response, "function_calls") or []
    model_content = get(get(response, "candidates")[0], "content")

    if not function_calls:
        return AdapterOutcome(done=True, text=get(response, "text") or "", messages=[model_content])

    parts = []
    for call in function_calls:
        name = get(call, "name")
        args = get(call, "args")
        gate_result = await gate.intercept_and_execute(name, args)

        parts.append(
            {
                "function_response": {
                    "name": name,
                    "response": {"result": gate_result.data} if gate_result.success else {"error": gate_result.error},
                }
            }
        )

    return AdapterOutcome(done=False, messages=[model_content, {"role": "user", "parts": parts}])
