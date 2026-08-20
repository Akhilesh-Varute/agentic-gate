# Examples

All four scripts run the same scenario as their JS counterparts — restarting
an EC2 instance in an unsupported region — except `gemini_example.py`, which
runs a satellite-launch scenario (matching `examples/gemini.mjs` on the JS
side) to also demonstrate the gate is domain-agnostic.

`agentic-gate` itself only depends on `pydantic`. Each provider's SDK below
is only needed to run that example — install just the one you want.

## Bedrock — `bedrock_converse.py`

Verified live. No AWS CLI required — `boto3` picks up credentials from env
vars, a manually-written `~/.aws/credentials`, or an IAM role, same as any
other AWS SDK.

```bash
pip install boto3
python examples/bedrock_converse.py
```

## Gemini — `gemini_example.py`

Verified live. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
pip install google-genai
export GEMINI_API_KEY=...
python examples/gemini_example.py
```

## OpenAI — `openai_example.py`

```bash
pip install openai
export OPENAI_API_KEY=sk-...
python examples/openai_example.py
```

## Anthropic — `anthropic_example.py`

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
python examples/anthropic_example.py
```

## Local models (Ollama, vLLM, LM Studio, ...) — `ollama_test.py`

Verified live against a local Ollama container. The `openai` adapter doesn't
import the `openai` package itself, so it works against anything exposing an
OpenAI-compatible `/v1/chat/completions` endpoint — just point the official
`openai` client's `base_url` at your local server. Confirmed working with a
397MB model (`qwen2.5:0.5b`), including a populated `tool_call.id` on the
response (Ollama had a documented gap here historically — resolved on
current versions).

```bash
docker run -d -p 11434:11434 --name ollama ollama/ollama
docker exec ollama ollama pull qwen2.5:0.5b
pip install openai
python examples/ollama_test.py
```
