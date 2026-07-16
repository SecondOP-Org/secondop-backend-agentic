# `src/services/`

**What lives here:** Domain logic — analysis, files, doctor response, de-id, practice, Command Center, email, etc.

**What does not:** Route wiring or thin request parsing (controllers), or raw Express middleware.

**One rule:** Domain logic lives here, never in controllers. Controllers parse → call a service → return.
