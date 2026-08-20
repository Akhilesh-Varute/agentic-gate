import { GoogleGenAI } from "@google/genai";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { handleResponse } from "../dist/adapters/gemini.js"; // "agentic-gate/adapters/gemini" once installed via npm
import { z } from "zod";

// Same scenario as examples/gemini.mjs, but using the gemini adapter to
// collapse the manual functionCall-parsing + message-rebuilding loop (which
// also takes care of replaying the thoughtSignature-bearing turn verbatim).

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_ID = "gemini-3.6-flash";

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

async function runEngine() {
  const prompt =
    "Launch a satellite named 'Ultra Deep Space Explorer XL-9000 Mark II' into a deep interstellar orbit, carrying a 5000kg payload.";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Gemini Model: ${MODEL_ID}\n`);

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`--- Loop Attempt ${attempt}/${MAX_RETRIES} ---`);

    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: { tools: [{ functionDeclarations: [launchSatelliteDeclaration] }] }
    });
    const outcome = await handleResponse(gate, response);
    contents.push(...outcome.messages);

    if (outcome.done) {
      console.log(`\n🤖 [Model Response]:\n${outcome.text}\n`);
      break;
    }
  }
}

runEngine().catch(console.error);
