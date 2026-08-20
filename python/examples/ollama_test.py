import asyncio
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel

from agentic_gate import AgenticGate
from agentic_gate.adapters.openai import handle_response

MODEL_ID = "qwen2.5:0.5b"


class RestartEc2Args(BaseModel):
    instance_id: str
    region: Literal["us-east-1", "us-west-2", "ap-south-1"]


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
    # The official openai client, pointed at a local Ollama server instead of api.openai.com.
    client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
    gate = AgenticGate()
    gate.register_tool("restart_ec2_instance", RestartEc2Args, execute=restart_ec2)

    prompt = "Restart EC2 instance i-0123456789abcdef0 in region eu-central-1. Use the restart_ec2_instance tool."
    print(f"\nStarting Engine Execution for Prompt: \"{prompt}\"")
    print(f"Using local Ollama model: {MODEL_ID}\n")

    messages = [{"role": "user", "content": prompt}]

    response = client.chat.completions.create(model=MODEL_ID, messages=messages, tools=tools)
    print("Raw tool_calls from Ollama:", response.choices[0].message.tool_calls)

    outcome = await handle_response(gate, response)
    messages.extend(outcome.messages)

    print("\nAdapter outcome:", outcome)


if __name__ == "__main__":
    asyncio.run(main())
