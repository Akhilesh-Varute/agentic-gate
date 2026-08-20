from types import SimpleNamespace

from pydantic import BaseModel

from agentic_gate import AgenticGate
from agentic_gate.adapters.gemini import handle_response


class DoubleArgs(BaseModel):
    x: int


async def _double(args: DoubleArgs):
    return args.x * 2


def make_gate():
    gate = AgenticGate()
    gate.register_tool("double", DoubleArgs, execute=_double)
    return gate


async def test_done_true_when_no_function_calls_returns_final_text():
    gate = make_gate()
    candidate_content = SimpleNamespace(role="model", parts=[SimpleNamespace(text="All done.")])
    response = SimpleNamespace(function_calls=[], text="All done.", candidates=[SimpleNamespace(content=candidate_content)])

    outcome = await handle_response(gate, response)

    assert outcome.done is True
    assert outcome.text == "All done."
    assert outcome.messages == [candidate_content]


async def test_a_valid_function_call_returns_model_turn_plus_user_turn_with_function_response():
    gate = make_gate()
    candidate_content = SimpleNamespace(role="model", parts=[SimpleNamespace()], thought_signature="sig-123")
    call = SimpleNamespace(name="double", args={"x": 5})
    response = SimpleNamespace(function_calls=[call], candidates=[SimpleNamespace(content=candidate_content)])

    outcome = await handle_response(gate, response)

    assert outcome.done is False
    # The model turn must be replayed verbatim (including thought_signature).
    assert outcome.messages[0] is candidate_content
    assert outcome.messages[1] == {
        "role": "user",
        "parts": [{"function_response": {"name": "double", "response": {"result": 10}}}],
    }


async def test_an_invalid_function_call_produces_a_function_response_carrying_the_gate_error():
    gate = make_gate()
    candidate_content = SimpleNamespace(role="model", parts=[])
    call = SimpleNamespace(name="double", args={"x": "bad"})
    response = SimpleNamespace(function_calls=[call], candidates=[SimpleNamespace(content=candidate_content)])

    outcome = await handle_response(gate, response)

    function_response = outcome.messages[1]["parts"][0]["function_response"]
    assert "Validation Gate Failed" in function_response["response"]["error"]


async def test_multiple_function_calls_all_land_in_one_user_turn_as_separate_parts():
    gate = make_gate()
    candidate_content = SimpleNamespace(role="model", parts=[])
    calls = [SimpleNamespace(name="double", args={"x": 1}), SimpleNamespace(name="double", args={"x": 2})]
    response = SimpleNamespace(function_calls=calls, candidates=[SimpleNamespace(content=candidate_content)])

    outcome = await handle_response(gate, response)

    assert len(outcome.messages[1]["parts"]) == 2
    results = [p["function_response"]["response"]["result"] for p in outcome.messages[1]["parts"]]
    assert results == [2, 4]
