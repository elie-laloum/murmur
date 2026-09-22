export interface Invocation {
  readonly program: string;
  readonly args?: readonly string[];
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (channel: "stdout" | "stderr", chunk: string) => void;
}

export interface Exit {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Isolation {
  readonly kind: "container" | "remote";
  execute(invocation: Invocation): Promise<Exit>;
  dispose(): Promise<void>;
}

export interface Isolator {
  readonly name: string;
  provision(directory: string, signal?: AbortSignal): Promise<Isolation>;
}

export type AgentEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "session"; readonly id: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "complete" }
  | { readonly type: "raw"; readonly value: unknown };

export interface AgentRequest {
  readonly prompt: string;
  readonly sessionId?: string;
}

export interface AgentDriver {
  readonly name: string;
  prepare(request: AgentRequest): Invocation;
  decode(line: string): readonly AgentEvent[];
}

export interface AgentAnswer {
  readonly text: string;
  readonly sessionId?: string;
  readonly events: readonly AgentEvent[];
  readonly exit: Exit;
}

export class CommandError extends Error {
  readonly exit: Exit;
  constructor(program: string, exit: Exit) {
    super(`${program} exited with status ${exit.code}`);
    this.name = "CommandError";
    this.exit = exit;
  }
}
