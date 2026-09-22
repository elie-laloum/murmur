# API reference

## Environment lifecycle

`chamber({ repository, isolator, ref?, signal? }): Promise<Chamber>` clones committed state and provisions isolation. Provisioning errors report the retained checkout path. `repository` is a local Git repository. `ref` defaults to `HEAD` and must resolve to a commit.

| Member                      | Behavior                                           |
| --------------------------- | -------------------------------------------------- |
| `workspace.directory`       | Absolute path to retained working files            |
| `workspace.baseline`        | Resolved source commit                             |
| `workspace.source`          | Absolute source repository path                    |
| `workspace.patch()`         | Binary-capable patch against the baseline          |
| `workspace.savePatch(path)` | Write a UTF-8 Git patch                            |
| `workspace.changedFiles()`  | Added, modified and deleted paths                  |
| `ask(options)`              | Execute one noninteractive agent request           |
| `command(invocation)`       | Execute a command; nonzero exit is returned        |
| `close()`                   | Drain queued work and remove isolation; keep files |
| `[Symbol.asyncDispose]()`   | Same behavior as `close()`                         |

`checkout(repository, ref?)` creates a checkout without a container. It is useful for custom isolators and patch preparation; it does not execute agent code.

`delegate(options)` combines chamber options and ask options for one request. It closes isolation in `finally` and returns the answer plus its workspace on success.

## Container provider

`containers(settings): Isolator`

| Setting    | Default           | Meaning                                    |
| ---------- | ----------------- | ------------------------------------------ |
| `image`    | required          | An already available Linux container image |
| `engine`   | `docker`          | `docker` or `podman` executable on PATH    |
| `network`  | `bridge`          | `bridge` or `none`                         |
| `memoryMb` | `2048`            | Positive integer, minimum 64               |
| `cpus`     | `2`               | Positive CPU limit, fractions allowed      |
| `uid`      | Host UID, or 1000 | Non-root numeric user                      |
| `gid`      | Host GID, or 1000 | Non-root numeric group                     |

Provisioning uses a read-only root, drops all capabilities, sets no-new-privileges and a 256-process limit, and mounts writable temporary areas at `/tmp` and `/home/agent`. The checkout is writable at `/workspace`. Each temporary area is limited to 512 MB. The bind-mounted checkout is not disk-quota limited.

Do not set a root UID/GID. On a root host, arrange checkout ownership for the selected non-root UID. The provider will not recursively change host ownership for you. Paths containing commas are rejected because Docker mount syntax uses commas as delimiters.

## Commands

```ts
const exit = await room.command({
  program: "node",
  args: ["--test"],
  timeoutMs: 60_000,
  signal: controller.signal,
  env: { CI: "1" },
  onOutput: (channel, chunk) => process.stdout.write(chunk),
});
```

Commands use argv arrays, never an implicit shell. To request a shell explicitly, use `program: "sh", args: ["-lc", "..."]`. Treat dynamically assembled shell text as code.

The default command deadline is 600,000 ms. Combined captured stdout/stderr is limited to 8 MiB. `Exit` contains `code`, `stdout` and `stderr`. A timeout, cancellation, output overflow or stream consumer exception destroys the container and rejects the command. Ordinary nonzero exits leave it available.

`commandTask()` promotes a nonzero exit to `CommandError`, preventing dependent tasks from running. `CommandError.exit` exposes diagnostics without embedding credentials or command arguments into its message.

## Agents

`codexDriver({ model?, autonomous? })` and `claudeDriver({ model?, autonomous? })` return immutable `AgentDriver` implementations. `autonomous` defaults to false. Use explicit true only with an isolation implementation you trust.

`room.ask({ driver, prompt, sessionId?, credentials?, timeoutMs?, signal?, onEvent? })` returns an `AgentAnswer`: accumulated `text`, optional `sessionId`, normalized `events` and raw `exit`.

Events are `text`, `session`, `error`, `complete` or `raw`. Drivers retain unknown protocol messages as `raw` events. A nonzero exit, application error event or missing completion event rejects the request. Line fragments and CRLF streams are handled by the chamber. Consumers should treat raw provider output as potentially sensitive.

