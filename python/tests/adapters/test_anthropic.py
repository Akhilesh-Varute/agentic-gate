import json
from types import SimpleNamespace

from pydantic import BaseModel

from agentic_gate import AgenticGate
from agentic_gate.adapters.anthropic import handle_response


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
    response = SimpleNamespace(content=[SimpleNamespace(type="text", text="All done.")])

    outcome = await handle_response(gate, response)

    assert outcome.done is True
    assert outcome.text == "All done."


async def test_a_valid_tool_use_returns_assistant_turn_plus_user_turn_with_tool_result():
    gate = make_gate()
    block = SimpleNamespace(type="tool_use", id="toolu_1", name="double", input={"x": 5})
    response = SimpleNamespace(content=[block])

    outcome = await handle_response(gate, response)

    assert outcome.done is False
    assert outcome.messages[1]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "toolu_1",
        "content": json.dumps(10),
    }


async def test_an_invalid_tool_use_produces_a_tool_result_with_is_error_true():
    gate = make_gate()
    block = SimpleNamespace(type="tool_use", id="toolu_2", name="double", input={"x": "bad"})
    response = SimpleNamespace(content=[block])

    outcome = await handle_response(gate, response)

    result = outcome.messages[1]["content"][0]
    assert result["is_error"] is True
    assert "Validation Gate Failed" in result["content"]


async def test_multiple_tool_use_blocks_all_land_in_one_user_turn():
    gate = make_gate()
    blocks = [
        SimpleNamespace(type="tool_use", id="toolu_a", name="double", input={"x": 1}),
        SimpleNamespace(type="tool_use", id="toolu_b", name="double", input={"x": 2}),
    ]
    response = SimpleNamespace(content=blocks)

    outcome = await handle_response(gate, response)

    assert len(outcome.messages) == 2
    assert len(outcome.messages[1]["content"]) == 2
    assert [r["content"] for r in outcome.messages[1]["content"]] == [json.dumps(2), json.dumps(4)]


async def test_works_with_a_plain_dict_response_too():
    gate = make_gate()
    response = {"content": [{"type": "tool_use", "id": "toolu_x", "name": "double", "input": {"x": 3}}]}

    outcome = await handle_response(gate, response)

    assert outcome.messages[1]["content"][0]["content"] == json.dumps(6)
