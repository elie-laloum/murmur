import type {
  AgentAnswer,
  AgentDriver,
  AgentEvent,
  AgentRequest,
  Exit,
  Invocation,
  Isolation,
  Isolator,
} from "./contracts.ts";
import { CommandError } from "./contracts.ts";
import { checkout } from "./workspace.ts";
import type { Checkout } from "./workspace.ts";

export interface ChamberOptions {
  readonly repository: string;
  readonly isolator: Isolator;
  readonly ref?: string;
  readonly signal?: AbortSignal;
}

export interface AskOptions extends AgentRequest {
  readonly driver: AgentDriver;
  readonly credentials?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onEvent?: (event: AgentEvent) => void;
}

export interface Chamber {
  readonly workspace: Checkout;
  ask(options: AskOptions): Promise<AgentAnswer>;
  command(invocation: Invocation): Promise<Exit>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export async function chamber(options: ChamberOptions): Promise<Chamber> {
  options.signal?.throwIfAborted();
  const workspace = await checkout(options.repository, options.ref);
  options.signal?.throwIfAborted();
  let isolation: Isolation;
  try {
    isolation = await options.isolator.provision(
      workspace.directory,
      options.signal,
    );
  } catch (cause) {
    throw new Error(
      `Cannot provision isolation; checkout retained at ${workspace.directory}`,
      { cause },
    );
  }
  let closing = false;
  let tail: Promise<unknown> = Promise.resolve();
  let cleanup: Promise<void> | undefined;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closing)
      return Promise.reject(new Error("Chamber is closing or closed"));
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  const command = (invocation: Invocation) =>
    enqueue(() => isolation.execute(invocation));
  const close = (): Promise<void> => {
    closing = true;
    cleanup ??= tail
      .then(() => isolation.dispose())
      .catch((error) => {
        cleanup = undefined;
        throw error;
      });
    return cleanup;
  };
  return Object.freeze({
    workspace,
    command,
    ask: (request: AskOptions) => enqueue(() => ask(isolation, request)),
    close,
    [Symbol.asyncDispose]: close,
  });
}

async function ask(
  isolation: Isolation,
  options: AskOptions,
): Promise<AgentAnswer> {
  if (!options.prompt.trim()) throw new Error("Prompt cannot be empty");
  if (options.sessionId !== undefined && !options.sessionId.trim())
    throw new Error("sessionId cannot be empty");
  const events: AgentEvent[] = [];
  let text = "",
    sessionId: string | undefined,
    buffer = "";
  const accept = (line: string) => {
    if (!line.trim()) return;
    for (const event of options.driver.decode(line)) {
      events.push(event);
      if (event.type === "text") text += event.text;
      if (event.type === "session") sessionId = event.id;
      options.onEvent?.(event);
    }
  };
  const prepared = options.driver.prepare(options);
  const exit = await isolation.execute({
    ...prepared,
    env: { ...prepared.env, ...options.credentials },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    onOutput(channel, chunk) {
      if (channel !== "stdout") return;
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        accept(buffer.slice(0, index).replace(/\r$/, ""));
        buffer = buffer.slice(index + 1);
      }
    },
  });
  accept(buffer);
  if (exit.code !== 0) throw new CommandError(options.driver.name, exit);
  const failure = events.find((event) => event.type === "error");
  if (failure?.type === "error")
    throw new Error(`${options.driver.name}: ${failure.message}`);
  if (!events.some((event) => event.type === "complete"))
    throw new Error(
      `${options.driver.name}: stream ended without a completion event`,
    );
  return Object.freeze({
    text,
    events: Object.freeze(events),
    exit,
    ...(sessionId ? { sessionId } : {}),
  });
}

export async function delegate(
  options: ChamberOptions & AskOptions,
): Promise<AgentAnswer & { readonly workspace: Checkout }> {
  const room = await chamber(options);
  try {
    return { ...(await room.ask(options)), workspace: room.workspace };
  } finally {
    await room.close();
  }
}
