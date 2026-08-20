from __future__ import annotations

from typing import Any

from ..gate import AgenticGate
from ._util import get
from .types import AdapterOutcome


async def handle_response(gate: AgenticGate, response: Any) -> AdapterOutcome:
    """Runs every toolUse block in an AWS Bedrock Converse API response
    (as returned by boto3's bedrock-runtime client) through the gate and
    returns the messages to append: the assistant's own message (replayed
    verbatim) plus one user message carrying a toolResult block per call —
    Bedrock requires all toolResults for one assistant turn to arrive
    together in a single user message."""
    assistant_message = response["output"]["message"]
    content = assistant_message["content"]
    tool_use_blocks = [block for block in content if "toolUse" in block]

    if not tool_use_blocks:
        text = next((block["text"] for block in content if "text" in block), "")
        return AdapterOutcome(done=True, text=text, messages=[assistant_message])

    tool_results = []
    for block in tool_use_blocks:
        tool_use = block["toolUse"]
        tool_use_id, name, tool_input = tool_use["toolUseId"], tool_use["name"], tool_use["input"]
        gate_result = await gate.intercept_and_execute(name, tool_input)

        tool_results.append(
            {
                "toolResult": {
                    "toolUseId": tool_use_id,
                    "status": "success" if gate_result.success else "error",
                    "content": [{"json": gate_result.data}] if gate_result.success else [{"text": gate_result.error}],
                }
            }
        )

    return AdapterOutcome(done=False, messages=[assistant_message, {"role": "user", "content": tool_results}])
