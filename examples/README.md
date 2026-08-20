# Examples

`bedrock-converse.mjs`, `openai.mjs`, and `anthropic.mjs` all run the same
scenario — asking an LLM to restart an EC2 instance in an unsupported region —
through `AgenticGate`, so you can compare how the validation-gate +
self-correction loop looks across providers.

`pizza-order.mjs` and `gemini.mjs` run completely unrelated, non-infra domains
(ordering pizza, scheduling a satellite launch) with their own quantity/enum/
length limits, to show the gate validates whatever Zod schema you give it —
it has no AWS- or infra-specific behavior baked in.

`langchain.mjs` shows a different *integration* pattern rather than a
different domain: instead of manually parsing tool_calls off a raw model
response (like every other example here), it wraps `gate.interceptAndExecute`
directly inside a LangChain `tool()` handler and lets LangChain's own
`tool.invoke(toolCall)` round-trip the result — the pattern you'd use if your
agent is built with LangChain/LangGraph.

Every raw provider example (`bedrock-converse.mjs`, `openai.mjs`,
`anthropic.mjs`, `gemini.mjs`) has an `-adapter` twin
(`bedrock-converse-adapter.mjs`, `openai-adapter.mjs`, etc.) running the
identical scenario through `agentic-gate/adapters/*` instead of manually
parsing the response — compare a file to its `-adapter` twin to see the loop
shrink from ~30 lines to ~10.

All examples import from `../dist/index.js` (the local build). If you're
using this outside of this repo, install the package instead:

```bash
npm install agentic-gate zod
```

and change the import to:

```javascript
import { AgenticGate } from "agentic-gate";
```

**`agentic-gate` itself only depends on `zod`.** The AWS/OpenAI/Anthropic SDKs
below are only needed if you're running *these example scripts* — in a real
app you bring whichever provider client you already use, and none of them
require any CLI tool to be installed. The CLIs mentioned below are just the
most convenient way to set up credentials, not a runtime requirement.

## OpenAI — `openai.mjs`

No CLI needed. The SDK reads the key from an env var, or you can pass it
directly in code (`new OpenAI({ apiKey: "sk-..." })`).

```bash
npm install openai
npm run build
export OPENAI_API_KEY=sk-...      # PowerShell: $env:OPENAI_API_KEY = "sk-..."
node examples/openai.mjs
```

Same setup runs `openai-adapter.mjs`:

```bash
node examples/openai-adapter.mjs
```

## Anthropic — `anthropic.mjs` / `anthropic-adapter.mjs`

Same story — no CLI needed.

```bash
npm install @anthropic-ai/sdk
npm run build
export ANTHROPIC_API_KEY=sk-ant-...   # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
node examples/anthropic.mjs
node examples/anthropic-adapter.mjs
```

## Gemini — `gemini.mjs` / `gemini-adapter.mjs`

No CLI needed. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm install @google/genai
npm run build
export GEMINI_API_KEY=...      # PowerShell: $env:GEMINI_API_KEY = "..."
node examples/gemini.mjs
node examples/gemini-adapter.mjs
```

Note: Gemini 3.x models attach a `thoughtSignature` to `functionCall` response
parts. When replaying the model's turn back into `contents` for the next
request, push `response.candidates[0].content` verbatim rather than
reconstructing the part yourself — dropping the signature causes a 400.
`gemini-adapter.mjs` and `agentic-gate/adapters/gemini` already do this
correctly, so you don't have to remember it.

## Local models (Ollama, vLLM, LM Studio, ...) — `ollama-adapter.mjs`

Verified live against a local Ollama container. The `openai` adapter doesn't
import the `openai` package itself, so it works against anything exposing an
OpenAI-compatible `/v1/chat/completions` endpoint — just point the official
`openai` client's `baseURL` at your local server. Confirmed working with a
397MB model (`qwen2.5:0.5b`), including a populated `tool_call.id` on the
response (Ollama had a documented gap here historically — resolved on
current versions).

```bash
docker run -d -p 11434:11434 --name ollama ollama/ollama
docker exec ollama ollama pull qwen2.5:0.5b
npm install openai
npm run build
node examples/ollama-adapter.mjs
```

Should work the same against vLLM/LM Studio's OpenAI-compatible endpoints,
though only Ollama has been tested directly.

## LangChain — `langchain.mjs`

Uses Gemini as the underlying model (same key/setup as `gemini.mjs` above),
via `@langchain/google-genai`. Swap in `@langchain/openai` or
`@langchain/anthropic` with the same `tool()`/`bindTools()` pattern if you'd
rather use a different provider through LangChain.

```bash
npm install @langchain/core @langchain/google-genai
npm run build
export GEMINI_API_KEY=...      # PowerShell: $env:GEMINI_API_KEY = "..."
node examples/langchain.mjs
```

## Bedrock — `bedrock-converse.mjs` / `bedrock-converse-adapter.mjs` / `pizza-order.mjs`

The AWS CLI is **not** required. `aws configure` is just one convenient way to
write `~/.aws/credentials` — the SDK's credential provider chain accepts any
of these, with zero CLI install:

* Env vars: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (/ `AWS_SESSION_TOKEN`)
* Passed directly in code: `new BedrockRuntimeClient({ region, credentials: { accessKeyId, secretAccessKey } })`
* A manually-written `~/.aws/credentials` file
* An IAM role, if running on EC2/Lambda/ECS — no explicit credentials at all

```bash
npm run build
# any of the credential options above, then:
node examples/bedrock-converse.mjs
node examples/bedrock-converse-adapter.mjs
node examples/pizza-order.mjs
```

Requires an AWS account with Bedrock model access enabled for the model in
`MODEL_ID`. `pizza-order.mjs` additionally enables the circuit breaker's
`onGateSuccess`/`onGateFailure` telemetry hooks so you can see them fire in
the console alongside each attempt.

## What to look for

In the EC2 examples, the model is asked to restart an instance in
`eu-central-1`, which isn't in the tool's allowed `region` enum. In the pizza
and satellite examples, it's asked for an oversized, out-of-enum order/launch.
Watch the console output in either case:

1. The model calls the tool with invalid arguments.
2. `gate.interceptAndExecute()` rejects it locally — no downstream call happens.
3. The Zod error string is fed back into the conversation as a tool result.
4. The model reads the error and responds without ever hitting the real
   downstream API with bad input.
