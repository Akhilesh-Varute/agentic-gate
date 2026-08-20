import asyncio
import os
import re
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, field_validator

from agentic_gate import AgenticGate
from agentic_gate.adapters.openai import handle_response

MODEL_ID = "gpt-4o"


class RestartEc2Args(BaseModel):
    instance_id: str
    region: Literal["us-east-1", "us-west-2", "ap-south-1"]

    @field_validator("instance_id")
    @classmethod
    def validate_instance_id(cls, value: str) -> str:
        if not re.match(r"^i-[a-f0-9]{8,17}$", value):
            raise ValueError("Invalid AWS EC2 Instance ID format")
        return value


async def restart_ec2(args: RestartEc2Args):
    print(f"[Safe Execution]: Calling AWS EC2 SDK to restart {args.instance_id} in {args.region}...")
    return {"status": "success", "instance_id": args.instance_id, "region": args.region}


tools = [
    {
        "type": "function",
        "function": {
            "name": "restart_ec2_instance",
            "description": "Restarts a specific AWS EC2 instance in a supported region.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instance_id": {"type": "string", "description": "The EC2 instance ID"},
                    "region": {"type": "string", "description": "The target AWS region"},
                },
                "required": ["instance_id", "region"],
            },
        },
    }
]


async def main():
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    gate = AgenticGate()
    gate.register_tool("restart_ec2_instance", RestartEc2Args, execute=restart_ec2)

    prompt = "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)"
    print(f"\nStarting Engine Execution for Prompt: \"{prompt}\"")
    print(f"Using OpenAI Model: {MODEL_ID}\n")

    messages = [{"role": "user", "content": prompt}]

    for attempt in range(1, 4):
        print(f"--- Loop Attempt {attempt}/3 ---")
        response = client.chat.completions.create(model=MODEL_ID, messages=messages, tools=tools)
        outcome = await handle_response(gate, response)
        messages.extend(outcome.messages)

        if outcome.done:
            print(f"\n[Model Response]:\n{outcome.text}\n")
            break


if __name__ == "__main__":
    asyncio.run(main())
