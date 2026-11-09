// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.09/C10.33: installed pg-boss drain semantics, real disposable PostgreSQL.
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";

const url = process.env.DATABASE_URL;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it.runIf(Boolean(url))("offWork wait:true lets an accepted handler exceed shutdown grace without abort, then preserves its queued successor", async () => {
  const target = new URL(url!);
  expect(["localhost", "127.0.0.1", "[::1]", "postgres"]).toContain(target.hostname);
  const schema = "deployment_drain_" + randomUUID().replaceAll("-", "");
  const boss = new PgBoss({ connectionString: url!, schema, supervise: false, schedule: false, max: 3 });
  const errors: Error[] = []; boss.on("error", error => errors.push(error));
  let release!: () => void, begun!: () => void;
  const accepted = new Promise<void>(resolve => { begun = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  let handlerFinished = false, abortedWhileAccepted = false, drained = false;
  let drain: Promise<void> | undefined;
  try {
    await boss.start();
    await boss.createQueue("test.drain", { retryLimit: 0, expireInSeconds: 120 });
    await boss.work("test.drain", { pollingIntervalSeconds: 0.5 }, async messages => {
      const message = messages[0];
      if (!message) throw new Error("Expected the actual accepted fixture job.");
      message.signal.addEventListener("abort", () => { if (!handlerFinished) abortedWhileAccepted = true; });
      begun(); await finish;
      expect(message.signal.aborted).toBe(false);
      handlerFinished = true;
    });
    const first = await boss.send("test.drain", { synthetic: "accepted" });
    const second = await boss.send("test.drain", { synthetic: "retained-next" });
    await accepted;
    drain = boss.offWork("test.drain", { wait: true }).then(() => { drained = true; });
    // Deliberately beyond stopJobs' existing 30-second grace. That normal
    // shutdown timer must not be used as deployment-drain acceptance.
    await wait(31_000);
    expect(drained).toBe(false); expect(abortedWhileAccepted).toBe(false);
    release(); await drain;
    expect(handlerFinished).toBe(true); expect(abortedWhileAccepted).toBe(false);
    expect((await boss.getJobById("test.drain", first!))?.state).toBe("completed");
    expect((await boss.getJobById("test.drain", second!))?.state).toBe("created");
    await boss.stop({ graceful: true, timeout: 1000, close: false });
    expect(errors).toEqual([]);
    // The queue and retained job remain durable. No cancel/fail/timeout or
    // schedule rewrite is part of draining an accepted handler.
    await boss.start();
    const retained = await boss.getJobById("test.drain", second!);
    expect(retained?.state).toBe("created");
    await boss.deleteQueue("test.drain");
  } finally {
    release(); await drain;
    await boss.stop({ graceful: true, timeout: 1000 });
  }
}, 45_000);
