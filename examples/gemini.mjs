import { GoogleGenAI } from "@google/genai";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// 1. Initialize the Gemini client (reads GEMINI_API_KEY from env)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_ID = "gemini-3.6-flash";

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

// 3. Define the Gemini function declaration matching the Zod schema
const restartEc2Declaration = {
  name: "restart_ec2_instance",
  description: "Restarts a specific AWS EC2 instance in a supported region.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      instanceId: { type: "string", description: "The EC2 instance ID (e.g., i-0123456789abcdef0)" },
      region: { type: "string", description: "The target AWS region" }
    },
    required: ["instanceId", "region"]
  }
};

// 4. Main Deterministic Execution Loop
async function runEngine() {
  const prompt = "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Gemini Model: ${MODEL_ID}\n`);

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;
    console.log(`--- Loop Attempt ${attempts}/${MAX_RETRIES} ---`);

    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: {
        tools: [{ functionDeclarations: [restartEc2Declaration] }]
      }
    });

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      console.log(`\n🤖 [Model Response]:\n${response.text}\n`);
      break;
    }

    const call = functionCalls[0];
    // Push the model's response verbatim (not a reconstructed part) — Gemini 3.x
    // models attach a thoughtSignature to functionCall parts that must be replayed
    // back unchanged, or the next call is rejected with a 400.
    contents.push(response.candidates[0].content);

    console.log(`[Gemini Tool Requested]: "${call.name}" with input:`, call.args);

    // Intercept tool execution using the AgenticGate
    const gateResult = await gate.interceptAndExecute(call.name, call.args);

    if (gateResult.success) {
      console.log(`✅ [Validation Gate PASSED]: Execution Successful!`);
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: { result: gateResult.data } } }]
      });
    } else {
      console.log(`❌ ${gateResult.error}`);
      // Inject validation error trace back into history for model self-correction
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: { error: gateResult.error } } }]
      });
    }
  }
}

runEngine().catch(console.error);
