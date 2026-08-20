import { GoogleGenAI } from "@google/genai";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// 1. Initialize the Gemini client (reads GEMINI_API_KEY from env)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_ID = "gemini-3.6-flash";

// 2. Instantiate and Configure the Deterministic AgenticGate
const gate = new AgenticGate();

gate.registerTool({
  name: "launch_satellite",
  schema: z.object({
    name: z.string().max(30, "satellite name cannot exceed 30 characters"),
    orbit: z.enum(["LEO", "MEO", "GEO"], {
      errorMap: () => ({ message: "orbit must be one of: LEO, MEO, GEO" })
    }),
    payloadKg: z.number().positive().max(500, "payload cannot exceed 500kg for this launch vehicle")
  }),
  execute: async ({ name, orbit, payloadKg }) => {
    console.log(`🚀 [Launch Control]: Igniting boosters for "${name}" -> ${orbit} orbit with a ${payloadKg}kg payload...`);
    return { status: "launched", missionId: "MSN-" + Math.floor(Math.random() * 100000), name, orbit, payloadKg };
  }
});

// 3. Define the Gemini function declaration matching the Zod schema
const launchSatelliteDeclaration = {
  name: "launch_satellite",
  description: "Schedules a satellite launch into a given orbit.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Satellite name" },
      orbit: { type: "string", description: "Target orbit" },
      payloadKg: { type: "number", description: "Payload mass in kilograms" }
    },
    required: ["name", "orbit", "payloadKg"]
  }
};

// 4. Main Deterministic Execution Loop
async function runEngine() {
  const prompt =
    "Launch a satellite named 'Ultra Deep Space Explorer XL-9000 Mark II' into a deep interstellar orbit, carrying a 5000kg payload.";
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
        tools: [{ functionDeclarations: [launchSatelliteDeclaration] }]
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
