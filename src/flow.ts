import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export interface TaskContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly executionId: string;
  value<T>(dependency: Task<T>): T;
}

export interface Retry {
  readonly attempts: number;
  readonly delayMs?: number;
  readonly accepts?: (error: unknown, attempt: number) => boolean;
}

export interface Task<T = unknown> {
  readonly key: string;
  readonly after: readonly Task[];
  readonly perform: (context: TaskContext) => T | Promise<T>;
  readonly condition?: (context: TaskContext) => boolean | Promise<boolean>;
  readonly retry?: Retry;
  readonly timeoutMs?: number;
}

export type TaskOptions<T> = Omit<Task<T>, "after"> & {
  readonly after?: readonly Task[];
};

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`);
}

export function task<T>(options: TaskOptions<T>): Task<T> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.key))
    throw new Error(`Invalid task key: ${options.key}`);
  if (options.timeoutMs !== undefined) positive(options.timeoutMs, "timeoutMs");
  if (options.retry) {
    positive(options.retry.attempts, "retry.attempts");
    if (
      !Number.isFinite(options.retry.delayMs ?? 0) ||
      (options.retry.delayMs ?? 0) < 0
    )
      throw new Error("retry.delayMs must be nonnegative");
  }
  return Object.freeze({
    ...options,
    ...(options.retry ? { retry: Object.freeze({ ...options.retry }) } : {}),
    after: Object.freeze([...(options.after ?? [])]),
  });
}

export type TaskStatus =
  "waiting" | "active" | "done" | "failed" | "skipped" | "cancelled";
export interface TaskRecord {
  readonly key: string;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface FlowEvent {
  readonly executionId: string;
  readonly flow: string;
  readonly timestamp: string;
  readonly type: "start" | "task" | "retry" | "finish";
  readonly key?: string;
  readonly status?: TaskStatus;
  readonly attempt?: number;
}

export interface FlowOptions {
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly stopOnError?: boolean;
  readonly observe?: (event: FlowEvent) => void;
}

export interface FlowResult {
  readonly executionId: string;
  readonly name: string;
  readonly status: "done" | "failed" | "cancelled";
  readonly tasks: readonly Readonly<TaskRecord>[];
  readonly errors: readonly unknown[];
  readonly observerErrors: readonly unknown[];
  value<T>(task: Task<T>): T;
  unwrap(): void;
}

export class FlowFailure extends Error {
  readonly result: FlowResult;
  constructor(result: FlowResult) {
    super(`Flow ${result.name} ${result.status}`, { cause: result.errors[0] });
    this.name = "FlowFailure";
    this.result = result;
  }
}

export interface Flow {
  readonly name: string;
  readonly tasks: readonly Task[];
  start(options?: FlowOptions): Promise<FlowResult>;
  diagram(): string;
}

export function flow(name: string, tasks: readonly Task[]): Flow {
  if (!name.trim()) throw new Error("Flow name cannot be empty");
  const graph = Object.freeze([...tasks]);
  validate(graph);
  return Object.freeze({
    name,
    tasks: graph,
    start: (options: FlowOptions = {}) => schedule(name, graph, options),
    diagram() {
      const ids = new Map(graph.map((item, index) => [item, `n${index}`]));
      return [
        "flowchart LR",
        ...graph.flatMap((item) => [
          `  ${ids.get(item)}["${item.key}"]`,
          ...item.after.map(
            (dependency) => `  ${ids.get(dependency)} --> ${ids.get(item)}`,
          ),
        ]),
      ].join("\n");
    },
  });
}

function validate(tasks: readonly Task[]): void {
  const keys = new Set<string>();
  const members = new Set(tasks);
  const visiting = new Set<Task>();
  const visited = new Set<Task>();
  for (const item of tasks) {
    if (keys.has(item.key)) throw new Error(`Duplicate task: ${item.key}`);
    keys.add(item.key);
    for (const dependency of item.after)
      if (!members.has(dependency))
        throw new Error(`${item.key}: missing dependency ${dependency.key}`);
  }
  function visit(item: Task): void {
    if (visiting.has(item)) throw new Error(`Dependency cycle at ${item.key}`);
    if (visited.has(item)) return;
    visiting.add(item);
    item.after.forEach(visit);
    visiting.delete(item);
    visited.add(item);
  }
  tasks.forEach(visit);
}

async function schedule(
  name: string,
  tasks: readonly Task[],
  options: FlowOptions,
): Promise<FlowResult> {
  const concurrency = options.concurrency ?? 1;
  positive(concurrency, "concurrency");
  const executionId = randomUUID();
  const stop = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, stop.signal])
    : stop.signal;
  const values = new Map<Task, unknown>();
  const records = new Map<Task, TaskRecord>(
    tasks.map((item) => [
      item,
      { key: item.key, status: "waiting", attempts: 0 },
    ]),
  );
  const errors: unknown[] = [],
    observerErrors: unknown[] = [];
  const active = new Map<Task, Promise<void>>();
  const record = (item: Task) => records.get(item)!;
  function emit(
    event: Omit<FlowEvent, "executionId" | "flow" | "timestamp">,
  ): void {
    try {
      options.observe?.({
        ...event,
        executionId,
        flow: name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      observerErrors.push(error);
    }
  }
  function finish(item: Task, status: TaskStatus): void {
    Object.assign(record(item), {
      status,
      finishedAt: new Date().toISOString(),
    });
    emit({
      type: "task",
      key: item.key,
      status,
      attempt: record(item).attempts,
    });
  }
  function context(
    item: Task,
    attempt: number,
    taskSignal: AbortSignal,
  ): TaskContext {
    return {
      signal: taskSignal,
      attempt,
      executionId,
      value<T>(dependency: Task<T>): T {
        if (!item.after.includes(dependency))
          throw new Error(
            `${item.key}: undeclared dependency ${dependency.key}`,
          );
        if (!values.has(dependency))
          throw new Error(`${dependency.key} has no successful value`);
        return values.get(dependency) as T;
      },
    };
  }
  async function launch(item: Task): Promise<void> {
    const state = record(item);
    state.status = "active";
    state.startedAt = new Date().toISOString();
    emit({ type: "task", key: item.key, status: "active", attempt: 0 });
    try {
      signal.throwIfAborted();
      if (item.condition && !(await item.condition(context(item, 0, signal)))) {
        signal.throwIfAborted();
        finish(item, "skipped");
        return;
      }
      const limit = item.retry?.attempts ?? 1;
      for (let attempt = 1; attempt <= limit; attempt++) {
        signal.throwIfAborted();
        state.attempts = attempt;
        const deadline = new AbortController();
        const timer =
          item.timeoutMs === undefined
            ? undefined
            : setTimeout(
                () => deadline.abort(new Error(`${item.key} timed out`)),
                item.timeoutMs,
              );
        const taskSignal = AbortSignal.any([signal, deadline.signal]);
        try {
          const value = await item.perform(context(item, attempt, taskSignal));
          taskSignal.throwIfAborted();
          values.set(item, value);
          finish(item, "done");
          return;
        } catch (error) {
          if (
            signal.aborted ||
            attempt === limit ||
            item.retry?.accepts?.(error, attempt) === false
          )
            throw error;
          emit({ type: "retry", key: item.key, attempt });
        } finally {
          clearTimeout(timer);
        }
        await delay(item.retry?.delayMs ?? 0, undefined, { signal });
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      if (signal.aborted) finish(item, "cancelled");
      else {
        errors.push(error);
        finish(item, "failed");
        if (options.stopOnError !== false) stop.abort(error);
      }
    }
  }
  emit({ type: "start" });
  while (true) {
    let changed = false;
    for (const item of tasks) {
      if (record(item).status !== "waiting") continue;
      if (signal.aborted) {
        finish(item, "cancelled");
        changed = true;
        continue;
      }
      const dependencies = item.after.map(
        (dependency) => record(dependency).status,
      );
      if (
        dependencies.some((status) =>
          ["failed", "skipped", "cancelled"].includes(status),
        )
      ) {
        finish(item, "skipped");
        changed = true;
        continue;
      }
      if (
        active.size >= concurrency ||
        !dependencies.every((status) => status === "done")
      )
        continue;
      const running = launch(item).finally(() => {
        active.delete(item);
      });
      active.set(item, running);
      changed = true;
    }
    if (active.size) await Promise.race(active.values());
    else if (!changed) break;
  }
  if (options.signal?.aborted) errors.push(options.signal.reason);
  const status = options.signal?.aborted
    ? "cancelled"
    : errors.length
      ? "failed"
      : "done";
  emit({ type: "finish" });
  const result: FlowResult = Object.freeze({
    executionId,
    name,
    status,
    tasks: Object.freeze(
      [...records.values()].map((value) => Object.freeze({ ...value })),
    ),
    errors: Object.freeze(errors),
    observerErrors: Object.freeze(observerErrors),
    value<T>(item: Task<T>): T {
      if (!values.has(item))
        throw new Error(
          `${item.key} has no successful value in this execution`,
        );
      return values.get(item) as T;
    },
    unwrap() {
      if (status !== "done") throw new FlowFailure(result);
    },
  });
  return result;
}
