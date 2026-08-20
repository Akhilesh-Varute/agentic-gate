import OpenAI from "openai";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { handleResponse } from "../dist/adapters/openai.js"; // "agentic-gate/adapters/openai" once installed via npm
import { z } from "zod";

// Same openai adapter as examples/openai-adapter.mjs, but pointed at a local
// Ollama server instead of api.openai.com — proves the adapter works against
// any OpenAI-compatible endpoint, not just OpenAI itself, since it only
// depends on the response object's shape, not the openai package's origin.

const MODEL_ID = "qwen2.5:0.5b";

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

const tools = [
  {
    type: "function",
    function: {
      name: "restart_ec2_instance",
      description: "Restarts a specific AWS EC2 instance in a supported region.",
      parameters: {
        type: "object",
        properties: {
          instanceId: { type: "string", description: "The EC2 instance ID (e.g., i-0123456789abcdef0)" },
          region: { type: "string", description: "The target AWS region" }
        },
        required: ["instanceId", "region"]
      }
    }
  }
];

async function runEngine() {
  // The official openai client, pointed at a local Ollama server instead of api.openai.com.
  const client = new OpenAI({ baseURL: "http://localhost:11434/v1", apiKey: "ollama" });

  const prompt = "Restart EC2 instance i-0123456789abcdef0 in region eu-central-1. Use the restart_ec2_instance tool.";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using local Ollama model: ${MODEL_ID}\n`);

  const messages = [{ role: "user", content: prompt }];
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`--- Loop Attempt ${attempt}/${MAX_RETRIES} ---`);

    const response = await client.chat.completions.create({ model: MODEL_ID, messages, tools });
    console.log("Raw tool_calls from Ollama:", JSON.stringify(response.choices[0].message.tool_calls));

    const outcome = await handleResponse(gate, response);
    messages.push(...outcome.messages);

    if (outcome.done) {
      console.log(`\n🤖 [Model Response]:\n${outcome.text}\n`);
      break;
    }
  }
}

runEngine().catch(console.error);
