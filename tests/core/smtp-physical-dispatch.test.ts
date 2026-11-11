// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: actual TLS SMTP plus durable original physical outcome records.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { resetMailForTests } from "@/adapters/mail";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { mailDeliveries, mailDispatches, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
import { tlsSmtpFixture } from "../helpers/smtp-wire";

const originals = new Map<string, string | undefined>();
function environment(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) { if (!originals.has(name)) originals.set(name, process.env[name]); process.env[name] = value; }
  resetEnvForTests(); resetMailForTests();
}
describe.runIf(hasDatabase)("real loopback physical SMTP (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => { await truncateSpine(); await startJobProducer(); });
  afterEach(() => { for (const [name, value] of originals) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } originals.clear(); resetEnvForTests(); resetMailForTests(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  for (const dropped of [false, true]) it(dropped ? "keeps an actual lost DATA reply unknown and never repeats the send" : "records exact positive TLS submission and never replays it", async () => {
    const server = await tlsSmtpFixture({ dropDataReply: dropped });
    environment({ SESSION_SECRET: "smtp-real-fixture-secret-material-only", MAIL_ADAPTER: "smtp", MAIL_FROM: "sender@example.test", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.port), SMTP_SECURE: "true", SMTP_TLS_CA: server.ca, SMTP_USER: "", SMTP_PASSWORD: "" });
    try {
      const staged = await db().transaction(tx => sendMail(tx, { to: "fictional@example.test", subject: "Fictional TLS receipt", text: "Fictional private body over verified TLS." }, { idempotencyKey: "tls-original-intent", requireDelivery: true }));
      const result = await deliverQueuedMail(staged.id);
      expect(result.status).toBe(dropped ? "unknown" : "submitted");
      await deliverQueuedMail(staged.id);
      expect(server.messages).toHaveLength(1); expect(server.messages[0]).toContain("Fictional private body over verified TLS.");
      expect(server.messages[0]).toContain(`X-Freeholder-Delivery: ${staged.id}`);
      const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, staged.id));
      expect(server.messages[0]).toContain(`X-Freeholder-Dispatch: ${dispatch!.id}`);
      expect(dispatch?.state).toBe(dropped ? "unknown" : "submitted");
      expect((await db().select().from(mailDeliveries))[0]?.attempts).toBe(1);
      expect(await db().select().from(mailOutbox)).toHaveLength(dropped ? 1 : 0);
    } finally { await server.close(); }
  }, 30_000);
});
