# 🛡️ Agentic Deterministic State Engine

> **A production-ready, model-agnostic proxy engine that enforces strict runtime execution bounds, schema validation gates, and self-correction loops for LLM Function Calling.**

[![npm version](https://img.shields.io/npm/v/agentic-gate.svg)](https://www.npmjs.com/package/agentic-gate)
[![npm downloads](https://img.shields.io/npm/dm/agentic-gate.svg)](https://www.npmjs.com/package/agentic-gate)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![AWS Bedrock](https://img.shields.io/badge/AWS%20Bedrock-Converse%20API-orange.svg)](https://aws.amazon.com/bedrock/)
[![Zod](https://img.shields.io/badge/Zod-Schema%20Validation-blue.svg)](https://zod.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📌 Problem Statement

LLM Agentic Function Calling (Tools) is inherently non-deterministic:
* **Hallucinated Arguments:** Models frequently output invalid parameters (e.g., non-existent regions, malformed UUIDs, out-of-bound dates).
* **Infinite Loops:** When a tool call fails, agents often re-issue the exact same broken payload indefinitely.
* **Unsafe Execution:** Executing unvalidated tool calls directly against downstream infrastructure (AWS, SQL databases, payment gateways) risks severe operational failure.

---

## 💡 Solution Architecture

This repository implements a **Deterministic State Engine** sitting between the user/application and downstream infrastructure tools. It intercepts every tool invocation requested by the LLM, passes it through a local **Zod Schema Validation Gate**, and manages a stateful retry loop with error feedback injection.

```
                      ┌─────────────────────────────────┐
                      │    User Input / System Prompt   │
                      └────────────────┬────────────────┘
                                       │
                                       ▼
                      ┌─────────────────────────────────┐
                      │   LLM Provider (Bedrock/OpenAI) │
                      └────────────────┬────────────────┘
                                       │
                                       ▼  (Tool Use Requested)
                      ┌─────────────────────────────────┐
                      │    DETERMINISTIC STATE ENGINE   │
                      │                                 │
                      │   ┌─────────────────────────┐   │
                      │   │  Zod Validation Gate    │   │
                      │   └────────────┬────────────┘   │
                      └────────────────┼────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
             [Schema PASSED]                     [Schema FAILED]
                     │                                   │
                     ▼                                   ▼
        ┌─────────────────────────┐         ┌─────────────────────────┐
        │  Execute Downstream API │         │ Inject Error Feedback   │
        │  (AWS EC2, DB, etc.)    │         │ into Message History    │
        ┌─────────────────────────┐         └────────────┬────────────┘
                     │                                   │
                     ▼                                   ▼
        ┌─────────────────────────┐         ┌─────────────────────────┐
        │     Return Success      │         │ Loop (Max Retries Check)│
        └─────────────────────────┘         └─────────────────────────┘
```

```mermaid
flowchart TD
    A[LLM Provider<br/>Bedrock / OpenAI / Anthropic / Gemini] -->|Tool Use Requested| B[Interceptor Gate]
    B --> C{Zod Schema<br/>Validation}
    C -->|PASSED| D[Execute Downstream Tool<br/>AWS API / DB / Payment Gateway]
    C -->|FAILED| E[Inject Error Feedback<br/>into Message History]
    E -->|Retry within maxRetries| A
    D --> F[Return Result to Caller]
```

---

## Key Features

* 🛡️ **Zero-Trust Validation Gate:** Uses Zod schemas to intercept and validate parameters locally *before* hitting downstream APIs.
* 🔄 **Self-Correction Feedback Loop:** Feeds exact schema validation error traces back into the conversation history, allowing the LLM to self-correct in subsequent attempts.
* ⚡ **Circuit Breaker:** After `maxConsecutiveFailures` (default `3`) failures in a row for the same tool, the gate trips and rejects further calls *before* touching the schema or `execute()` — stopping runaway LLM retry loops without your own bookkeeping. Reset with `gate.resetCircuit(toolName)`.
* 📡 **Telemetry Hooks:** `onGateSuccess` / `onGateFailure` callbacks fire on every call, so you can export metrics to OpenTelemetry, Datadog, CloudWatch, or plain logs.
* 🔍 **Async External-State Validation:** Add an optional `validate()` hook per tool to check real external state (e.g. does this EC2 instance ID actually exist) before `execute()` runs — a rejected `validate()` counts as a gate failure just like a schema mismatch.
* 🔌 **Provider-Agnostic Design:** Decoupled architecture support for **AWS Bedrock**, **OpenAI**, **Anthropic**, and **Google Gemini**.
* 🔑 **Zero Secrets Leakage:** Native integration with local AWS credentials (`aws configure`) or environment variables.

---

## 🏗️ Engine Sequence Diagram

```
User               Engine             Zod Gate           Bedrock / LLM         AWS API
 │                    │                   │                    │                  │
 │─ Send Prompt ─────>│                   │                    │                  │
 │                    │── Converse API ───────────────────────>│                  │
 │                    │<── Tool Request ("restart_ec2") ───────│                  │
 │                    │                   │                    │                  │
 │                    │── Validate Input >│                    │                  │
 │                    │<─ FAILED (Region)─│                    │                  │
 │                    │                   │                    │                  │
 │                    │── Append Tool Error & Retry Loop ─────>│                  │
 │                    │<── Self-Corrected Text Response ───────│                  │
 │                    │                   │                    │                  │
 │<─ Return Result ───│                   │                    │                  │
```

---

## 🛠️ Multi-AI Provider Extensibility

While the core implementation uses **AWS Bedrock Converse API**, the state engine and validation gates are completely provider-agnostic. 

Below is how the exact same validation engine wraps other AI providers:

### 1. AWS Bedrock (Default Implementation)
```javascript
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const response = await bedrockClient.send(new ConverseCommand({
  modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  messages: messages,
  toolConfig: toolConfig
}));
```

### 2. OpenAI (`openai` Package)
```javascript
import OpenAI from "openai";
const openai = new OpenAI();

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: messages,
  tools: toolsSpec
});

const toolCall = response.choices[0].message.tool_calls?.[0];
const validation = EC2RestartSchema.safeParse(JSON.parse(toolCall.function.arguments));
```

### 3. Anthropic Native (`@anthropic-ai/sdk`)
```javascript
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  messages: messages,
  tools: toolsSpec
});

const toolCall = response.content.find(c => c.type === "tool_use");
const validation = EC2RestartSchema.safeParse(toolCall.input);
```

### 4. Google Gemini (`@google/genai`)
```javascript
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: "gemini-3.6-flash",
  contents,
  config: { tools: [{ functionDeclarations: [restartEc2Declaration] }] }
});

const call = response.functionCalls[0];
const validation = EC2RestartSchema.safeParse(call.args);
```

---

## 🚀 Quick Start

### 1. Install
```bash
npm install agentic-gate zod
```

### 2. Register a tool and intercept a call
This is the core API — provider-agnostic, no AWS/network calls required:

```javascript
import { AgenticGate } from "agentic-gate";
import { z } from "zod";

const gate = new AgenticGate();

gate.registerTool({
  name: "restart_ec2_instance",
  schema: z.object({
    instanceId: z.string().regex(/^i-[a-f0-9]{8,17}$/, "Invalid AWS EC2 Instance ID format"),
    region: z.enum(["us-east-1", "us-west-2", "ap-south-1"]),
  }),
  execute: async ({ instanceId, region }) => {
    // Your real downstream call (AWS SDK, DB, HTTP, etc.)
    return { status: "success", instanceId, region };
  },
});

// Feed it raw, untrusted arguments straight from the LLM's tool-call payload
const result = await gate.interceptAndExecute("restart_ec2_instance", {
  instanceId: "i-0123456789abcdef0",
  region: "eu-central-1", // not in the enum -> gate rejects before execute() runs
});

if (!result.success) {
  console.log(result.error);
  // "[Validation Gate Failed]: region: Invalid enum value..."
  // Feed this string back into the LLM's message history so it can self-correct.
}
```

### 3. Circuit breaker + telemetry
Configure both when constructing the gate:

```javascript
const gate = new AgenticGate({
  maxConsecutiveFailures: 3, // 0 disables the breaker
  onGateFailure: (e) => metrics.increment(`gate.failure.${e.reason}`, { tool: e.toolName }),
  onGateSuccess: (e) => metrics.increment("gate.success", { tool: e.toolName }),
});

// After 3 consecutive failures for "restart_ec2_instance", the gate short-circuits:
// { success: false, error: "[Circuit Breaker OPEN]: Tool 'restart_ec2_instance' has failed 3 consecutive times..." }

gate.resetCircuit("restart_ec2_instance"); // once the underlying issue is fixed
```

### 4. Async external-state validation
Zod only checks the *shape* of the arguments — it can't tell you whether
`i-0123456789abcdef0` is an EC2 instance that actually exists. For that, add
a `validate()` hook: it runs after the schema passes and before `execute()`,
and throwing rejects the call exactly like a schema failure (same circuit
breaker, same telemetry, reason `"async-validation"`):

```javascript
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
const ec2 = new EC2Client({});

gate.registerTool({
  name: "restart_ec2_instance",
  schema: z.object({
    instanceId: z.string().regex(/^i-[a-f0-9]{8,17}$/),
    region: z.enum(["us-east-1", "us-west-2", "ap-south-1"]),
  }),
  validate: async ({ instanceId, region }) => {
    const { Reservations } = await ec2.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] }, { region })
    );
    if (!Reservations?.length) {
      throw new Error(`Instance '${instanceId}' does not exist in ${region}`);
    }
  },
  execute: async ({ instanceId, region }) => {
    // Safe to restart — we already confirmed the instance is real.
  },
});
```

### 5. See it wired into a real provider loop
The snippet above validates a single call. For the full retry loop — sending the
validation error back to the model and looping until it self-corrects or hits
`maxRetries` — see the runnable examples in [`examples/`](./examples):

| Example | Provider | Domain |
|---|---|---|
| [`examples/bedrock-converse.mjs`](./examples/bedrock-converse.mjs) | AWS Bedrock Converse API | EC2 instance restart |
| [`examples/openai.mjs`](./examples/openai.mjs) | OpenAI Function Calling | EC2 instance restart |
| [`examples/anthropic.mjs`](./examples/anthropic.mjs) | Anthropic Messages API | EC2 instance restart |
| [`examples/gemini.mjs`](./examples/gemini.mjs) | Google Gemini API | Satellite launch scheduling (non-infra) |
| [`examples/pizza-order.mjs`](./examples/pizza-order.mjs) | AWS Bedrock Converse API | Pizza ordering (non-infra, to show the gate isn't AWS-specific) |
| [`examples/langchain.mjs`](./examples/langchain.mjs) | LangChain (`@langchain/google-genai`) | Pet adoption — gate wrapped inside a LangChain `tool()` handler |

Each example requires only its provider's SDK and credentials — see
[`examples/README.md`](./examples/README.md) for setup.

---

## 🧪 Real Execution Logs

Here is the deterministic execution output when asking the LLM to restart an instance in an unsupported region (`eu-central-1`):

```console
🚀 Starting Engine Execution for Prompt: "Please restart instance i-0123456789abcdef0 in Frankfurt (eu-central-1)"
📡 Using Bedrock Model: us.anthropic.claude-haiku-4-5-20251001-v1:0

--- Loop Attempt 1/3 ---
[Bedrock Tool Requested]: "restart_ec2_instance" with input: { instanceId: 'i-0123456789abcdef0', region: 'eu-central-1' }
❌ [Validation Gate FAILED]: Region must be one of: us-east-1, us-west-2, ap-south-1

--- Loop Attempt 2/3 ---

🤖 [Model Feedback]: I apologize, but it appears that the restart function is currently only available for the following AWS regions:
- us-east-1 (US East - N. Virginia)
- us-west-2 (US West - Oregon)
- ap-south-1 (Asia Pacific - Mumbai)

The Frankfurt region (eu-central-1) is not supported. To restart your instance in Frankfurt, you would need to use the AWS Console directly.
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
