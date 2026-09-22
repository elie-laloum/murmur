import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Exit, Invocation } from "./contracts.ts";

export interface ProcessOptions extends Invocation {
  readonly cwd?: string;
  readonly maxBytes?: number;
}

export function invoke(options: ProcessOptions): Promise<Exit> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1)
    throw new Error("timeoutMs must be positive");
  return new Promise((resolve, reject) => {
    const child = spawn(options.program, [...(options.args ?? [])], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let failure: unknown;
    let stdout = "",
      stderr = "",
      bytes = 0;
    const decoders = {
      stdout: new StringDecoder("utf8"),
      stderr: new StringDecoder("utf8"),
    };
    const stop = (error: unknown) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const abort = () => stop(options.signal?.reason ?? new Error("Aborted"));
    const timer = setTimeout(
      () => stop(new Error(`Command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    function consume(channel: "stdout" | "stderr", data: Buffer): void {
      bytes += data.length;
      if (bytes > maxBytes) {
        stop(new Error(`Command output exceeded ${maxBytes} bytes`));
        return;
      }
      const text = decoders[channel].write(data);
      if (channel === "stdout") stdout += text;
      else stderr += text;
      try {
        options.onOutput?.(channel, text);
      } catch (error) {
        stop(error);
      }
    }
    child.stdout.on("data", (data: Buffer) => consume("stdout", data));
    child.stderr.on("data", (data: Buffer) => consume("stderr", data));
    child.stdin.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error);
    });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      stdout += decoders.stdout.end();
      stderr += decoders.stderr.end();
      if (failure !== undefined) reject(failure);
      else resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}
