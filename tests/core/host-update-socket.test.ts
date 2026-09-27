// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.31: the app talks to the host executor only through its private Unix
// socket, and only an owner with a fresh step-up factor may request an apply.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "@/core/service";
import { resetEnvForTests } from "@/core/env";
import { getHostUpdateStatus, requestHostUpdate } from "@/core/update/host";
import { OWNER } from "../helpers/spine";

// A stepped-up owner: the fresh-factor actor the apply action requires.
const STEPPED_UP: Actor = {
  ...OWNER,
  security: {
    twoFactorRequired: false,
    twoFactorEnrolled: true,
    twoFactorVerified: true,
    stepUpValid: true,
  },
};

function unixServer(handler: (req: IncomingMessage, body: string) => { status: number; body: unknown }): Promise<{ server: Server; path: string }> {
  const path = join(tmpdir(), `fh-host-test-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const reply = handler(req, body);
      const payload = JSON.stringify(reply.body);
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(path, () => resolve({ server, path }));
  });
}

describe("host update socket (C10.31)", () => {

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("reads status through the private socket", async () => {
    const { server, path } = await unixServer((req) => {
      expect(req.url).toBe("/status");
      return { status: 200, body: { status: "idle", automatic: true, channel: "edge", utcHour: 7 } };
    });
    vi.stubEnv("FREEHOLDER_UPDATE_SOCKET", path);
    resetEnvForTests();
    try {
      const status = await getHostUpdateStatus.call({}, OWNER);
      expect(status).toEqual({ status: "idle", automatic: true, channel: "edge", utcHour: 7 });
    } finally {
      server.close();
    }
  });

  it("a stepped-up owner can request an apply and receives the queued run", async () => {
    const seen: string[] = [];
    const { server, path } = await unixServer((req, body) => {
      seen.push(req.url ?? "");
      if (req.url === "/apply") expect(body).toBe("{}");
      return { status: 202, body: { status: "queued", id: "run-1" } };
    });
    vi.stubEnv("FREEHOLDER_UPDATE_SOCKET", path);
    resetEnvForTests();
    try {
      const result = await requestHostUpdate.call({}, STEPPED_UP);
      expect(result).toEqual({ status: "queued", id: "run-1" });
      expect(seen).toEqual(["/apply"]);
    } finally {
      server.close();
    }
  });

  it("a missing or dead socket is a recoverable conflict, never a success", async () => {
    vi.stubEnv("FREEHOLDER_UPDATE_SOCKET", join(tmpdir(), "fh-host-test-missing.sock"));
    resetEnvForTests();
    await expect(getHostUpdateStatus.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(requestHostUpdate.call({}, STEPPED_UP)).rejects.toMatchObject({ code: "conflict" });
  });

  it("a non-2xx host reply is a conflict, never a parsed success", async () => {
    const { server, path } = await unixServer(() => ({ status: 500, body: { error: "boom" } }));
    vi.stubEnv("FREEHOLDER_UPDATE_SOCKET", path);
    resetEnvForTests();
    try {
      await expect(getHostUpdateStatus.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
    } finally {
      server.close();
    }
  });

  it("the playground never contacts the host executor", async () => {
    let hit = false;
    const { server, path } = await unixServer(() => {
      hit = true;
      return { status: 200, body: { status: "idle" } };
    });
    vi.stubEnv("FREEHOLDER_UPDATE_SOCKET", path);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
    try {
      await expect(getHostUpdateStatus.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
      // The playground policy refuses the mutation before the handler; either
      // way the host socket is never contacted.
      await expect(requestHostUpdate.call({}, STEPPED_UP)).rejects.toMatchObject({ code: "permission" });
      expect(hit).toBe(false);
    } finally {
      server.close();
    }
  });
});
