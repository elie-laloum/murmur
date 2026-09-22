import assert from "node:assert/strict";
import { test } from "node:test";
import { codexDriver, claudeDriver } from "../src/index.ts";

test("Codex passes prompts over stdin without shell interpolation", () => {
  const prompt = 'hello $(touch nope) " ; &';
  const command = codexDriver({ model: "chosen-model" }).prepare({ prompt });
  assert.equal(command.input, prompt);
  assert.ok(!command.args?.includes(prompt));
  assert.deepEqual(command.args, [
    "exec",
    "--json",
    "--model",
    "chosen-model",
    "-",
  ]);
});

test("Codex resume and autonomous flags are explicit", () => {
  const args = codexDriver({ autonomous: true }).prepare({
    prompt: "continue",
    sessionId: "thread-1",
  }).args;
  assert.deepEqual(args, [
    "exec",
    "resume",
    "thread-1",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "-",
  ]);
});

test("Codex events capture session, text, completion and failures", () => {
  const driver = codexDriver();
  assert.deepEqual(
    driver.decode('{"type":"thread.started","thread_id":"abc"}'),
    [{ type: "session", id: "abc" }],
  );
  assert.deepEqual(
    driver.decode(
      '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    ),
    [{ type: "text", text: "done" }],
  );
  assert.deepEqual(driver.decode('{"type":"turn.completed"}'), [
    { type: "complete" },
  ]);
  assert.equal(
    driver.decode('{"type":"turn.failed","error":{"message":"quota"}}')[0]
      ?.type,
    "error",
  );
  assert.equal(driver.decode("plain diagnostic")[0]?.type, "raw");
});

test("Claude command supports model and explicit session continuity", () => {
  const command = claudeDriver({ model: "sonnet", autonomous: true }).prepare({
    prompt: "fix",
    sessionId: "abc",
  });
  assert.equal(command.program, "claude");
  assert.equal(command.input, "fix");
  assert.ok(command.args?.includes("stream-json"));
  assert.ok(command.args?.includes("--resume"));
  assert.ok(command.args?.includes("--dangerously-skip-permissions"));
});

test("Claude does not duplicate result text already present in assistant events", () => {
  const driver = claudeDriver();
  assert.deepEqual(
    driver.decode(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"answer"}]}}',
    ),
    [{ type: "text", text: "answer" }],
  );
  assert.deepEqual(
    driver.decode('{"type":"result","is_error":false,"result":"answer"}'),
    [{ type: "complete" }],
  );
  assert.equal(
    driver.decode('{"type":"result","is_error":true,"result":"denied"}')[0]
      ?.type,
    "error",
  );
  assert.deepEqual(
    driver.decode('{"type":"system","subtype":"init","session_id":"xyz"}'),
    [{ type: "session", id: "xyz" }],
  );
});
