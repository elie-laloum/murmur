import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/process.ts";

export async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "murmur-test-"));
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Murmur Test"],
    ["config", "user.email", "test@localhost"],
  ]) {
    const result = await invoke({ program: "git", args, cwd: directory });
    if (result.code) throw new Error(result.stderr);
  }
  await writeFile(join(directory, "input.txt"), "original\n");
  await invoke({ program: "git", args: ["add", "."], cwd: directory });
  const result = await invoke({
    program: "git",
    args: ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
    cwd: directory,
  });
  if (result.code) throw new Error(result.stderr);
  return directory;
}
