# LiteLLM Railway Service

This directory is the build context for the staging LiteLLM Proxy service.

The Dockerfile packages `config.example.yaml` into the database-enabled LiteLLM Proxy image and starts the proxy on Railway's `PORT`.

Required Railway variables for the LiteLLM service:

- `OPENAI_API_KEY`: provider key used by LiteLLM.
- `LITELLM_MASTER_KEY`: admin/master key for LiteLLM.
- `LITELLM_DATABASE_URL`: connection URL for the separate LiteLLM Postgres database.

Backend staging should call this service with a LiteLLM virtual key, not the master key.
