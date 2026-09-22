import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CommandError } from "./contracts.ts";
import { invoke } from "./process.ts";

export interface Checkout {
  readonly directory: string;
  readonly baseline: string;
  readonly source: string;
  patch(): Promise<string>;
  savePatch(destination: string): Promise<void>;
  changedFiles(): Promise<readonly string[]>;
}

export async function checkout(
  repository: string,
  ref = "HEAD",
): Promise<Checkout> {
  const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
  const source = await realpath(resolve(repository));
  const git = async (cwd: string, args: string[]) => {
    const result = await invoke({
      program: "git",
      args: [
        "-c",
        `core.hooksPath=${devNull}`,
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      cwd,
      timeoutMs: 60_000,
      env: {
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_SYSTEM: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    if (result.code !== 0) throw new CommandError("git", result);
    return result.stdout;
  };
  const baseline = (
    await git(source, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  const parent = await mkdtemp(join(tmpdir(), "murmur-"));
  const directory = join(parent, "checkout");
  const metadata = join(parent, "export.git");
  await git(source, [
    "clone",
    "--bare",
    "--no-hardlinks",
    "--",
    source,
    metadata,
  ]);
  await git(source, [
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    "--",
    metadata,
    directory,
  ]);
  await git(directory, ["checkout", "--detach", baseline]);
  await git(directory, ["remote", "remove", "origin"]);
  await git(directory, ["config", "core.hooksPath", "/dev/null"]);
  const exportGit = (args: string[]) =>
    git(parent, [`--git-dir=${metadata}`, `--work-tree=${directory}`, ...args]);
  await exportGit(["read-tree", baseline]);
  const patch = async () => {
    await exportGit(["add", "--all"]);
    return exportGit([
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      baseline,
      "--",
    ]);
  };
  return Object.freeze({
    directory,
    baseline,
    source,
    patch,
    async savePatch(destination: string) {
      await writeFile(destination, await patch(), "utf8");
    },
    async changedFiles() {
      await exportGit(["add", "--all"]);
      const output = await exportGit([
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--name-only",
        "-z",
        baseline,
        "--",
      ]);
      return output.split("\0").filter(Boolean);
    },
  });
}
