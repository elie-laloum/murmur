import assert from "node:assert/strict";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chamber, codexDriver, commandTask, flow } from "../src/index.ts";
import type { Isolator, Invocation, Exit } from "../src/index.ts";
import { repository } from "./helpers.ts";

function fixture(
  execute: (invocation: Invocation) => Promise<Exit>,
  dispose: () => Promise<void> = async () => {},
): Isolator {
  return {
    name: "test-double",
    async provision() {
      return { kind: "remote", execute, dispose };
    },
  };
}

test("chamber decodes fragmented streams, preserves session and disposes once", async () => {
  const source = await repository();
  let disposed = 0;
  const room = await chamber({
    repository: source,
    isolator: fixture(
      async (command) => {
        assert.equal(command.input, "implement");
        command.onOutput?.(
          "stdout",
          '{"type":"thread.started","thread_id":"abc"}\n{"type":"item.com',
        );
        command.onOutput?.(
          "stdout",
          'pleted","item":{"type":"agent_message","text":"hello"}}\r\n{"type":"turn.completed"}',
        );
        return { code: 0, stdout: "", stderr: "" };
      },
      async () => {
        disposed++;
      },
    ),
  });
  try {
    const answer = await room.ask({
      driver: codexDriver(),
      prompt: "implement",
    });
    assert.equal(answer.text, "hello");
    assert.equal(answer.sessionId, "abc");
    await Promise.all([room.close(), room.close()]);
    assert.equal(disposed, 1);
    await assert.rejects(room.command({ program: "nope" }), /closed/);
  } finally {
    await room.close();
    await rm(source, { recursive: true, force: true });
    await rm(dirname(room.workspace.directory), {
      recursive: true,
      force: true,
    });
  }
});

test("parallel chamber requests are serialized and close drains the queue", async () => {
  const source = await repository();
  let active = 0,
    peak = 0,
    completed = 0;
  const room = await chamber({
    repository: source,
    isolator: fixture(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(15);
        active--;
        completed++;
        return { code: 0, stdout: "", stderr: "" };
      },
      async () => {
        assert.equal(completed, 3);
      },
    ),
  });
  try {
    const requests = [1, 2, 3].map(() => room.command({ program: "test" }));
    await room.close();
    await Promise.all(requests);
    assert.equal(peak, 1);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(dirname(room.workspace.directory), {
      recursive: true,
      force: true,
    });
  }
});

test("nonzero check commands fail workflows", async () => {
  const source = await repository();
  const room = await chamber({
    repository: source,
    isolator: fixture(async () => ({
      code: 2,
      stdout: "",
      stderr: "assertion failed",
    })),
  });
  try {
    const check = commandTask({
      key: "verify",
      chamber: room,
      command: { program: "npm", args: ["test"] },
    });
    const result = await flow("gate", [check]).start();
    assert.equal(result.status, "failed");
  } finally {
    await room.close();
    await rm(source, { recursive: true, force: true });
    await rm(dirname(room.workspace.directory), {
      recursive: true,
      force: true,
    });
  }
});

test("truncated and application-error streams are failures even with exit zero", async () => {
  const source = await repository();
  for (const line of [
    '{"type":"thread.started","thread_id":"x"}',
    '{"type":"turn.failed","error":{"message":"denied"}}',
  ]) {
    const room = await chamber({
      repository: source,
      isolator: fixture(async (command) => {
        command.onOutput?.("stdout", line);
        return { code: 0, stdout: line, stderr: "" };
      }),
    });
    try {
      await assert.rejects(
        room.ask({ driver: codexDriver(), prompt: "test" }),
        /completion|denied/,
      );
    } finally {
      await room.close();
      await rm(dirname(room.workspace.directory), {
        recursive: true,
        force: true,
      });
    }
  }
  await rm(source, { recursive: true, force: true });
});
