import assert from "node:assert/strict";
import { test } from "node:test";
import { invoke } from "../src/process.ts";

test("subprocess invocation preserves argv and stdin literally", async () => {
  const result = await invoke({
    program: process.execPath,
    args: [
      "-e",
      "process.stdin.pipe(process.stdout); console.error(process.argv[1])",
      "$(nope); &",
    ],
    input: "héllo",
  });
  assert.equal(result.stdout, "héllo");
  assert.match(result.stderr, /\$\(nope\); &/);
  assert.equal(result.code, 0);
});

test("process failures retain exit code and missing executables reject", async () => {
  assert.equal(
    (
      await invoke({
        program: process.execPath,
        args: ["-e", "process.exit(7)"],
      })
    ).code,
    7,
  );
  await assert.rejects(
    invoke({ program: "murmur-command-that-does-not-exist" }),
  );
});

test("hanging processes are terminated on deadline and cancellation", async () => {
  await assert.rejects(
    invoke({
      program: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      timeoutMs: 40,
    }),
    /timed out/,
  );
  const controller = new AbortController();
  const result = invoke({
    program: process.execPath,
    args: ["-e", "setInterval(()=>{}, 1000)"],
    signal: controller.signal,
  });
  controller.abort(new Error("stop now"));
  await assert.rejects(result, /stop now/);
});

test("bounded output and throwing stream callbacks terminate commands", async () => {
  await assert.rejects(
    invoke({
      program: process.execPath,
      args: ["-e", "console.log('x'.repeat(10000))"],
      maxBytes: 100,
    }),
    /exceeded/,
  );
  await assert.rejects(
    invoke({
      program: process.execPath,
      args: ["-e", "console.log('hello')"],
      onOutput() {
        throw new Error("bad consumer");
      },
    }),
    /bad consumer/,
  );
});
