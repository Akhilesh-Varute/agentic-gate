# 🛡️ Agentic Deterministic State Engine

> **A production-ready, model-agnostic proxy engine that enforces strict runtime execution bounds, schema validation gates, and self-correction loops for LLM Function Calling.**

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

---

## Key Features

* 🛡️ **Zero-Trust Validation Gate:** Uses Zod schemas to intercept and validate parameters locally *before* hitting downstream APIs.
* 🔄 **Self-Correction Feedback Loop:** Feeds exact schema validation error traces back into the conversation history, allowing the LLM to self-correct in subsequent attempts.
* ⚡ **Circuit Breaker Pattern:** Configurable `maxRetries` (default: `3`) prevents runaway token loops and API rate-limiting.
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

---

## 🚀 Quick Start

### 1. Prerequisites
* Node.js v18+
* AWS CLI configured locally (`aws configure`) with access to AWS Bedrock Converse API.

### 2. Installation
```bash
git clone https://github.com/Akhilesh-Varute/bedrock-deterministic-engine.git
cd bedrock-deterministic-engine
npm install
```

### 3. Environment Setup (Optional)
If not using default CLI profiles, create a `.env` file (ensure `.env` is in `.gitignore`):
```env
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

### 4. Running the Engine
```bash
node engine.mjs
```

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
