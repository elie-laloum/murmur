import assert from "node:assert/strict";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  chamber,
  containers,
  codexDriver,
  claudeDriver,
} from "../../src/index.ts";
import { repository } from "../helpers.ts";

const enabled = process.env.MURMUR_CONTAINER_TEST === "1";
test(
  "pinned agent image contains both working CLI binaries",
  { skip: process.env.MURMUR_AGENT_IMAGE_TEST !== "1" },
  async () => {
    const source = await repository();
    const room = await chamber({
      repository: source,
      isolator: containers({ image: "murmur-agents:local", network: "none" }),
    });
    try {
      for (const program of ["codex", "claude"]) {
        const result = await room.command({ program, args: ["--version"] });
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /\d+\.\d+/);
      }
      const codex = await room.command({
        program: "codex",
        args: ["exec", "resume", "--help"],
      });
      assert.equal(codex.code, 0, codex.stderr);
      assert.match(codex.stdout, /--json/);
      assert.match(codex.stdout, /--dangerously-bypass-approvals-and-sandbox/);
      const claude = await room.command({
        program: "claude",
        args: ["--help"],
      });
      assert.equal(claude.code, 0, claude.stderr);
      assert.match(claude.stdout, /stream-json/);
    } finally {
      await room.close();
      await rm(source, { recursive: true, force: true });
      await rm(dirname(room.workspace.directory), {
        recursive: true,
        force: true,
      });
    }
  },
);
test(
  "real container edits, isolation boundaries, patch export and cancellation",
  { skip: !enabled },
  async () => {
    const source = await repository();
    const room = await chamber({
      repository: source,
      isolator: containers({ image: "node:24-bookworm-slim", network: "none" }),
    });
    try {
      const uid = await room.command({ program: "id", args: ["-u"] });
      assert.equal(uid.code, 0);
      assert.notEqual(uid.stdout.trim(), "0");
      const result = await room.command({
        program: "node",
        args: [
          "-e",
          "const fs=require('fs');fs.writeFileSync('input.txt','container edit\\n');console.log(fs.existsSync('/var/run/docker.sock'));try{fs.writeFileSync('/etc/murmur-test','x');process.exit(3)}catch{}",
        ],
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout.trim(), "false");
      assert.match(await room.workspace.patch(), /\+container edit/);
      const credential = await room.command({
        program: "node",
        args: ["-e", "console.log(process.env.MURMUR_TEST_SECRET)"],
        env: { MURMUR_TEST_SECRET: "fixture-only" },
      });
      assert.equal(credential.stdout.trim(), "fixture-only");
      const next = await room.command({
        program: "node",
        args: ["-e", "console.log(process.env.MURMUR_TEST_SECRET ?? 'absent')"],
      });
      assert.equal(next.stdout.trim(), "absent");
      await assert.rejects(
        room.command({ program: "sleep", args: ["60"], timeoutMs: 100 }),
        /timed out/,
      );
      await assert.rejects(room.command({ program: "true" }), /closed/);
    } finally {
      await room.close();
      await rm(source, { recursive: true, force: true });
      await rm(dirname(room.workspace.directory), {
        recursive: true,
        force: true,
      });
    }
  },
);

test(
  "real CLI adapters complete against live providers",
  { skip: process.env.MURMUR_LIVE_TEST !== "1" },
  async () => {
    const source = await repository();
    const room = await chamber({
      repository: source,
      isolator: containers({
        image: process.env.MURMUR_IMAGE ?? "murmur-agents:local",
      }),
    });
    try {
      const candidates = [
        {
          driver: codexDriver({ autonomous: true }),
          credentials: { CODEX_API_KEY: process.env.CODEX_API_KEY ?? "" },
        },
        {
          driver: claudeDriver({ autonomous: true }),
          credentials: {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
          },
        },
      ];
      for (const candidate of candidates) {
        assert.ok(
          Object.values(candidate.credentials)[0],
          "Live tests require both provider keys",
        );
        const result = await room.ask({
          ...candidate,
          prompt:
            "Read input.txt and reply with its exact content. Do not modify files.",
          timeoutMs: 120000,
        });
        assert.match(result.text, /original/);
        assert.ok(result.sessionId);
      }
    } finally {
      await room.close();
      await rm(source, { recursive: true, force: true });
      await rm(dirname(room.workspace.directory), {
        recursive: true,
        force: true,
      });
    }
  },
);
