# Examples

Each script runs the same scenario — asking an LLM to restart an EC2 instance
in an unsupported region — through `AgenticGate`, so you can compare how the
validation-gate + self-correction loop looks across providers.

All examples import from `../dist/index.js` (the local build). If you're
using this outside of this repo, install the package instead:

```bash
npm install agentic-gate zod
```

and change the import to:

```javascript
import { AgenticGate } from "agentic-gate";
```

## Bedrock — `bedrock-converse.mjs`

```bash
npm run build
aws configure          # or set AWS_REGION / credentials via env
node examples/bedrock-converse.mjs
```

Requires an AWS account with Bedrock model access enabled for the model in
`MODEL_ID`.

## OpenAI — `openai.mjs`

```bash
npm install openai
npm run build
export OPENAI_API_KEY=sk-...
node examples/openai.mjs
```

## Anthropic — `anthropic.mjs`

```bash
npm install @anthropic-ai/sdk
npm run build
export ANTHROPIC_API_KEY=sk-ant-...
node examples/anthropic.mjs
```

## What to look for

In all three scripts, the model is asked to restart an instance in
`eu-central-1`, which isn't in the tool's allowed `region` enum. Watch the
console output:

1. The model calls the tool with the invalid region.
2. `gate.interceptAndExecute()` rejects it locally — no AWS SDK call happens.
3. The Zod error string is fed back into the conversation as a tool result.
4. The model reads the error and responds without ever hitting the real
   downstream API with bad input.
