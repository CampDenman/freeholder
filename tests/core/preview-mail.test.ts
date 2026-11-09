// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.36: preview mail. On a private preview transactional mail reaches only
// the owner's allow-listed addresses and the site's contacts, through a
// delivering adapter, under a daily cap; everything else is held in the
// preview outbox the owner reads in the admin. No provider is contacted here:
// the delivering route is SMTP to a host that does not exist, and no delivery
// job is ever run.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetMailForTests } from "@/adapters/mail";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { prepareServiceJobRuntime, stopJobs } from "@/core/jobs";
import { mailDeliveries, mailOutbox } from "@/core/mail/schema";
import {
  listHeldMail,
  openHeldMail,
  PREVIEW_BULK_REFUSAL,
  previewMailAllowList,
} from "@/core/mail/preview";
import {
  assertMailReady,
  deliverQueuedMail,
  mailReadiness,
  pruneExpiredMailOutbox,
  sendMail,
} from "@/core/mail/service";
import { customerSignInStatus, requestCustomerSignIn } from "@/core/portal/sign-in";
import { ready } from "@/core/runtime";
import { ServiceError } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const PREVIEW_KEY = "preview-key-for-tests-0123456789-abcdefghij";
const OWNER_ADDRESS = "owner@example.test";

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

/** A delivering route that never runs: no job worker runs in this suite. */
const SMTP = {
  MAIL_ADAPTER: "smtp",
  SMTP_HOST: "smtp.invalid",
  MAIL_FROM: "Preview <hello@example.test>",
};
/** No delivering adapter: the console only prints. */
const CONSOLE = { MAIL_ADAPTER: "console", SMTP_HOST: undefined, MAIL_FROM: undefined };

function preview(values: Record<string, string | undefined> = {}): void {
  environment({
    FREEHOLDER_PREVIEW_KEY: PREVIEW_KEY,
    FREEHOLDER_PREVIEW_MAIL_ALLOW: ` ${OWNER_ADDRESS.toUpperCase()} , second@example.test`,
    FREEHOLDER_PREVIEW_MAIL_DAILY_CAP: undefined,
    ...values,
  });
}

function send(to: string, options: Parameters<typeof sendMail>[2] = {}) {
  return db().transaction((tx) =>
    sendMail(tx, { to, subject: `Hello ${to}`, text: `Body for ${to}: https://preview.example.test/link` }, options),
  );
}

async function delivery(id: string) {
  const [row] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, id));
  return row!;
}

async function hasJob(id: string): Promise<boolean> {
  const rows = await db()
    .select({ id: jobIdempotencyKeys.jobId })
    .from(jobIdempotencyKeys)
    .where(eq(jobIdempotencyKeys.idempotencyKey, `mail-delivery:${id}`));
  return rows.length > 0;
}

async function hasBody(id: string): Promise<boolean> {
  const rows = await db().select().from(mailOutbox).where(eq(mailOutbox.deliveryId, id));
  return rows.length > 0;
}

describe("the preview allow-list", () => {
  it("is trimmed, lower-cased and de-duplicated", () => {
    expect(
      previewMailAllowList({ FREEHOLDER_PREVIEW_MAIL_ALLOW: " A@Example.test,b@example.test,, a@example.test " }),
    ).toEqual(["a@example.test", "b@example.test"]);
    expect(previewMailAllowList({ FREEHOLDER_PREVIEW_MAIL_ALLOW: undefined })).toEqual([]);
  });
});

