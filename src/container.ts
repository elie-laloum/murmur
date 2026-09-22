import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CommandError } from "./contracts.ts";
import type { Exit, Invocation, Isolator } from "./contracts.ts";
import { invoke } from "./process.ts";

export interface ContainerSettings {
  readonly engine?: "docker" | "podman";
  readonly image: string;
  readonly network?: "bridge" | "none";
  readonly memoryMb?: number;
  readonly cpus?: number;
  readonly uid?: number;
  readonly gid?: number;
}

export function containers(settings: ContainerSettings): Isolator {
  if (!settings.image || settings.image.startsWith("-"))
    throw new Error("A container image is required");
  const engine = settings.engine ?? "docker";
  if (engine !== "docker" && engine !== "podman")
    throw new Error("Container engine must be docker or podman");
  const network = settings.network ?? "bridge";
  if (network !== "bridge" && network !== "none")
    throw new Error("Container network must be bridge or none");
  const image = settings.image;
  const memory = settings.memoryMb ?? 2048;
  const cpus = settings.cpus ?? 2;
  const uid = settings.uid ?? (process.getuid?.() || 1000);
  const gid = settings.gid ?? (process.getgid?.() || 1000);
  if (
    !Number.isInteger(memory) ||
    memory < 64 ||
    !Number.isFinite(cpus) ||
    cpus <= 0
  )
    throw new Error("Invalid container resource limits");
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1)
    throw new Error("Containers must use a non-root user and group");
  return {
    name: engine,
    async provision(directory, signal) {
      const host = resolve(directory);
      if (host.includes(","))
        throw new Error("Container workspace path cannot contain a comma");
      const name = `murmur-${randomUUID()}`;
      let closed = false;
      let removal: Promise<void> | undefined;
      let busy = false;
      const checked = async (
        args: string[],
        extra: Partial<Invocation> = {},
      ): Promise<Exit> => {
        const result = await invoke({
          program: engine,
          args,
          timeoutMs: 60_000,
          ...extra,
        });
        if (result.code !== 0) throw new CommandError(engine, result);
        return result;
      };
      const dispose = (): Promise<void> => {
        closed = true;
        removal ??= checked(["rm", "--force", name])
          .then(() => undefined)
          .catch((error) => {
            removal = undefined;
            throw error;
          });
        return removal;
      };
      const args = [
        "create",
        "--name",
        name,
        "--init",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "256",
        "--memory",
        `${memory}m`,
        "--cpus",
        String(cpus),
        "--user",
        `${uid}:${gid}`,
        "--network",
        network,
        "--workdir",
        "/workspace",
        "--mount",
        `type=bind,source=${host},target=/workspace`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=512m",
        "--tmpfs",
        `/home/agent:rw,nosuid,nodev,uid=${uid},gid=${gid},mode=0700,size=512m`,
        "--env",
        "HOME=/home/agent",
        "--env",
        "GIT_CONFIG_COUNT=1",
        "--env",
        "GIT_CONFIG_KEY_0=safe.directory",
        "--env",
        "GIT_CONFIG_VALUE_0=/workspace",
        "--env",
        "GIT_AUTHOR_NAME=Murmur",
        "--env",
        "GIT_AUTHOR_EMAIL=murmur@localhost",
        "--env",
        "GIT_COMMITTER_NAME=Murmur",
        "--env",
        "GIT_COMMITTER_EMAIL=murmur@localhost",
        "--entrypoint",
        "sleep",
        image,
        "infinity",
      ];
      try {
        await checked(args, { ...(signal ? { signal } : {}) });
        await checked(["start", name], { ...(signal ? { signal } : {}) });
      } catch (error) {
        const cleanup = await invoke({
          program: engine,
          args: ["rm", "--force", name],
          timeoutMs: 30_000,
        }).catch(() => undefined);
        if (
          cleanup &&
          cleanup.code !== 0 &&
          !cleanup.stderr.includes("No such container")
        )
          throw new AggregateError(
            [error, new CommandError(engine, cleanup)],
            "Provisioning and cleanup failed",
          );
        throw error;
      }
      return {
        kind: "container" as const,
        async execute(command) {
          if (closed) throw new Error("Isolation is closed");
          if (busy)
            throw new Error("An isolation accepts one command at a time");
          command.signal?.throwIfAborted();
          const env = command.env ?? {};
          if (
            Object.keys(env).some(
              (key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
            )
          )
            throw new Error("Invalid environment variable name");
          busy = true;
          try {
            return await invoke({
              ...command,
              program: engine,
              env,
              args: [
                "exec",
                "-i",
                ...Object.keys(env).flatMap((key) => ["--env", key]),
                name,
                command.program,
                ...(command.args ?? []),
              ],
            });
          } catch (error) {
            try {
              await dispose();
            } catch (cleanup) {
              throw new AggregateError(
                [error, cleanup],
                "Execution and container cleanup failed",
              );
            }
            throw error;
          } finally {
            busy = false;
          }
        },
        dispose,
      };
    },
  };
}