`credentials` is an explicit environment map. Codex uses `CODEX_API_KEY`; Claude uses `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Keys are forwarded for that execution only, not included in stored Docker create arguments. Docker host administrators can still inspect running process environments. Session files may retain provider data until the container is removed.

## Task graph

`task<T>({ key, perform, after?, condition?, retry?, timeoutMs? }): Task<T>` creates an immutable task definition.

`perform(context)` receives `signal`, one-based `attempt`, `executionId` and `value(dependency)`. The latter only accepts a declared dependency at runtime and returns its inferred result type. There is no global mutable value store.

`condition(context)` runs once before attempts, with `attempt: 0`. False skips this node and all descendants. Conditions should be short and must cooperate with the flow's cancellation signal. The per-attempt timeout covers `perform`, not `condition` or retry backoff.

`retry` contains total `attempts`, optional fixed `delayMs` and optional `accepts(error, attempt)` predicate. The default is one attempt. A predicate returning false stops retries. There is no implicit rollback or deduplication of effects.

`flow(name, tasks)` validates the graph. Task keys use letters, digits, dots, underscores and hyphens; a key starts with a letter or digit. The returned flow has `start(options)` and `diagram()` (Mermaid source).

| Start option     | Default |
| ---------------- | ------- |
| `concurrency`    | 1       |
| `stopOnError`    | true    |
| `signal`         | none    |
| `observe(event)` | none    |

Tasks sharing a chamber queue their commands. Separate chambers enable true concurrent agent work. The scheduler awaits active tasks' cleanup before returning. Cancellation and task deadlines are cooperative: custom callbacks must observe their signal. Murmur cannot forcibly terminate arbitrary JavaScript callbacks. Container commands use the signal to destroy isolation and terminate its processes.

`FlowResult.status` is `done`, `failed` or `cancelled`. Task statuses are `waiting`, `active`, `done`, `failed`, `skipped` and `cancelled`. `result.value(task)` returns a successful value, including `undefined`; it rejects skipped or failed tasks. `result.unwrap()` throws `FlowFailure` for non-success and exposes the full result at `.result`.

Observer exceptions are recorded in `observerErrors`; they do not alter execution. Task error objects remain in `errors`. Results include task timestamps and attempt counts. They are in-memory records, not a durable job store. Store a sanitized projection if persistence is needed.

## Task helpers

`agentTask({ key, after?, chamber, request(context), ...taskOptions })` invokes `chamber.ask` with the task signal and yields an `AgentAnswer`.

`commandTask({ key, after?, chamber, command, ...taskOptions })` accepts an `Invocation` or function returning one, propagates the signal and requires exit code zero.

Both helpers support conditions, retry policies and per-attempt timeouts. They do not own the chamber lifecycle. Use `await using` or `try/finally` around the enclosing flow.

## Feedback loops and JSON

```ts
import { iterate } from "@elie-laloum/murmur";

const outcome = await iterate({
  chamber: room,
  request: { driver, prompt: "Fix the tests.", credentials },
  limit: 3,
  async evaluate() {
    const check = await room.command({ program: "npm", args: ["test"] });
    return { done: check.code === 0, feedback: check.stdout + check.stderr };
  },
});
if (!outcome.converged) throw new Error("Iteration limit reached");
```

Iteration resumes the previous answer's session. If a custom driver provides no session, the original prompt, previous answer and feedback form the next prompt. There is no magic completion string. `evaluate` decides using programmatic evidence. Failed requests reject immediately; exhaustion returns `converged: false` with all successful answers.

`decodeJson(answer, validate)` parses the entire answer as JSON, optionally stripping a single `json` fenced block, then calls the validator. Use a schema library's `.parse` or an explicit runtime validator. TypeScript assertions alone do not validate model output. Prose surrounding JSON is rejected.

## Custom integrations

```ts
import type { AgentDriver } from "@elie-laloum/murmur";

const driver: AgentDriver = {
  name: "my-agent",
  prepare: ({ prompt }) => ({
    program: "my-agent",
    args: ["--json"],
    input: prompt,
  }),
  decode: (line) => {
    const message = JSON.parse(line);
    return message.done
      ? [{ type: "complete" }]
      : [{ type: "text", text: message.text }];
  },
};
```

A driver must emit `complete` only after successful provider completion. It can emit `session` to support continuation and `error` for failures that do not set a process exit code.

`Isolator.provision(directory, signal?)` returns an `Isolation` with `kind: "container" | "remote"`, `execute(invocation)` and `dispose()`. Implementations must stream stdout to `onOutput`, honor input/env/timeout/signal, reject transport failures, retain ordinary exit codes and make disposal idempotent. Custom providers are trusted infrastructure: the type declaration is not proof of isolation. No host provider is bundled.
