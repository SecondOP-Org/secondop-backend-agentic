# SecondOp Release Versioning Policy

## Policy Summary

SecondOp uses one product release version for the whole product, plus separate build metadata for each deployable.

- Product release version: one SemVer value for the product, for example `0.1.0`.
- Frontend build metadata: commit SHA, Vercel deployment id or URL, build time, and environment.
- Backend build metadata: commit SHA, Railway deployment id or URL, build time, and environment.
- API version: remains separate from the product version, for example `/api/v1`.
- Package versions: treated as package metadata only until we intentionally automate release publishing.

Do not treat the frontend and backend as separate product versions. A release can include one or both deployables, but support and QA should refer to the single product version plus deployable build ids.

## Version Values

### Product Release Version

Use SemVer for SecondOp product releases:

```text
MAJOR.MINOR.PATCH
```

Recommended starting point: `0.1.0`.

Before `1.0.0`, use:

- `MINOR` for meaningful product increments or release trains.
- `PATCH` for fixes that do not change the release scope.
- prerelease suffixes only for explicit release candidates, for example `0.1.0-rc.1`.

The product release version should be recorded in release notes, deployment records, and future build metadata fields as `SECONDOP_RELEASE_VERSION`.

### Frontend Build Metadata

Frontend build metadata identifies the exact UI build that is live:

- `SECONDOP_RELEASE_VERSION`
- frontend git commit SHA
- Vercel deployment id or URL
- build time
- environment: local, preview, staging, or production

Future frontend implementation work should expose this safely in app metadata or a protected/admin-visible status surface. Do not expose secrets or internal tokens.

### Backend Build Metadata

Backend build metadata identifies the exact API build that is live:

- `SECONDOP_RELEASE_VERSION`
- backend git commit SHA
- Railway deployment id or URL
- build time
- environment: local, staging, or production
- API version, for example `v1`

Future backend implementation work should expose this safely from `/health` or a dedicated `/version` endpoint. Do not expose secrets, database URLs, tokens, or private platform metadata.

## Source by Environment

| Environment | Product version source | Build SHA source | Deployment id source |
| --- | --- | --- | --- |
| Local | `.env` or default `0.0.0-dev` | `git rev-parse HEAD` or `unknown` | `local` |
| Preview | Vercel/Railway env var | platform git SHA env var or injected CI value | platform deployment id or URL |
| Staging | platform env var | platform git SHA env var or injected CI value | Railway/Vercel deployment id or URL |
| Production | release/deploy env var | platform git SHA env var or injected CI value | Railway/Vercel deployment id or URL |

If a platform does not provide a value consistently, the deploy workflow should inject it explicitly. Missing metadata should render as `unknown`, not crash the app or API.

## Package Version Rule

Do not synchronize `package.json` versions as the product release source yet.

Current package versions are implementation metadata:

- frontend package version: `0.0.0`
- backend package version: `1.0.0`

They may be normalized later, but support, QA, and release workflows should not rely on them as the product version until a dedicated release automation task changes this policy.

## Deployment Record

Every production release should record:

- Linear issue or release ticket.
- Product release version.
- Frontend commit SHA and Vercel deployment id or URL.
- Backend commit SHA and Railway deployment id or URL.
- Migration status when backend or database changes are included.
- Smoke-test evidence.
- Known risks and rollback note.

## Follow-Up Implementation

Existing follow-up tickets cover implementation:

- SEC-22: expose backend version and build metadata in a health/version endpoint.
- SEC-23: embed frontend version and build metadata.

No additional implementation ticket is needed from this policy unless release automation or package-version synchronization becomes in scope.
