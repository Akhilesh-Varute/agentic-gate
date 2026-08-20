import asyncio
import os
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from agentic_gate import AgenticGate
from agentic_gate.adapters.gemini import handle_response

MODEL_ID = "gemini-3.6-flash"


class LaunchSatelliteArgs(BaseModel):
    name: str = Field(max_length=30)
    orbit: Literal["LEO", "MEO", "GEO"]
    payload_kg: float = Field(gt=0, le=500)


async def launch_satellite(args: LaunchSatelliteArgs):
    print(f"[Launch Control]: Igniting boosters for '{args.name}' -> {args.orbit} orbit with a {args.payload_kg}kg payload...")
    return {"status": "launched", "name": args.name, "orbit": args.orbit, "payload_kg": args.payload_kg}


launch_satellite_declaration = {
    "name": "launch_satellite",
    "description": "Schedules a satellite launch into a given orbit.",
    "parameters_json_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Satellite name"},
            "orbit": {"type": "string", "description": "Target orbit"},
            "payload_kg": {"type": "number", "description": "Payload mass in kilograms"},
        },
        "required": ["name", "orbit", "payload_kg"],
    },
}


async def main():
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    gate = AgenticGate()
    gate.register_tool("launch_satellite", LaunchSatelliteArgs, execute=launch_satellite)

    prompt = (
        "Launch a satellite named 'Ultra Deep Space Explorer XL-9000 Mark II' into a deep "
        "interstellar orbit, carrying a 5000kg payload."
    )
    print(f"\nStarting Engine Execution for Prompt: \"{prompt}\"")
    print(f"Using Gemini Model: {MODEL_ID}\n")

    contents = [{"role": "user", "parts": [{"text": prompt}]}]

    for attempt in range(1, 4):
        print(f"--- Loop Attempt {attempt}/3 ---")
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=contents,
            config=types.GenerateContentConfig(
                tools=[types.Tool(function_declarations=[launch_satellite_declaration])]
            ),
        )
        outcome = await handle_response(gate, response)
        contents.extend(outcome.messages)

        if outcome.done:
            print(f"\n[Model Response]:\n{outcome.text}\n")
            break


if __name__ == "__main__":
    asyncio.run(main())
