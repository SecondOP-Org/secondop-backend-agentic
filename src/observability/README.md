# `src/observability/`

**What lives here:** Tracing/telemetry integrations (e.g. Phoenix) used around analysis runs.

**What does not:** Business domain logic, Command Center HTTP API (that lives under `services/` + `routes/`).

**One rule:** Observability must never change clinical outcomes — spans/logs only; fail open when disabled.
