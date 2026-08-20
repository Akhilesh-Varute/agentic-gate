from pydantic import BaseModel

from agentic_gate import AgenticGate
from agentic_gate.adapters.bedrock import handle_response


class DoubleArgs(BaseModel):
    x: int


async def _double(args: DoubleArgs):
    return args.x * 2


def make_gate():
    gate = AgenticGate()
    gate.register_tool("double", DoubleArgs, execute=_double)
    return gate


async def test_done_true_when_no_tool_use_block_returns_final_text():
    gate = make_gate()
    assistant_message = {"role": "assistant", "content": [{"text": "All done."}]}
    response = {"output": {"message": assistant_message}}

    outcome = await handle_response(gate, response)

    assert outcome.done is True
    assert outcome.text == "All done."
    assert outcome.messages == [assistant_message]


async def test_a_valid_tool_use_returns_assistant_message_plus_user_message_with_tool_result():
    gate = make_gate()
    assistant_message = {
        "role": "assistant",
        "content": [{"toolUse": {"toolUseId": "tu_1", "name": "double", "input": {"x": 5}}}],
    }
    response = {"output": {"message": assistant_message}}

    outcome = await handle_response(gate, response)

    assert outcome.done is False
    assert outcome.messages[0] == assistant_message
    assert outcome.messages[1] == {
        "role": "user",
        "content": [{"toolResult": {"toolUseId": "tu_1", "status": "success", "content": [{"json": 10}]}}],
    }


async def test_an_invalid_tool_use_produces_a_tool_result_with_status_error():
    gate = make_gate()
    assistant_message = {
        "role": "assistant",
        "content": [{"toolUse": {"toolUseId": "tu_2", "name": "double", "input": {"x": "bad"}}}],
    }
    response = {"output": {"message": assistant_message}}

    outcome = await handle_response(gate, response)

    tool_result = outcome.messages[1]["content"][0]["toolResult"]
    assert tool_result["status"] == "error"
    assert "Validation Gate Failed" in tool_result["content"][0]["text"]


async def test_multiple_tool_use_blocks_all_land_in_one_user_message():
    gate = make_gate()
    assistant_message = {
        "role": "assistant",
        "content": [
            {"toolUse": {"toolUseId": "tu_a", "name": "double", "input": {"x": 1}}},
            {"toolUse": {"toolUseId": "tu_b", "name": "double", "input": {"x": 2}}},
        ],
    }
    response = {"output": {"message": assistant_message}}

    outcome = await handle_response(gate, response)

    assert len(outcome.messages) == 2
    assert len(outcome.messages[1]["content"]) == 2
    results = [c["toolResult"]["content"][0]["json"] for c in outcome.messages[1]["content"]]
    assert results == [2, 4]
