import assert from "node:assert/strict";
import { test } from "node:test";
import { containers } from "../src/index.ts";
import type { ContainerSettings } from "../src/index.ts";

test("runtime validation rejects unsafe or invalid provider configurations", () => {
  for (const settings of [
    { image: "" },
    { image: "--privileged" },
    { image: "node", uid: 0 },
    { image: "node", gid: 0 },
    { image: "node", memoryMb: 1 },
    { image: "node", cpus: Number.NaN },
    { image: "node", network: "host" },
    { image: "node", engine: "sh" },
  ])
    assert.throws(() => containers(settings as ContainerSettings));
});

test("ambiguous mount paths fail before calling a container engine", async () => {
  await assert.rejects(
    containers({ image: "node" }).provision("folder,with-comma"),
    /comma/,
  );
});
