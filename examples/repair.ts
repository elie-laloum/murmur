import { chamber, containers } from "../src/index.ts";
import { repairWorkflow } from "./repair-workflow.ts";

const repository = process.argv[2];
if (!repository)
  throw new Error(
    "Usage: node --env-file=.env examples/repair.ts /path/to/repository",
  );
const codex = process.env.CODEX_API_KEY;
const claude = process.env.ANTHROPIC_API_KEY;
if (!codex || !claude)
  throw new Error("Set CODEX_API_KEY and ANTHROPIC_API_KEY");

await using room = await chamber({
  repository,
  isolator: containers({ image: "murmur-agents:local" }),
});
console.log(`Changes will remain in ${room.workspace.directory}`);
const result = await repairWorkflow(room, { codex, claude }).start({
  observe: (event) => console.log(JSON.stringify(event)),
});
await room.workspace.savePatch("murmur.patch");
result.unwrap();
console.log("Verified changes exported to murmur.patch");
