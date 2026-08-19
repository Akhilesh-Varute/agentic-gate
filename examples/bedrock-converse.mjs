import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// 1. Initialize AWS Bedrock Client
const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

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
    // Downstream execution (e.g., AWS SDK call)
    console.log(`⚡ [Safe Execution]: Calling AWS EC2 SDK to restart ${instanceId} in ${region}...`);
    return { status: "success", instanceId, region, action: "reboot_initiated" };
  }
});

// 3. Define Bedrock Tool Spec matching the Zod schema
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

// 4. Main Deterministic Execution Loop
async function runEngine() {
  const prompt = "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Bedrock Model: ${MODEL_ID}\n`);

  const messages = [
    {
      role: "user",
      content: [{ text: prompt }]
    }
  ];

  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;
    console.log(`--- Loop Attempt ${attempts}/${MAX_RETRIES} ---`);

    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: messages,
      toolConfig: toolConfig
    });

    const response = await bedrockClient.send(command);
    const assistantMessage = response.output.message;
    messages.push(assistantMessage);

    // Check if the LLM requested a tool execution
    const toolUseBlock = assistantMessage.content.find((block) => block.toolUse);

    if (!toolUseBlock) {
      // Final textual response from the model
      const textOutput = assistantMessage.content.find((block) => block.text)?.text;
      console.log(`\n🤖 [Model Response]:\n${textOutput}\n`);
      break;
    }

    const { toolUseId, name: toolName, input: rawInput } = toolUseBlock.toolUse;
    console.log(`[Bedrock Tool Requested]: "${toolName}" with input:`, rawInput);

    // Intercept tool execution using the AgenticGate
    const gateResult = await gate.interceptAndExecute(toolName, rawInput);

    if (gateResult.success) {
      console.log(`✅ [Validation Gate PASSED]: Execution Successful!`);
      messages.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: toolUseId,
              status: "success",
              content: [{ json: gateResult.data }]
            }
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
            toolResult: {
              toolUseId: toolUseId,
              status: "error",
              content: [{ text: gateResult.error }]
            }
          }
        ]
      });
    }
  }
}

runEngine().catch(console.error);