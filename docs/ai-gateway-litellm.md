# LiteLLM AI Gateway

## What LiteLLM Does Here

LiteLLM Proxy is an opt-in OpenAI-compatible gateway between the SecondOP backend and model providers. It lets us learn a production-style gateway pattern with model aliases, virtual keys, and spend tracking while keeping the backend clinical workflow unchanged.

## Why The Backend Still Uses The OpenAI SDK

The backend already sends chat-completion requests with the OpenAI SDK. LiteLLM Proxy exposes OpenAI-compatible routes, so the backend can switch transport by changing the SDK `baseURL` and API key. No Python SDK is embedded in the Node/TypeScript app.

## Modes

- `LLM_GATEWAY_MODE=direct`: default. The backend uses `OPENAI_API_KEY` directly and preserves current behavior.
- `LLM_GATEWAY_MODE=litellm`: the backend sends OpenAI-compatible calls to `LLM_GATEWAY_BASE_URL` using `LLM_GATEWAY_API_KEY`, which must be a LiteLLM virtual key.

Rollback is setting `LLM_GATEWAY_MODE=direct`.

## Keys

- Provider key: `OPENAI_API_KEY`. In direct mode the backend uses it. In LiteLLM mode, LiteLLM uses it as provider credentials.
- LiteLLM master key: `LITELLM_MASTER_KEY`. Admin key for LiteLLM UI and key generation.
- LiteLLM virtual key: `LLM_GATEWAY_API_KEY`. The backend app key used to call LiteLLM Proxy.

Never commit real keys.

## Model Aliases

LiteLLM mode accepts only these backend model aliases:

- `secondop-case-analysis-primary`
- `secondop-case-analysis-fallback`
- `secondop-agentic-planner`

Set `OPENAI_MODEL`, `OPENAI_FALLBACK_MODEL`, and `AGENTIC_MODEL` to these aliases when `LLM_GATEWAY_MODE=litellm`.

## Local Startup

1. Set local provider/admin values in `.env`:
   - `OPENAI_API_KEY`
   - `LITELLM_MASTER_KEY`
2. Start the local gateway profile:

```bash
docker compose --profile ai-gateway up litellm litellm-postgres
```

3. Open the LiteLLM UI at `http://localhost:4000/ui` and log in with the master key.

## Railway Staging

Use `litellm/` as the service build context for the staging LiteLLM Proxy service. It contains a minimal Dockerfile that packages `config.example.yaml` into the database-enabled LiteLLM Proxy image and starts the proxy on Railway's `PORT`.

Configure only the staging LiteLLM service with:

- `OPENAI_API_KEY`: provider key used by LiteLLM.
- `LITELLM_MASTER_KEY`: admin/master key for LiteLLM UI and virtual key creation.
- `LITELLM_DATABASE_URL`: separate LiteLLM Postgres connection string.

Configure only the staging backend service with:

```bash
LLM_GATEWAY_MODE=litellm
LLM_GATEWAY_BASE_URL=<staging LiteLLM service URL>
LLM_GATEWAY_API_KEY=<LiteLLM virtual key>
OPENAI_MODEL=secondop-case-analysis-primary
OPENAI_FALLBACK_MODEL=secondop-case-analysis-fallback
AGENTIC_MODEL=secondop-agentic-planner
AGENTIC_PLANNER_FALLBACK_MODEL=secondop-agentic-planner
```

Do not use the LiteLLM master key as `LLM_GATEWAY_API_KEY`.

## Virtual Key And Spend Tracking

Create a virtual key in the LiteLLM UI or via `/key/generate`, then set:

```bash
LLM_GATEWAY_MODE=litellm
LLM_GATEWAY_BASE_URL=http://localhost:4000
LLM_GATEWAY_API_KEY=<virtual-key>
OPENAI_MODEL=secondop-case-analysis-primary
OPENAI_FALLBACK_MODEL=secondop-case-analysis-fallback
AGENTIC_MODEL=secondop-agentic-planner
```

LiteLLM tracks spend against the virtual key in its own Postgres database. Verify spend in the LiteLLM UI or key info endpoint after running a backend analysis request.

## Status

The backend exposes `GET /api/v1/ai-gateway/status` for doctors. It reports mode, configured state, redacted host, model aliases, and a short `/models` probe in LiteLLM mode. It never returns keys, prompts, responses, clinical text, or credentials.

## Out Of Scope For V1

- Production rollout
- PHI tokenization
- Automatic provider routing beyond LiteLLM config aliases
- Prompt changes
- Output schema changes
- AI contract changes
- LangGraph rewrite
