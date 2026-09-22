import type { AgentAnswer } from "./contracts.ts";
import type { AskOptions, Chamber } from "./chamber.ts";

export interface IterationOptions {
  readonly chamber: Chamber;
  readonly request: Omit<AskOptions, "sessionId">;
  readonly limit: number;
  readonly evaluate: (
    answer: AgentAnswer,
    round: number,
  ) =>
    | Promise<{ readonly done: boolean; readonly feedback?: string }>
    | { readonly done: boolean; readonly feedback?: string };
}

export interface IterationResult {
  readonly converged: boolean;
  readonly answers: readonly AgentAnswer[];
}

export async function iterate(
  options: IterationOptions,
): Promise<IterationResult> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1)
    throw new Error("Iteration limit must be a positive integer");
  const answers: AgentAnswer[] = [];
  let prompt = options.request.prompt;
  let sessionId: string | undefined;
  for (let round = 1; round <= options.limit; round++) {
    options.request.signal?.throwIfAborted();
    const answer = await options.chamber.ask({
      ...options.request,
      prompt,
      ...(sessionId ? { sessionId } : {}),
    });
    answers.push(answer);
    const assessment = await options.evaluate(answer, round);
    options.request.signal?.throwIfAborted();
    if (assessment.done)
      return Object.freeze({
        converged: true,
        answers: Object.freeze(answers),
      });
    sessionId = answer.sessionId;
    prompt =
      assessment.feedback ?? "Continue working toward the requested result.";
    if (!sessionId)
      prompt = `${options.request.prompt}\n\nPrevious answer:\n${answer.text}\n\nFeedback:\n${prompt}`;
  }
  return Object.freeze({ converged: false, answers: Object.freeze(answers) });
}

export function decodeJson<T>(
  answer: AgentAnswer,
  validate: (value: unknown) => T,
): T {
  const trimmed = answer.text.trim();
  const json =
    trimmed.startsWith("```json\n") && trimmed.endsWith("```")
      ? trimmed.slice(8, -3).trim()
      : trimmed;
  return validate(JSON.parse(json) as unknown);
}
