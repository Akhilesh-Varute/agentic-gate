import dotenv from "dotenv";
dotenv.config();

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

// Initialize AWS Bedrock Client via local AWS CLI credentials
const bedrockClient = new BedrockRuntimeClient({ 
  region: process.env.AWS_REGION || "us-east-1" 
});

const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// 1. Define Strict Zod Schema for Tool Parameters
const EC2RestartSchema = z.object({
  instanceId: z.string().regex(/^i-[a-f0-9]{8,17}$/, "Invalid AWS Instance ID format (must start with i- followed by hex chars)"),
  region: z.enum(["us-east-1", "us-west-2", "ap-south-1"], {
    errorMap: () => ({ message: "Region must be one of: us-east-1, us-west-2, ap-south-1" })
  }),
  force: z.boolean().default(false)
});

// 2. Define Bedrock Tool Spec (for Claude via Converse API)
const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "restart_ec2_instance",
        description: "Restarts an AWS EC2 instance in a specified region.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              instanceId: { type: "string", description: "The EC2 instance ID (e.g., i-0123456789abcdef0)" },
              region: { type: "string", description: "AWS region name (e.g., ap-south-1)" },
              force: { type: "boolean", description: "Force stop instance if non-responsive" }
            },
            required: ["instanceId", "region"]
          }
        }
      }
    }
  ]
};

// 3. Simulated Tool Execution Function
async function executeEC2Restart(validArgs) {
  console.log(`\n⚙️ [AWS API CALL SIMULATION] Restarting EC2 ${validArgs.instanceId} in ${validArgs.region}...`);
  return { status: "SUCCESS", instanceId: validArgs.instanceId, state: "rebooting" };
}

// 4. Deterministic State Engine
export async function runAgentLoop(userPrompt, maxRetries = 3) {
  let attempt = 0;
  let messages = [{ role: "user", content: [{ text: userPrompt }] }];

  console.log(`\n🚀 Starting Engine Execution for Prompt: "${userPrompt}"`);
  console.log(`📡 Using Bedrock Model: ${MODEL_ID}`);

  while (attempt < maxRetries) {
    attempt++;
    console.log(`\n--- Loop Attempt ${attempt}/${maxRetries} ---`);

    try {
      // Step A: Invoke Bedrock Converse API
      const command = new ConverseCommand({
        modelId: MODEL_ID, 
        messages: messages,
        toolConfig: toolConfig
      });

      const response = await bedrockClient.send(command);
      const outputMessage = response.output.message;
      messages.push(outputMessage);

      // Step B: Check if Model Requested a Tool Call
      const toolUseContent = outputMessage.content.find(c => c.toolUse);

      if (!toolUseContent) {
        // Normal text response (e.g., when model explains that the region is unsupported)
        const textResponse = outputMessage.content.find(c => c.text)?.text;
        console.log(`\n🤖 [Model Feedback]: ${textResponse}`);
        return { status: "COMPLETED", response: textResponse, attemptsUsed: attempt };
      }

      const { toolUseId, name: toolName, input: rawToolInput } = toolUseContent.toolUse;
      console.log(`[Bedrock Tool Requested]: "${toolName}" with input:`, rawToolInput);

      // Step C: Schema Validation Gate (Zod)
      if (toolName === "restart_ec2_instance") {
        const validation = EC2RestartSchema.safeParse(rawToolInput);

        if (validation.success) {
          console.log(`✅ [Validation Gate PASSED]: Schema parameters are valid.`);
          
          const executionResult = await executeEC2Restart(validation.data);

          messages.push({
            role: "user",
            content: [{
              toolResult: {
                toolUseId: toolUseId,
                status: "success",
                content: [{ json: executionResult }]
              }
            }]
          });

          return { status: "SUCCESS", result: executionResult, attemptsUsed: attempt };

        } else {
          const errorList = validation.error.issues.map(i => i.message).join("; ");
          console.warn(`❌ [Validation Gate FAILED]: ${errorList}`);

          // Feedback validation error into message history so Bedrock can self-correct
          messages.push({
            role: "user",
            content: [{
              toolResult: {
                toolUseId: toolUseId,
                status: "error",
                content: [{ text: `Validation Error: ${errorList}. Valid regions are us-east-1, us-west-2, or ap-south-1.` }]
              }
            }]
          });

          // Continue loop for attempt 2
          continue;
        }
      }

    } catch (err) {
      console.error(`🚨 Runtime Exception in Engine Loop:`, err.message);
      break;
    }
  }

  // Circuit Breaker Triggered
  console.error(`\n🚨 [Circuit Breaker Triggered] Max retries (${maxRetries}) reached without valid tool payload.`);
  return { status: "CIRCUIT_BREAKER_TRIGGERED", attemptsUsed: attempt };
}

// Demo Test Call
runAgentLoop("Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)");