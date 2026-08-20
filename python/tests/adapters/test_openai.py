import json
from types import SimpleNamespace

from pydantic import BaseModel

from agentic_gate import AgenticGate
from agentic_gate.adapters.openai import handle_response


class DoubleArgs(BaseModel):
    x: int


async def _double(args: DoubleArgs):
    return args.x * 2


def make_gate():
    gate = AgenticGate()
    gate.register_tool("double", DoubleArgs, execute=_double)
    return gate


class FakeMessage(BaseModel):
    role: str = "assistant"
    content: str | None = None
    tool_calls: list | None = None


async def test_done_true_and_no_tool_calls_returns_final_text_and_the_raw_message():
    gate = make_gate()
    message = FakeMessage(content="All done.")
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])

    outcome = await handle_response(gate, response)

    assert outcome.done is True
    assert outcome.text == "All done."
    assert outcome.messages == [message.model_dump(exclude_none=True)]


async def test_a_valid_tool_call_is_executed_and_returns_assistant_message_plus_tool_result():
    gate = make_gate()
    tool_call = SimpleNamespace(id="call_1", function=SimpleNamespace(name="double", arguments=json.dumps({"x": 5})))
    message = FakeMessage(tool_calls=[tool_call])
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])

    outcome = await handle_response(gate, response)

    assert outcome.done is False
    assert outcome.messages[1] == {"role": "tool", "tool_call_id": "call_1", "content": json.dumps(10)}


async def test_an_invalid_tool_calls_gate_error_is_fed_back_as_tool_message_content():
    gate = make_gate()
    tool_call = SimpleNamespace(id="call_2", function=SimpleNamespace(name="double", arguments=json.dumps({"x": "bad"})))
    message = FakeMessage(tool_calls=[tool_call])
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])

    outcome = await handle_response(gate, response)

    assert outcome.messages[1]["tool_call_id"] == "call_2"
    assert "Validation Gate Failed" in outcome.messages[1]["content"]


async def test_multiple_tool_calls_each_get_their_own_tool_result_message():
    gate = make_gate()
    calls = [
        SimpleNamespace(id="call_a", function=SimpleNamespace(name="double", arguments=json.dumps({"x": 1}))),
        SimpleNamespace(id="call_b", function=SimpleNamespace(name="double", arguments=json.dumps({"x": 2}))),
    ]
    message = FakeMessage(tool_calls=calls)
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])

    outcome = await handle_response(gate, response)

    assert len(outcome.messages) == 3
    assert [m["content"] for m in outcome.messages[1:]] == [json.dumps(2), json.dumps(4)]


async def test_works_with_a_plain_dict_response_too():
    gate = make_gate()
    response = {"choices": [{"message": {"role": "assistant", "content": "Hi there."}}]}

    outcome = await handle_response(gate, response)

    assert outcome.done is True
    assert outcome.text == "Hi there."
