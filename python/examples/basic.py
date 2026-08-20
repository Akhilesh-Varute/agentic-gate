import asyncio
import re
from typing import Literal

from pydantic import BaseModel, field_validator

from agentic_gate import AgenticGate


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


async def main():
    gate = AgenticGate(
        max_consecutive_failures=3,
        on_gate_failure=lambda e: print(f"   telemetry: {e.reason} failure #{e.consecutive_failures} for '{e.tool_name}'"),
        on_gate_success=lambda e: print(f"   telemetry: success for '{e.tool_name}'"),
    )
    gate.register_tool("restart_ec2_instance", RestartEc2Args, execute=restart_ec2)

    # Simulates an LLM's raw tool-call payload, including a hallucinated region.
    result = await gate.intercept_and_execute(
        "restart_ec2_instance", {"instance_id": "i-0123456789abcdef0", "region": "eu-central-1"}
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
