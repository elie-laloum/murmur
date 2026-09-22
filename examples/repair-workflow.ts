import {
  agentTask,
  claudeDriver,
  codexDriver,
  commandTask,
  flow,
} from "../src/index.ts";
import type { Chamber, Flow } from "../src/index.ts";

export function repairWorkflow(
  room: Chamber,
  keys: { codex: string; claude: string },
): Flow {
  const install = commandTask({
    key: "install",
    chamber: room,
    command: { program: "npm", args: ["ci"] },
  });
  const implement = agentTask({
    key: "implement",
    after: [install],
    chamber: room,
    request: () => ({
      driver: codexDriver({ autonomous: true }),
      prompt: "Fix the failing tests. Make a minimal change and explain it.",
      credentials: { CODEX_API_KEY: keys.codex },
    }),
  });
  const verify = commandTask({
    key: "verify",
    after: [implement],
    chamber: room,
    command: { program: "npm", args: ["test"] },
  });
  const review = agentTask({
    key: "review",
    after: [implement, verify],
    chamber: room,
    request: (context) => ({
      driver: claudeDriver({ autonomous: true }),
      prompt: `Review the patch and fix remaining issues. Implementation summary:\n${context.value(implement).text}`,
      credentials: { ANTHROPIC_API_KEY: keys.claude },
    }),
  });
  const finalCheck = commandTask({
    key: "final-check",
    after: [review],
    chamber: room,
    command: { program: "npm", args: ["test"] },
  });
  return flow("repair-and-review", [
    install,
    implement,
    verify,
    review,
    finalCheck,
  ]);
}
