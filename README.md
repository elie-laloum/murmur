# Murmur

[Français](README.fr.md)

A TypeScript library for running Codex and Claude Code in isolated containers and composing their work into typed workflows. No production dependencies. No Sandcastle dependency or copied implementation.

Murmur is usable from source. It is not published to npm yet. The API is version 0.1 and may change before 1.0.

## What is implemented

- Docker and Podman container providers with non-root execution, resource limits and explicit environment forwarding.
- Independent Git checkouts of committed revisions; changes never merge into the source repository automatically.
- Reusable environments with serialized commands, streaming agent events and session continuation.
- Codex and Claude Code adapters behind an open `AgentDriver` contract.
- Typed task dependencies, bounded concurrency, conditions, retries, cooperative timeouts and cancellation.
- Agent/check task helpers, bounded feedback loops and validated JSON decoding.
- Binary-capable patch export and retained workspaces for inspection after errors.

See [architecture](docs/architecture.md), [API](docs/api.md), [isolation](docs/isolation.md) and [validation](docs/validation.md).

## Requirements

Node.js 24+, Git and Docker Engine/Desktop or Podman with Linux containers. Workflow-only code does not require a container engine. Running coding agents also requires an image containing their CLIs and credentials for each provider used.

Docker must run on the same machine as Node, or its bind mounts must resolve to the same filesystem. Remote Docker daemons are not supported by the built-in provider. Rootless Podman is supported through its Docker-compatible CLI; platform-specific UID and SELinux configuration may require a custom provider.

## Run the library and tests

```sh
git clone https://github.com/elie-laloum/murmur.git
cd murmur
npm ci
npm run check
npm run demo
```

The demo runs a deterministic five-task graph. It does not call models or claim to exercise container isolation.

To install the built library into another project:

```sh
npm pack
cd /path/to/consumer
npm install /path/to/murmur/elie-laloum-murmur-0.1.0.tgz
```

Import from `@elie-laloum/murmur`. The examples in this repository import the source directly so they work without publishing a package.

## A typed workflow

```ts
import { flow, task } from "@elie-laloum/murmur";

const inspect = task({
  key: "inspect",
  perform: () => ({ files: ["src/cart.ts"] }),
});

const plan = task({
  key: "plan",
  after: [inspect],
  perform: (context) => `Review ${context.value(inspect).files.join(", ")}`,
});

const result = await flow("review", [inspect, plan]).start({ concurrency: 2 });
result.unwrap();
console.log(result.value(plan));
```

`context.value()` preserves the dependency's result type. A dependency must be declared in `after`. Graph validation rejects duplicate keys, missing nodes and cycles before tasks execute.

## Build an agent image

Choose and pin versions of both CLIs. Dockerfile build arguments are mandatory so an accidental rebuild does not silently install newer agents.

`npm run image:build` builds the versions recorded in `containers/versions.json` (Codex 0.156.0 and Claude Code 2.1.280). Set `MURMUR_ENGINE=podman` to use Podman. To choose other versions:

```sh
docker build -f containers/Dockerfile \
  --build-arg CODEX_VERSION=<your-tested-version> \
  --build-arg CLAUDE_VERSION=<your-tested-version> \
  -t murmur-agents:local .
```

Replace the angle-bracket placeholders. The image contains Node.js, Git, ripgrep and the selected agent CLIs. Container startup does not install software or pull images automatically.

## Run Codex in an isolated checkout

```ts
import { chamber, codexDriver, containers } from "@elie-laloum/murmur";

const key = process.env.CODEX_API_KEY;
if (!key) throw new Error("Set CODEX_API_KEY");

await using room = await chamber({
  repository: "/path/to/project",
  isolator: containers({ image: "murmur-agents:local" }),
});

console.log(room.workspace.directory);
const answer = await room.ask({
  driver: codexDriver({ autonomous: true }),
  prompt: "Fix the failing tests, then explain the changes.",
  credentials: { CODEX_API_KEY: key },
});

const check = await room.command({ program: "npm", args: ["test"] });
if (check.code !== 0) throw new Error(check.stderr || check.stdout);
await room.workspace.savePatch("changes.patch");
console.log(answer.text);
```

`autonomous: true` explicitly disables the agent CLI's own approval/sandbox layer inside the external container. It defaults to false. The container remains the isolation boundary. Without autonomous mode, agents can refuse commands that need approvals in noninteractive mode.

