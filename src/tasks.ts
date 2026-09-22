import type { AskOptions, Chamber } from "./chamber.ts";
import type { AgentAnswer, Exit, Invocation } from "./contracts.ts";
import { CommandError } from "./contracts.ts";
import { task } from "./flow.ts";
import type { Task, TaskContext, TaskOptions } from "./flow.ts";

type Base<T> = Omit<TaskOptions<T>, "perform">;

export function agentTask(
  options: Base<AgentAnswer> & {
    readonly chamber: Chamber;
    readonly request: (context: TaskContext) => Omit<AskOptions, "signal">;
  },
): Task<AgentAnswer> {
  const { chamber, request, ...definition } = options;
  return task({
    ...definition,
    perform: (context) =>
      chamber.ask({ ...request(context), signal: context.signal }),
  });
}

export function commandTask(
  options: Base<Exit> & {
    readonly chamber: Chamber;
    readonly command: Invocation | ((context: TaskContext) => Invocation);
  },
): Task<Exit> {
  const { chamber, command, ...definition } = options;
  return task({
    ...definition,
    async perform(context) {
      const invocation =
        typeof command === "function" ? command(context) : command;
      const result = await chamber.command({
        ...invocation,
        signal: context.signal,
      });
      if (result.code !== 0) throw new CommandError(invocation.program, result);
      return result;
    },
  });
}
