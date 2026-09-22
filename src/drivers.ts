import type {
  AgentDriver,
  AgentEvent,
  AgentRequest,
  Invocation,
} from "./contracts.ts";

export interface DriverSettings {
  readonly model?: string;
  readonly autonomous?: boolean;
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function codexDriver(settings: DriverSettings = {}): AgentDriver {
  return Object.freeze({
    name: "codex",
    prepare(request: AgentRequest): Invocation {
      const args = ["exec"];
      if (request.sessionId) args.push("resume", request.sessionId);
      args.push("--json");
      if (settings.model) args.push("--model", settings.model);
      if (settings.autonomous)
        args.push("--dangerously-bypass-approvals-and-sandbox");
      args.push("-");
      return { program: "codex", args, input: request.prompt };
    },
    decode(line: string): readonly AgentEvent[] {
      const value = parse(line);
      if (!value) return [{ type: "raw", value: line }];
      if (
        value.type === "thread.started" &&
        typeof value.thread_id === "string"
      )
        return [{ type: "session", id: value.thread_id }];
      const item = object(value.item);
      if (
        value.type === "item.completed" &&
        item.type === "agent_message" &&
        typeof item.text === "string"
      )
        return [{ type: "text", text: item.text }];
      if (value.type === "turn.completed") return [{ type: "complete" }];
      if (value.type === "turn.failed" || value.type === "error")
        return [
          {
            type: "error",
            message: String(
              object(value.error).message ??
                value.message ??
                "Codex request failed",
            ),
          },
        ];
      return [{ type: "raw", value }];
    },
  });
}

export function claudeDriver(settings: DriverSettings = {}): AgentDriver {
  return Object.freeze({
    name: "claude-code",
    prepare(request: AgentRequest): Invocation {
      const args = ["--print", "--verbose", "--output-format", "stream-json"];
      if (request.sessionId) args.push("--resume", request.sessionId);
      if (settings.model) args.push("--model", settings.model);
      if (settings.autonomous) args.push("--dangerously-skip-permissions");
      return { program: "claude", args, input: request.prompt };
    },
    decode(line: string): readonly AgentEvent[] {
      const value = parse(line);
      if (!value) return [{ type: "raw", value: line }];
      if (
        value.type === "system" &&
        value.subtype === "init" &&
        typeof value.session_id === "string"
      )
        return [{ type: "session", id: value.session_id }];
      if (value.type === "assistant") {
        const content = object(value.message).content;
        if (Array.isArray(content))
          return content.flatMap<AgentEvent>((part) => {
            const block = object(part);
            return block.type === "text" && typeof block.text === "string"
              ? [{ type: "text" as const, text: block.text }]
              : [{ type: "raw" as const, value: part }];
          });
      }
      if (value.type === "result") {
        if (value.is_error)
          return [
            {
              type: "error",
              message: String(
                value.result ??
                  JSON.stringify(value.errors) ??
                  "Claude request failed",
              ),
            },
          ];
        return [{ type: "complete" }];
      }
      return [{ type: "raw", value }];
    },
  });
}
