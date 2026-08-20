from __future__ import annotations

import json
from typing import Any

from ..gate import AgenticGate
from ._util import get, to_plain
from .types import AdapterOutcome


async def handle_response(gate: AgenticGate, response: Any) -> AdapterOutcome:
    """Runs every tool_use block in an Anthropic Messages API response
    through the gate and returns the messages to append: the assistant's own
    turn (content replayed verbatim) plus one user turn carrying a
    tool_result block per call — Anthropic requires all tool_results for one
    assistant turn to arrive together in a single user message.

    Accepts either the raw `anthropic` SDK response object or an equivalent
    plain dict."""
    content = get(response, "content")
    tool_use_blocks = [block for block in content if get(block, "type") == "tool_use"]

    if not tool_use_blocks:
        text = next((get(block, "text") for block in content if get(block, "type") == "text"), "")
        return AdapterOutcome(done=True, text=text or "", messages=[{"role": "assistant", "content": [to_plain(b) for b in content]}])

    tool_results = []
    for block in tool_use_blocks:
        name = get(block, "name")
        tool_input = get(block, "input")
        gate_result = await gate.intercept_and_execute(name, tool_input)

        result_block = {
            "type": "tool_result",
            "tool_use_id": get(block, "id"),
            "content": json.dumps(gate_result.data) if gate_result.success else gate_result.error,
        }
        if not gate_result.success:
            result_block["is_error"] = True
        tool_results.append(result_block)

    return AdapterOutcome(
        done=False,
        messages=[
            {"role": "assistant", "content": [to_plain(b) for b in content]},
            {"role": "user", "content": tool_results},
        ],
    )