Use `claudeDriver()` with `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to select Claude Code. Murmur forwards only the environment entries passed to the command; it does not mount host login directories. Model selection is optional and delegated to the CLI unless `model` is supplied.

For one request, `delegate({ repository, isolator, driver, prompt, credentials })` provisions a chamber, asks the agent and closes the container. Its successful result includes the retained workspace.

## Implement → verify → review → verify

[`examples/repair.ts`](examples/repair.ts) is a runnable workflow that:

1. Installs the target project's locked npm dependencies inside the container.
2. Asks Codex to fix failing tests.
3. Requires `npm test` to pass.
4. Asks Claude Code to review and repair remaining issues using the implementation summary.
5. Runs the tests again and exports a patch.

```sh
cp .env.example .env
# Fill in provider credentials.
node --env-file=.env examples/repair.ts /path/to/project
```

The target must be an npm project with a lockfile and a `test` script. Its setup scripts execute inside the container. Provider use is billed by the relevant provider. The example exports a patch even when a workflow task fails, then throws through `result.unwrap()`; inspect the result before applying it.

## Branching and parallelism

A flow is a directed acyclic graph of task objects. Independent tasks can run concurrently up to `concurrency`. Commands within a single chamber are queued, even if the tasks are scheduled concurrently. Use separate chambers to run agents in parallel without sharing files.

False conditions skip the task and its descendants. They are not failures. With `stopOnError: true` (the default), a failure cancels siblings through their signals and prevents pending tasks from starting. With `false`, unrelated branches continue; failed descendants are skipped.

Retries are opt-in and may repeat external effects or provider charges. A retry is not a rollback. After a container command is cancelled or times out, its container is destroyed to terminate descendants; recreate a chamber before retrying work that needs that container.

## Sessions and feedback loops

Pass an answer's `sessionId` to another `room.ask()` using the same driver and chamber. Session state lives in the container's temporary home and disappears when the chamber closes.

`iterate()` runs up to a fixed number of rounds. Its `evaluate` callback decides whether a result is complete and supplies feedback for the next round. Reaching the limit returns `converged: false`. See [the API reference](docs/api.md#feedback-loops-and-json).

## Changes and cleanup

Only committed files from `ref` (default `HEAD`) enter a checkout. Dirty edits, untracked files, host environment files, credentials, submodule contents and Git LFS downloads are not imported automatically. Commit intended inputs first or provide a custom provisioning strategy.

Murmur creates an independent clone under the OS temporary directory. Containers mount that checkout, never the original repository, its parent `.git`, the Docker socket or the host home. A second Git metadata directory outside the mounted checkout is used for exports, so agent-modified Git configuration cannot control host-side export commands.

`close()` waits for queued work and removes the container. `await using` calls it automatically. The checkout and its export metadata are deliberately retained, including after success, to preserve changes. The OS may eventually clean its temporary directory: export important patches promptly and remove the printed `murmur-*` parent directory yourself once reviewed. No automatic source merge or push occurs.

```sh
git apply --check changes.patch
git apply changes.patch
```

Run these in the original project after reviewing the patch and ensuring the baseline is still appropriate. Binary files, new files and deletions are included; ignored files are not. Export stages the retained files in the separate export index and should run after writes have stopped.

## Extension contracts

`AgentDriver` maps a prompt/session into an argv invocation and decodes JSONL events. `Isolator` provisions an `Isolation` with `execute()` and `dispose()`. New agent and environment integrations do not need changes to the workflow scheduler. See [custom integrations](docs/api.md#custom-integrations).

## Current boundaries

Murmur implements its own core; it does not claim full Sandcastle API or feature compatibility. There is no interactive TUI, cloud provider bundled with the library, host execution fallback, persisted workflow resume, automatic merge, budget accounting or visual workflow editor. Workflows are TypeScript code. These are explicit extension areas, not placeholder implementations.

Containers isolate processes and mounted files, but are not virtual machines. Network egress is enabled by default for provider access. Use `network: "none"` for offline work. Custom task callbacks run in the orchestrator process and are trusted code. Read [isolation and trust boundaries](docs/isolation.md).

## Validation and contribution

```sh
npm run check
npm run format:check
docker pull node:24-bookworm-slim
MURMUR_CONTAINER_TEST=1 npm run test:container
```

PowerShell: `$env:MURMUR_CONTAINER_TEST='1'; npm run test:container`.

GitHub CI runs unit tests on Linux, Windows and macOS and a real Docker isolation test on Linux. Live provider tests are opt-in; see [validation](docs/validation.md). [Contributing](CONTRIBUTING.md).

[Private GitLab source](https://gitlab.elielaloum.com/elielaloum/murmur) · [Public GitHub mirror](https://github.com/elie-laloum/murmur). MIT licensed. The design brief was inspired by [Sandcastle](https://github.com/mattpocock/sandcastle); Murmur's implementation and API are independent.
