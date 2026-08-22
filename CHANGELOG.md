# Changelog

All notable changes to the SecondOp backend. Product version follows
`docs/RELEASE_VERSIONING.md` (one SemVer for the product; build metadata per
deployable is exposed at `/version`).

New sections are generated from Conventional-Commit history by
`npm run factory:release -- --bump <major|minor|patch> --write`.

## Unreleased

- Autonomous dispatch loop (`scripts/dispatch.mjs`), automated PR-review agent
  (`scripts/pr-review.mjs` + `.github/workflows/pr-review.yml`), and release
  automation (`scripts/release.mjs`) — the software-factory automation glue
  (SEC-236).
