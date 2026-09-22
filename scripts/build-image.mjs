import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const versions = JSON.parse(
  await readFile(
    new URL("../containers/versions.json", import.meta.url),
    "utf8",
  ),
);
const engine = process.env.MURMUR_ENGINE ?? "docker";
if (!["docker", "podman"].includes(engine))
  throw new Error("MURMUR_ENGINE must be docker or podman");
const result = spawnSync(
  engine,
  [
    "build",
    "-f",
    "containers/Dockerfile",
    "--build-arg",
    `CODEX_VERSION=${versions.codex}`,
    "--build-arg",
    `CLAUDE_VERSION=${versions.claudeCode}`,
    "-t",
    "murmur-agents:local",
    ".",
  ],
  { cwd: root, stdio: "inherit", shell: false },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
