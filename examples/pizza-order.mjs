import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AgenticGate } from "../dist/index.js"; // use "agentic-gate" instead when installed via npm
import { z } from "zod";

// A domain that has nothing to do with AWS/infrastructure — just to show the
// gate is provider- and domain-agnostic: it validates whatever schema you give it.

const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const gate = new AgenticGate({
  maxConsecutiveFailures: 3,
  onGateFailure: (e) => console.log(`   📉 telemetry: ${e.reason} failure #${e.consecutiveFailures} for "${e.toolName}"`),
  onGateSuccess: (e) => console.log(`   📈 telemetry: success for "${e.toolName}"`),
});

gate.registerTool({
  name: "order_pizza",
  schema: z.object({
    size: z.enum(["small", "medium", "large"], {
      errorMap: () => ({ message: "size must be one of: small, medium, large" }),
    }),
    quantity: z.number().int().min(1).max(10, "quantity cannot exceed 10 pizzas per order"),
    toppings: z.array(z.enum(["pepperoni", "mushroom", "onion", "olives", "extra-cheese"]))
      .max(5, "you can pick at most 5 toppings"),
  }),
  execute: async ({ size, quantity, toppings }) => {
    console.log(`   🍕 [Kitchen]: Firing ${quantity}x ${size} pizza(s) with [${toppings.join(", ")}]...`);
    return { status: "confirmed", orderId: "PZA-" + Math.floor(Math.random() * 100000), size, quantity, toppings };
  },
});

const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "order_pizza",
        description: "Places a pizza order.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              size: { type: "string", description: "Pizza size" },
              quantity: { type: "number", description: "Number of pizzas" },
              toppings: { type: "array", items: { type: "string" }, description: "List of toppings" },
            },
            required: ["size", "quantity", "toppings"],
          },
        },
      },
    },
  ],
};

async function runEngine() {
  const prompt =
    "I'm throwing a huge party — order me 50 party-size pizzas loaded with every topping you can think of: pepperoni, mushroom, onion, olives, extra-cheese, pineapple, and jalapenos.";
  console.log(`\n🚀 Starting Engine Execution for Prompt: "${prompt}"`);
  console.log(`📡 Using Bedrock Model: ${MODEL_ID}\n`);

  const messages = [{ role: "user", content: [{ text: prompt }] }];
  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;
    console.log(`--- Loop Attempt ${attempts}/${MAX_RETRIES} ---`);

    const response = await bedrockClient.send(
      new ConverseCommand({ modelId: MODEL_ID, messages, toolConfig })
    );
    const assistantMessage = response.output.message;
    messages.push(assistantMessage);

    const toolUseBlock = assistantMessage.content.find((block) => block.toolUse);

    if (!toolUseBlock) {
      const textOutput = assistantMessage.content.find((block) => block.text)?.text;
      console.log(`\n🤖 [Model Response]:\n${textOutput}\n`);
      break;
    }

    const { toolUseId, name: toolName, input: rawInput } = toolUseBlock.toolUse;
    console.log(`[Bedrock Tool Requested]: "${toolName}" with input:`, rawInput);

    const gateResult = await gate.interceptAndExecute(toolName, rawInput);

    if (gateResult.success) {
      console.log(`✅ [Validation Gate PASSED]: Order placed!`, gateResult.data);
      messages.push({
        role: "user",
        content: [{ toolResult: { toolUseId, status: "success", content: [{ json: gateResult.data }] } }],
      });
    } else {
      console.log(`❌ ${gateResult.error}`);
      messages.push({
        role: "user",
        content: [{ toolResult: { toolUseId, status: "error", content: [{ text: gateResult.error }] } }],
      });
    }
  }
}

runEngine().catch(console.error);
