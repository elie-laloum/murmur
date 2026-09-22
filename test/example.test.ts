import assert from "node:assert/strict";
import { test } from "node:test";
import type { AskOptions, Chamber, Invocation } from "../src/index.ts";
import { repairWorkflow } from "../examples/repair-workflow.ts";

test("the shipped repair workflow passes implementation context through both checks", async () => {
  const calls: string[] = [];
  const room = {
    async command(request: Invocation) {
      calls.push([request.program, ...(request.args ?? [])].join(" "));
      return { code: 0, stdout: "ok", stderr: "" };
    },
    async ask(request: AskOptions) {
      calls.push(request.driver.name);
      if (request.driver.name === "claude-code")
        assert.match(request.prompt, /implementation summary from Codex/);
      return {
        text: "implementation summary from Codex",
        events: [],
        exit: { code: 0, stdout: "", stderr: "" },
      };
    },
  } as unknown as Chamber;
  const result = await repairWorkflow(room, {
    codex: "fixture",
    claude: "fixture",
  }).start();
  result.unwrap();
  assert.deepEqual(calls, [
    "npm ci",
    "codex",
    "npm test",
    "claude-code",
    "npm test",
  ]);
});

test("the shipped repair workflow never reviews after failed verification", async () => {
  const calls: string[] = [];
  const room = {
    async command(request: Invocation) {
      return {
        code: request.args?.[0] === "test" ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    },
    async ask(request: AskOptions) {
      calls.push(request.driver.name);
      return {
        text: "done",
        events: [],
        exit: { code: 0, stdout: "", stderr: "" },
      };
    },
  } as unknown as Chamber;
  const result = await repairWorkflow(room, {
    codex: "fixture",
    claude: "fixture",
  }).start();
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, ["codex"]);
});