describe.runIf(hasDatabase)("preview mail", () => {
  beforeAll(async () => {
    await ready();
    // These controls deliberately call the low-level transactional mail API.
    // Prepare its producer before opening any of those transactions, just as
    // the shared service boundary does; do not mount a delivery worker.
    await prepareServiceJobRuntime();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: OWNER_ADDRESS, role: "owner" });
  });

  afterEach(() => {
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    resetMailForTests();
  });

  afterAll(async () => {
    await stopJobs();
    await truncateSpine();
    await closeDb();
  });

  it("leaves mail unchanged when FREEHOLDER_PREVIEW_KEY is unset", async () => {
    environment({ FREEHOLDER_PREVIEW_KEY: undefined, FREEHOLDER_PREVIEW_MAIL_ALLOW: OWNER_ADDRESS, ...CONSOLE });
    // Without a delivering adapter, transactional mail is still refused…
    const refused = await failure(db().transaction((tx) => assertMailReady(tx, "transactional")));
    expect(refused.message).toMatch(/Configure a delivering mail provider/);
    await expect(customerSignInStatus.call({}, ANONYMOUS)).resolves.toEqual({ available: false });
    // …and the console route queues mail, never holds it.
    const queued = await send("stranger@example.test");
    expect(queued).toMatchObject({ provider: "console", delivers: false, duplicate: false });
    expect(queued.held).toBeUndefined();
    expect(await delivery(queued.id)).toMatchObject({ status: "queued", holdReason: null });
    expect(await hasJob(queued.id)).toBe(true);

    environment(SMTP);
    const stranger = await send("another-stranger@example.test");
    expect(stranger).toMatchObject({ provider: "smtp", delivers: true });
    expect(await delivery(stranger.id)).toMatchObject({ status: "queued" });
    // Bulk keeps its own refusal, not the preview's.
    const bulk = await failure(db().transaction((tx) => assertMailReady(tx, "bulk")));
    expect(bulk.message).not.toBe(PREVIEW_BULK_REFUSAL);
    expect((await listHeldMail.call({}, OWNER)).preview).toBe(false);
  });

  it("delivers to allow-listed owners and contacts, and holds everyone else", async () => {
    preview(SMTP);
    await db().insert(contacts).values({ email: "customer@example.test", name: "Casey" });

    const owner = await send(OWNER_ADDRESS);
    const second = await send("second@example.test");
    const contact = await send("customer@example.test");
    for (const sent of [owner, second, contact]) {
      expect(sent).toMatchObject({ provider: "smtp", delivers: true, duplicate: false });
      expect(await delivery(sent.id)).toMatchObject({ status: "queued", holdReason: null });
      expect(await hasJob(sent.id)).toBe(true);
    }

    const stranger = await send("stranger@example.test", { idempotencyKey: "stranger-once" });
    expect(stranger).toMatchObject({ delivers: false, held: true });
    expect(await delivery(stranger.id)).toMatchObject({ status: "held", holdReason: "recipient", attempts: 0 });
    // Never sent and never lost: the body waits in the outbox with no job.
    expect(await hasJob(stranger.id)).toBe(false);
    expect(await hasBody(stranger.id)).toBe(true);
    // A replay reports the same held message rather than queuing another.
    await expect(send("stranger@example.test", { idempotencyKey: "stranger-once" })).resolves.toMatchObject({
      id: stranger.id,
      delivers: false,
      duplicate: true,
      held: true,
    });
    // A stray delivery job for a held message leaves it alone.
    await expect(deliverQueuedMail(stranger.id)).resolves.toEqual({ status: "held" });
    expect(await hasBody(stranger.id)).toBe(true);
    expect(await delivery(stranger.id)).toMatchObject({ status: "held", attempts: 0 });
  });

  it("holds everything once the rolling daily cap is reached", async () => {
    preview({ ...SMTP, FREEHOLDER_PREVIEW_MAIL_DAILY_CAP: "2" });
    const first = await send(OWNER_ADDRESS);
    const second = await send(OWNER_ADDRESS);
    const third = await send(OWNER_ADDRESS);
    expect([first.delivers, second.delivers, third.delivers]).toEqual([true, true, false]);
    expect(await delivery(third.id)).toMatchObject({ status: "held", holdReason: "cap" });
    expect(await hasJob(third.id)).toBe(false);

    // Held messages do not count; a message older than 24 hours no longer does.
    await db()
      .update(mailDeliveries)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(mailDeliveries.id, first.id));
    const fourth = await send(OWNER_ADDRESS);
    expect(fourth.delivers).toBe(true);
    const status = await listHeldMail.call({}, OWNER);
    expect(status).toMatchObject({ preview: true, dailyCap: 2, sentLast24Hours: 2 });
  });

  it("holds every message while no adapter delivers, and still lets customers sign in", async () => {
    preview(CONSOLE);
    await expect(db().transaction((tx) => assertMailReady(tx, "transactional"))).resolves.toBeUndefined();
    await expect(customerSignInStatus.call({}, ANONYMOUS)).resolves.toEqual({ available: true });
    await expect(mailReadiness.call({}, OWNER)).resolves.toEqual({ transactional: true, bulk: false });

    // Even an allow-listed owner, and even a caller that requires delivery.
    const owner = await send(OWNER_ADDRESS, { requireDelivery: true });
    expect(owner).toMatchObject({ provider: "console", delivers: false, held: true });
    expect(await delivery(owner.id)).toMatchObject({ status: "held", holdReason: "no_adapter" });

    // A customer signs in on the preview: the link is held, not shown to them.
    const answer = await requestCustomerSignIn.call({ email: "new-customer@example.test" }, ANONYMOUS);
    expect(answer).toEqual({ sent: true });
    expect(JSON.stringify(answer)).not.toContain("http");
    const held = await listHeldMail.call({}, OWNER);
    const link = held.held.find((message) => message.recipient === "new-customer@example.test");
    expect(link).toMatchObject({ reason: "no_adapter", readable: true });
    expect(JSON.stringify(held)).not.toContain("/portal");

    // The owner opens it, and the sign-in link is there to follow.
    const opened = await openHeldMail.call({ id: link!.id }, OWNER);
    expect(opened).toMatchObject({ recipient: "new-customer@example.test", reason: "no_adapter" });
    expect(opened.text).toMatch(/https?:\/\/\S+/);
    const audit = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "mail.openHeld"), eq(auditLog.subjectId, link!.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: `user:${OWNER.userId}`, subjectType: "mail_delivery" });
  });

  it("lets only the owner and mail staff read held mail", async () => {
    preview(CONSOLE);
    const held = await send(OWNER_ADDRESS);

    await expect(listHeldMail.call({}, OWNER)).resolves.toMatchObject({ held: [{ id: held.id }] });
    await expect(
      listHeldMail.call({}, { ...STAFF, grants: [{ module: "mail", access: "view" }] }),
    ).resolves.toMatchObject({ held: [{ id: held.id }] });
    await expect(openHeldMail.call({ id: held.id }, STAFF)).resolves.toMatchObject({ id: held.id });

    for (const actor of [ANONYMOUS, CUSTOMER, { ...STAFF, grants: [] }]) {
      expect((await failure(listHeldMail.call({}, actor))).code).toBe("permission");
      expect((await failure(openHeldMail.call({ id: held.id }, actor))).code).toBe("permission");
    }
    // Viewing the list is not enough to open a body, which can be a credential.
    expect(
      (await failure(openHeldMail.call({ id: held.id }, { ...STAFF, grants: [{ module: "mail", access: "view" }] })))
        .code,
    ).toBe("permission");
    // Nor can an API key open one, whatever its scopes.
    const agent = { kind: "agent" as const, keyName: "preview-bot", scopes: ["mail.*"] };
    await expect(listHeldMail.call({}, agent)).resolves.toMatchObject({ held: [{ id: held.id }] });
    expect((await failure(openHeldMail.call({ id: held.id }, agent))).code).toBe("permission");

    // Only held messages open: a delivered or queued one is not in the outbox to read.
    environment(SMTP);
    const queued = await send(OWNER_ADDRESS);
    expect((await failure(openHeldMail.call({ id: queued.id }, OWNER))).code).toBe("not_found");
  });

  it("keeps an expired held message listed after its body is pruned", async () => {
    preview(CONSOLE);
    const held = await send(OWNER_ADDRESS);
    await db()
      .update(mailOutbox)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(mailOutbox.deliveryId, held.id));
    await expect(pruneExpiredMailOutbox()).resolves.toBe(1);
    expect(await delivery(held.id)).toMatchObject({ status: "held", holdReason: "no_adapter" });
    await expect(listHeldMail.call({}, OWNER)).resolves.toMatchObject({ held: [{ id: held.id, readable: false }] });
    expect((await failure(openHeldMail.call({ id: held.id }, OWNER))).code).toBe("not_found");
  });

  it("refuses campaign and bulk mail on a preview", async () => {
    preview(SMTP);
    const ready = await failure(db().transaction((tx) => assertMailReady(tx, "bulk")));
    expect(ready).toBeInstanceOf(ServiceError);
    expect(ready).toMatchObject({ code: "conflict", message: PREVIEW_BULK_REFUSAL });
    const bulk = await failure(send(OWNER_ADDRESS, { purpose: "bulk" }));
    expect(bulk).toMatchObject({ code: "conflict", message: PREVIEW_BULK_REFUSAL });
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
  });
});
