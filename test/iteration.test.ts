import assert from "node:assert/strict";
import { test } from "node:test";
import { iterate, decodeJson, codexDriver } from "../src/index.ts";
import type { AgentAnswer, AskOptions, Chamber } from "../src/index.ts";

function answer(text: string, sessionId?: string): AgentAnswer {
  return {
    text,
    events: [],
    exit: { code: 0, stdout: "", stderr: "" },
    ...(sessionId ? { sessionId } : {}),
  };
}

test("iteration resumes the previous session and stops on a passing check", async () => {
  const seen: AskOptions[] = [];
  const room = {
    async ask(request: AskOptions) {
      seen.push(request);
      return answer("result", "session");
    },
  } as Chamber;
  const result = await iterate({
    chamber: room,
    request: { driver: codexDriver(), prompt: "fix" },
    limit: 3,
    evaluate: (_, round) => ({
      done: round === 2,
      feedback: "test still fails",
    }),
  });
  assert.equal(result.converged, true);
  assert.equal(result.answers.length, 2);
  assert.equal(seen[1]?.sessionId, "session");
  assert.equal(seen[1]?.prompt, "test still fails");
});

test("iteration budgets are explicit and do not report exhaustion as success", async () => {
  const room = {
    async ask() {
      return answer("not yet");
    },
  } as unknown as Chamber;
  const result = await iterate({
    chamber: room,
    request: { driver: codexDriver(), prompt: "fix" },
    limit: 2,
    evaluate: () => ({ done: false }),
  });
  assert.equal(result.converged, false);
  assert.equal(result.answers.length, 2);
});

test("structured output requires parsing and caller-supplied validation", () => {
  const validate = (value: unknown) => {
    assert.ok(
      value &&
        typeof value === "object" &&
        "count" in value &&
        typeof value.count === "number",
    );
    return value.count;
  };
  assert.equal(decodeJson(answer('```json\n{"count":2}\n```'), validate), 2);
  assert.throws(() => decodeJson(answer('{"count":"bad"}'), validate));
  assert.throws(() => decodeJson(answer("not JSON"), validate));
});
