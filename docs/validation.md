# Validation

## Automated checks

`npm run check` type-checks public contracts and examples, runs unit/contract tests and produces the distributable JavaScript and declarations. `npm run format:check` checks formatting. `npm pack --dry-run` checks distributable contents.

The tests exercise graph ordering, parallel limits, error propagation, retry predicates, conditions, cancellation and deadlines; both CLI command/protocol adapters; process argv/stdin handling and limits; chamber serialization and disposal; iteration and structured output; independent Git checkouts and binary patch applicability. Git tests use real temporary repositories and process tests execute real Node subprocesses. Chamber fixtures use explicit test doubles, not live providers.

## Real container test

```sh
docker pull node:24-bookworm-slim
MURMUR_CONTAINER_TEST=1 npm run test:container
```

This test starts a real Linux container, checks the non-root user and read-only root, verifies that no Docker socket is mounted, edits a file, exports the patch and tests timeout-driven teardown. It requires no provider credentials and runs in the GitHub CI isolation job.

On PowerShell, set `$env:MURMUR_CONTAINER_TEST='1'` before invoking the script.

## Live provider test

Build the agent image using pinned versions, then run:

```sh
MURMUR_LIVE_TEST=1 node --env-file=.env --test test/integration/container.test.ts
```

Both `CODEX_API_KEY` and `ANTHROPIC_API_KEY` are required. `MURMUR_IMAGE` optionally overrides `murmur-agents:local`. This test makes billable provider requests and expects each agent to read a fixture file, return its content and expose a session ID. It is intentionally absent from untrusted pull-request CI.

Contract tests cannot establish compatibility with every future CLI release. Pin image versions and run this test before upgrading them. Unit tests validate expected protocol examples; they are not a claim that a live model request happened.

## Reproducible workflow example

`npm run demo` runs a real in-process graph with deterministic tasks. It demonstrates typed value propagation and actual assertions. It does not test Docker or model quality. `examples/repair.ts` is the separate real-agent example, with explicit credentials and project requirements.

## Release validation

Inspect the repository's current CI run for cross-platform and container results. Live provider validation remains opt-in unless separately documented with tested CLI versions. The project does not claim complete behavioral parity with Sandcastle.
