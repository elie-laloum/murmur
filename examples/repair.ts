import {
  agentTask,
  chamber,
  claudeDriver,
  codexDriver,
  commandTask,
  containers,
  flow,
} from "../src/index.ts";

const repository = process.argv[2];
if (!repository)
  throw new Error(
    "Usage: node --env-file=.env examples/repair.ts /path/to/repository",
  );
const codexKey = process.env.CODEX_API_KEY;
const claudeKey = process.env.ANTHROPIC_API_KEY;
if (!codexKey || !claudeKey)
  throw new Error("Set CODEX_API_KEY and ANTHROPIC_API_KEY");

await using room = await chamber({
  repository,
  isolator: containers({ image: "murmur-agents:local" }),
});
console.log(`Changes will remain in ${room.workspace.directory}`);
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
    credentials: { CODEX_API_KEY: codexKey },
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
  after: [verify],
  chamber: room,
  request: (context) => ({
    driver: claudeDriver({ autonomous: true }),
    prompt: `Review the patch and fix remaining issues. Implementation summary:\n${context.value(implement).text}`,
    credentials: { ANTHROPIC_API_KEY: claudeKey },
  }),
});
const finalCheck = commandTask({
  key: "final-check",
  after: [review],
  chamber: room,
  command: { program: "npm", args: ["test"] },
});
const result = await flow("repair-and-review", [
  install,
  implement,
  verify,
  review,
  finalCheck,
]).start({ observe: (event) => console.log(JSON.stringify(event)) });
await room.workspace.savePatch("murmur.patch");
result.unwrap();
console.log("Verified changes exported to murmur.patch");
