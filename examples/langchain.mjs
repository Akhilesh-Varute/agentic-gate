import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// This example shows AgenticGate wrapped *inside* a LangChain tool's own
// handler, rather than manually parsing tool_calls off a raw model response
// like the other provider examples do — the pattern you'd actually use if
// your agent is built with LangChain/LangGraph.

const gate = new AgenticGate({
  onGateFailure: (e) => console.log(`   📉 telemetry: ${e.reason} failure #${e.consecutiveFailures} for "${e.toolName}"`),
  onGateSuccess: (e) => console.log(`   📈 telemetry: success for "${e.toolName}"`),
});

gate.registerTool({
  name: "adopt_pet",
  schema: z.object({
    species: z.enum(["dog", "cat", "rabbit", "parrot"], {
      errorMap: () => ({ message: "species must be one of: dog, cat, rabbit, parrot" })
    }),
    ageYears: z.number().int().min(0).max(20, "ageYears cannot exceed 20"),
    name: z.string().max(20, "pet name cannot exceed 20 characters")
  }),
  execute: async ({ species, ageYears, name }) => {
    console.log(`🐾 [Shelter]: Finalizing adoption of ${name} the ${ageYears}-year-old ${species}...`);
    return { status: "adopted", petId: "PET-" + Math.floor(Math.random() * 100000), species, ageYears, name };
  }
});

// The LangChain-facing tool schema is deliberately loose (plain string/number,
// no enum or bounds) — same pattern as the other examples' provider toolConfig.
// The *strict* schema above, enforced by the gate, is the real authority.
const adoptPetTool = tool(
  async (args) => {
    const result = await gate.interceptAndExecute("adopt_pet", args);
    return JSON.stringify(result);
  },
  {
    name: "adopt_pet",
    description: "Adopts a pet from the shelter.",
    schema: z.object({
      species: z.string().describe("The species of pet"),
      ageYears: z.number().describe("The pet's age in years"),
      name: z.string().describe("The name to give the pet")
    })
  }
);

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.6-flash"
}).bindTools([adoptPetTool]);

async function runEngine() {
  const prompt =
    "I'd like to adopt a 45 year old baby dragon named 'Sir Reginald Fluffington the Third of House Emberscale'.";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using LangChain + Gemini Model: gemini-3.6-flash\n`);

  const messages = [new HumanMessage(prompt)];
  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;
    console.log(`--- Loop Attempt ${attempts}/${MAX_RETRIES} ---`);

    const response = await model.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n🤖 [Model Response]:\n${response.content}\n`);
      break;
    }

    const call = response.tool_calls[0];
    console.log(`[LangChain Tool Requested]: "${call.name}" with input:`, call.args);

    // tool.invoke(toolCall) runs the handler above (which calls the gate) and
    // wraps the result in a ToolMessage ready to push back into the transcript.
    const toolMessage = await adoptPetTool.invoke(call);
    const gateResult = JSON.parse(toolMessage.content);

    if (gateResult.success) {
      console.log(`✅ [Validation Gate PASSED]: Execution Successful!`);
    } else {
      console.log(`❌ ${gateResult.error}`);
    }

    messages.push(toolMessage);
  }
}

runEngine().catch(console.error);
