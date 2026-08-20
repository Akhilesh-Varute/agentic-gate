import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { handleResponse } from "../dist/adapters/bedrock.js"; // "agentic-gate/adapters/bedrock" once installed via npm
import { z } from "zod";

// Same scenario as examples/bedrock-converse.mjs, but using the bedrock
// adapter to collapse the manual toolUse-parsing + message-rebuilding loop.

const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const gate = new AgenticGate();

gate.registerTool({
  name: "restart_ec2_instance",
  schema: z.object({
    instanceId: z.string().regex(/^i-[a-f0-9]{8,17}$/, "Invalid AWS EC2 Instance ID format"),
    region: z.enum(["us-east-1", "us-west-2", "ap-south-1"], {
      errorMap: () => ({ message: "Region must be one of: us-east-1, us-west-2, ap-south-1" })
    })
  }),
  execute: async ({ instanceId, region }) => {
    console.log(`⚡ [Safe Execution]: Calling AWS EC2 SDK to restart ${instanceId} in ${region}...`);
    return { status: "success", instanceId, region, action: "reboot_initiated" };
  }
});

const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "restart_ec2_instance",
        description: "Restarts a specific AWS EC2 instance in a supported region.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              instanceId: { type: "string", description: "The EC2 instance ID (e.g., i-0123456789abcdef0)" },
              region: { type: "string", description: "The target AWS region" }
            },
            required: ["instanceId", "region"]
          }
        }
      }
    }
  ]
};

async function runEngine() {
  const prompt = "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Bedrock Model: ${MODEL_ID}\n`);

  const messages = [{ role: "user", content: [{ text: prompt }] }];
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`--- Loop Attempt ${attempt}/${MAX_RETRIES} ---`);

    const response = await bedrockClient.send(new ConverseCommand({ modelId: MODEL_ID, messages, toolConfig }));
    const outcome = await handleResponse(gate, response);
    messages.push(...outcome.messages);

    if (outcome.done) {
      console.log(`\n🤖 [Model Response]:\n${outcome.text}\n`);
      break;
    }
  }
}

runEngine().catch(console.error);
