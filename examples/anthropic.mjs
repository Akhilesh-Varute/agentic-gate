import Anthropic from "@anthropic-ai/sdk";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// 1. Initialize Anthropic Client (reads ANTHROPIC_API_KEY from env)
const anthropic = new Anthropic();
const MODEL_ID = "claude-sonnet-5";

// 2. Instantiate and Configure the Deterministic AgenticGate
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

// 3. Define the Anthropic tool spec matching the Zod schema
const tools = [
  {
    name: "restart_ec2_instance",
    description: "Restarts a specific AWS EC2 instance in a supported region.",
    input_schema: {
      type: "object",
      properties: {
        instanceId: { type: "string", description: "The EC2 instance ID (e.g., i-0123456789abcdef0)" },
        region: { type: "string", description: "The target AWS region" }
      },
      required: ["instanceId", "region"]
    }
  }
];

// 4. Main Deterministic Execution Loop
async function runEngine() {
  const prompt = "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Anthropic Model: ${MODEL_ID}\n`);

  const messages = [{ role: "user", content: prompt }];

  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;
    console.log(`--- Loop Attempt ${attempts}/${MAX_RETRIES} ---`);

    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      messages,
      tools
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlock = response.content.find((block) => block.type === "tool_use");

    if (!toolUseBlock) {
      const textOutput = response.content.find((block) => block.type === "text")?.text;
      console.log(`\n🤖 [Model Response]:\n${textOutput}\n`);
      break;
    }

    console.log(`[Anthropic Tool Requested]: "${toolUseBlock.name}" with input:`, toolUseBlock.input);

    // Intercept tool execution using the AgenticGate
    const gateResult = await gate.interceptAndExecute(toolUseBlock.name, toolUseBlock.input);

    if (gateResult.success) {
      console.log(`✅ [Validation Gate PASSED]: Execution Successful!`);
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(gateResult.data)
          }
        ]
      });
    } else {
      console.log(`❌ ${gateResult.error}`);
      // Inject validation error trace back into history for model self-correction
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseBlock.id,
            content: gateResult.error,
            is_error: true
          }
        ]
      });
    }
  }
}

runEngine().catch(console.error);
