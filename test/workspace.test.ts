import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkout } from "../src/index.ts";
import { invoke } from "../src/process.ts";
import { repository } from "./helpers.ts";

test("a checkout isolates committed state and exports added, deleted and binary files", async () => {
  const source = await repository();
  let directory: string | undefined;
  try {
    await writeFile(join(source, "input.txt"), "host dirty\n");
    const workspace = await checkout(source);
    directory = workspace.directory;
    assert.equal(
      await readFile(join(directory, "input.txt"), "utf8"),
      "original\n",
    );
    await rm(join(directory, "input.txt"));
    await writeFile(join(directory, "new.txt"), "new\n");
    await writeFile(
      join(directory, "binary.dat"),
      Buffer.from([0, 1, 255, 0, 9]),
    );
    assert.deepEqual(await workspace.changedFiles(), [
      "binary.dat",
      "input.txt",
      "new.txt",
    ]);
    const patch = await workspace.patch();
    assert.match(patch, /GIT binary patch/);
    assert.match(patch, /deleted file/);
    assert.equal(
      await readFile(join(source, "input.txt"), "utf8"),
      "host dirty\n",
    );
    const pristine = await checkout(source);
    try {
      const applied = await invoke({
        program: "git",
        args: ["apply", "--check", "-"],
        input: patch,
        cwd: pristine.directory,
      });
      assert.equal(applied.code, 0, applied.stderr);
    } finally {
      await rm(dirname(pristine.directory), { recursive: true, force: true });
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    if (directory)
      await rm(dirname(directory), { recursive: true, force: true });
  }
});

test("export never consults Git config modified inside the agent checkout", async () => {
  const source = await repository();
  const workspace = await checkout(source);
  try {
    await writeFile(
      join(workspace.directory, ".git", "config"),
      "[invalid configuration",
    );
    await writeFile(join(workspace.directory, "input.txt"), "updated\n");
    assert.match(await workspace.patch(), /\+updated/);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(dirname(workspace.directory), { recursive: true, force: true });
  }
});

test("invalid revisions cannot become Git options", async () => {
  const source = await repository();
  try {
    await assert.rejects(checkout(source, "--help"));
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
