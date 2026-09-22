# Architecture

Murmur is an original implementation inspired by the capability set of Sandcastle. It neither wraps nor vendors Sandcastle. Its small modules depend only on Node.js built-ins at runtime.

## Two independent planes

The execution plane creates a **chamber**: an independent Git checkout and an isolation provider. Commands and agent requests share that environment and a FIFO queue. The scheduling plane builds a **flow** from typed task objects. Tasks declare edges with object references, and their values are stored separately for every execution.

These planes are independent. A workflow can coordinate ordinary trusted JavaScript functions without containers. A chamber can execute a single request without a workflow. Agent/check task helpers connect them.

## Repository isolation

Each chamber uses a fresh local clone with copied objects, not hard links, Git alternates or a worktree pointing at the host repository. A separate bare metadata directory remains outside the container mount and backs patch export. Export ignores the agent's `.git` configuration and disables global/system Git configuration, hooks, text conversion and external diff commands.

The source commit is resolved once. Dirty input is intentionally excluded. The source repository is never modified, merged or pushed by Murmur. Changes are returned as a reviewable patch against that exact baseline.

## Protocol boundaries

Drivers construct argv and parse the provider's JSONL protocol. They do not spawn host processes. The chamber handles framing and emits normalized events. The isolator alone executes processes, forwards selected environment variables and owns cleanup.

Built-in drivers use noninteractive Codex/Claude Code CLI modes. Session identity is explicit in requests and responses. Session storage belongs to the container lifetime. Continuation after container disposal is unsupported.

## Scheduling

A flow validates all keys and dependencies before running. Ready tasks are admitted up to the concurrency limit. Succeeded dependencies expose typed values. Failed, cancelled or skipped dependencies block descendants. Stop-on-error triggers a shared cancellation signal; all started tasks are awaited before the result returns.

Retries belong to individual tasks and are sequential. Feedback loops are separate from retries: `iterate` consumes successful agent answers and verification feedback, while retries handle exceptions. Neither mechanism silently rolls back filesystem or external changes.

## Extension points

- Add a coding agent by implementing `AgentDriver`.
- Add a remote sandbox by implementing `Isolator` and `Isolation`.
- Add higher-level workflow operations by returning normal `Task<T>` objects.
- Add observability by consuming flow/agent events and storing sanitized records.

Persistent scheduling, interactive terminals, cloud provisioning, merges and cost accounting are not implemented. They can be added without making the core scheduler depend on a provider SDK.
