// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: prove the public identity can edit content but cannot gain authority,
// that the disposable playground is separated from a production database by
// construction, and that the hourly reset recovers a clean, signed-out,
// reseeded playground.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { closeDb, db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { validateSession } from "@/core/auth/sessions";
import { resetEnvForTests } from "@/core/env";
import { enterPlayground, initializePlayground } from "@/core/demo/playground";
import { PLAYGROUND_MANAGE, PLAYGROUND_ROW_CAPS, PLAYGROUND_VIEW, playgroundAllows } from "@/core/demo/playground-policy";
import { createPage, updatePage, getPage, publishPage } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { seedDemoIfRequested } from "@/modules/seed/boot";
import { touchEditLease, releaseEditLease } from "@/modules/cms/lifecycle";
import { heartbeatPresence, leavePresence, listPresence } from "@/modules/cms/collaboration";
import { createRole } from "@/core/roles/service";
import { requestHostUpdate } from "@/core/update/host";
import { createInvitation } from "@/core/invitations/service";
import { beginUpload } from "@/core/media/service";
import { sendMail, deliverQueuedMail, testMailSender } from "@/core/mail/service";
import { sendSms } from "@/core/messaging/sms";
import { mailDeliveries, mailOutbox } from "@/core/mail/schema";
import { webhookDeliveries, webhookSubscriptions } from "@/core/webhooks/schema";
import { deliverDue } from "@/core/webhooks/deliver";
import { login, logout } from "@/core/auth/service";
import { setModuleEnabled } from "@/core/settings/service";
import { createDepositAndBalanceInvoices } from "@/modules/invoicing/advanced-money-service";
import { createContact } from "@/core/contacts/service";
import { ANONYMOUS, OWNER, closeDb as closeSpineDb, hasDatabase, truncateSpine } from "../helpers/spine";

it("requires explicit opt-in for each editing action", () => {
  for (const name of ["cms.testSendEmail", "cms.sendSmsTemplate", "cms.futurePrivilege", "auth.login", "auth.requestMagicLink", "roles.create", "platform.requestHostUpdate", "media.upload", "contacts.fulfillDataRequest", "analytics.track"]) {
    expect(playgroundAllows(name, "mutation")).toBe(false);
  }
  expect(playgroundAllows("cms.updatePage", "mutation")).toBe(true);
});

describe.runIf(hasDatabase)("playground row caps name real tables", () => {
  afterAll(closeDb);
  it("every capped surface resolves to a table the schema actually has", async () => {
    for (const cap of Object.values(PLAYGROUND_ROW_CAPS)) {
      const rows = await db().execute<{ count: number }>(sqlRawCount(cap.table));
      expect(Number(rows[0]?.count ?? -1)).toBeGreaterThanOrEqual(0);
    }
  });
});

function sqlRawCount(table: string) {
  // The registry names tables as strings (importing schemas into the policy
  // closes a static cycle); this count is the test-side proof each name is
  // the real physical table.
  return sql.raw(`select count(*)::int as count from "${table.replaceAll('"', '""')}"`);
}

describe.runIf(hasDatabase)("disposable playground", () => {
  beforeEach(async () => {
    await truncateSpine();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  afterAll(closeDb);

  it("does not convert a database containing real accounts", async () => {
    await db().insert(users).values({ email: "owner@example.test", role: "owner" });
    await expect(initializePlayground()).rejects.toThrow("disposable database");
    expect(await db().select().from(users)).toHaveLength(1);
  });

  it("issues only a restricted visitor session and supports a real page edit", async () => {
    await initializePlayground();
    await initializePlayground();
    const issued = await enterPlayground.call({}, ANONYMOUS);
    const session = await db().transaction((tx) => validateSession(tx, issued.token));
    expect(session?.role).toBe("playground");
    expect(session?.security.twoFactorRequired).toBe(false);
    if (!session) throw new Error("No session");
    const actor = { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants };
    const page = await createPage.call({ slug: "visitor-page", title: "Before" }, actor);
    // The editor mounts these services before rendering the block controls.
    expect((await touchEditLease.call({ id: page.id }, actor)).mine).toBe(true);
    await heartbeatPresence.call({ pageId: page.id, editing: true }, actor);
    expect(await listPresence.call({ pageId: page.id }, actor)).toHaveLength(1);
    await updatePage.call({ id: page.id, title: "After", blocks: [
      { id: "heading", type: "heading", props: { text: "After", level: 1 } },
    ] }, actor);
    expect((await getPage.call({ id: page.id }, actor))?.title).toBe("After");
    expect((await publishPage.call({ id: page.id, published: true }, actor)).status).toBe("published");
    await leavePresence.call({ pageId: page.id }, actor);
    await releaseEditLease.call({ id: page.id }, actor);
    expect(await listPresence.call({ pageId: page.id }, actor)).toHaveLength(0);
    await expect(createRole.call({ name: "Escalation", grants: [{ module: "*", access: "manage" }] }, actor)).rejects.toMatchObject({ code: "permission" });
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "permission" });
    expect((await db().select().from(users)).every((user) => !user.passwordHash)).toBe(true);
  });

  async function visitorActor() {
    const issued = await enterPlayground.call({}, ANONYMOUS);
    const session = await db().transaction((tx) => validateSession(tx, issued.token));
    if (!session) throw new Error("No session");
    return { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants, token: issued.token };
  }

  it("bounds the visitor session to content grants with no escalation path", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    expect(actor.role).toBe("playground");
    const allowed = new Set<string>([...PLAYGROUND_MANAGE, ...PLAYGROUND_VIEW]);
    for (const grant of actor.grants) {
      expect(allowed.has(grant.module)).toBe(true);
      if (grant.access === "manage") {
        expect(PLAYGROUND_MANAGE).toContain(grant.module);
      }
    }
    // No grant names staff, owner, money, messaging or platform machinery.
    expect(actor.grants.map((grant) => grant.module)).not.toContain("platform");
    // Even the visitor's own session cannot start a credential flow.
    await expect(
      login.call({ email: "visitor@playground.invalid", password: "guess" }, actor),
    ).rejects.toMatchObject({ code: "permission" });
  });

  it("refuses privileged operations server-side as the playground principal", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    const unavailable = { code: "permission", message: "This action is unavailable in the public playground." };
    await expect(createInvitation.call({ email: "friend@example.test", roleKey: "staff" }, actor)).rejects.toMatchObject(unavailable);
    await expect(testMailSender.call({}, actor)).rejects.toMatchObject(unavailable);
    await expect(
      beginUpload.call(
        { filename: "probe.png", contentType: "image/png", bytes: 1024, provenance: {}, metadata: {} },
        actor,
      ),
    ).rejects.toMatchObject(unavailable);
    await expect(sendSms.call({ to: "+15555550100", body: "hello", idempotencyKey: "pg-1" }, actor)).rejects.toMatchObject(unavailable);
    await expect(createDepositAndBalanceInvoices.call({}, actor)).rejects.toMatchObject(unavailable);
    await expect(setModuleEnabled.call({ module: "cms", enabled: false }, actor)).rejects.toMatchObject(unavailable);
  });

  it("blocks external mail delivery even from background paths", async () => {
    await initializePlayground();
    const queued = await db().transaction((tx) =>
      sendMail(tx, { to: "person@example.test", subject: "Playground", text: "queued by a reminder job" }),
    );
    // Playground on: refused with the playground reason, before any provider
    // contact, and not retried.
    await expect(deliverQueuedMail(queued.id)).resolves.toEqual({ status: "failed" });
    const [blocked] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, queued.id));
    expect(blocked?.status).toBe("failed");
    expect(blocked?.lastError).toBe("External mail delivery is disabled in the public playground.");
    expect(await db().select().from(mailOutbox)).toHaveLength(0);
    // Playground off: the same call fails for the ordinary local-sink reason,
    // proving the guard above is what fired.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const control = await db().transaction((tx) =>
      sendMail(tx, { to: "person@example.test", subject: "Control", text: "ordinary queue" }),
    );
    await expect(deliverQueuedMail(control.id)).resolves.toEqual({ status: "failed" });
    const [ordinary] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, control.id));
    expect(ordinary?.lastError).not.toBe("External mail delivery is disabled in the public playground.");
  });

  it("blocks external SMS and webhook delivery even from system work", async () => {
    await initializePlayground();
    // SMS: system callers (reminder/compliance jobs) reach the service without
    // a person, and the playground refusal still fires.
    await expect(
      sendSms.call({ to: "+15555550100", body: "reminder", idempotencyKey: "pg-sms-1" }, { kind: "system" }),
    ).rejects.toMatchObject({
      code: "permission",
      message: "Text message delivery is disabled in the public playground.",
    });
    // Webhooks: a delivery enqueued by an event fan-out fails closed with no
    // attempt burned; the control run below shows the ordinary network path.
    const [subscription] = await db()
      .insert(webhookSubscriptions)
      .values({ name: "playground probe", url: "http://127.0.0.1:9/hook", events: ["*"], secret: "probe-secret", status: "active" })
      .returning({ id: webhookSubscriptions.id });
    const [delivery] = await db()
      .insert(webhookDeliveries)
      .values({ subscriptionId: subscription!.id, eventName: "contact.created", payload: {}, status: "pending", nextAttemptAt: new Date(Date.now() - 60_000) })
      .returning({ id: webhookDeliveries.id });
    await expect(deliverDue(5)).resolves.toBe(1);
    const [blocked] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery!.id));
    expect(blocked).toMatchObject({
      status: "failed",
      attempts: 0,
      error: "External webhook delivery is disabled in the public playground.",
    });
    // Playground off: the same delivery is attempted over the network and
    // lands on the ordinary retry path instead.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await db().update(webhookDeliveries).set({ status: "pending", error: null, completedAt: null }).where(eq(webhookDeliveries.id, delivery!.id));
    await expect(deliverDue(5)).resolves.toBe(1);
    const [attempted] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery!.id));
    expect(attempted?.error).not.toBe("External webhook delivery is disabled in the public playground.");
    expect(attempted?.attempts).toBe(1);
  });

  it("caps rows on each writable surface", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    const cap = PLAYGROUND_ROW_CAPS["contacts.create"]!.limit;
    for (let index = 0; index < cap; index += 1) {
      await createContact.call({ name: `Sample ${index}` }, actor);
    }
    await expect(createContact.call({ name: "One too many" }, actor)).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(createContact.call({ name: "One too many" }, actor)).rejects.toThrow(/surface is full/);
    // The bound is per surface: pages still take edits while contacts are full.
    const page = await createPage.call({ slug: "still-room", title: "Still room" }, actor);
    expect((await getPage.call({ id: page.id }, actor))?.title).toBe("Still room");
  });

  it("throttles all visitor mutations together at the playground bound", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    // Entry consumed one mutation of the shared 300-per-minute budget; count
    // exactly how many more pass before the wall, then prove the next one is
    // refused. The accounting is the bound.
    let allowed = 0;
    let refusal: { code?: string; message?: string } | undefined;
    for (let index = 0; index < 400 && !refusal; index += 1) {
      await logout.call({ token: `playground-hammer-${index}` }, actor).then(
        () => {
          allowed += 1;
        },
        (error: unknown) => {
          refusal = error as { code?: string; message?: string };
        },
      );
    }
    expect(allowed).toBe(299);
    expect(refusal).toMatchObject({
      code: "rate_limited",
      message: "The shared playground is busy. Please try again shortly.",
    });
    // The budget is shared, not per service: a different mutation is refused too.
    await expect(createContact.call({ name: "Over budget" }, actor)).rejects.toMatchObject({
      code: "rate_limited",
      message: "The shared playground is busy. Please try again shortly.",
    });
  });

  it("refuses entry on ordinary client installations", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await initializePlayground();
    await expect(enterPlayground.call({}, ANONYMOUS)).rejects.toMatchObject({ code: "not_found" });
    expect(await db().select().from(users)).toHaveLength(0);
  });

  it("requires a fresh owner factor before contacting the host", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "step_up_required" });
    await expect(requestHostUpdate.call({}, { kind: "agent", keyName: "test", scopes: ["platform:write"] })).rejects.toMatchObject({ code: "permission" });
  });
});

const originalDatabaseUrl = process.env.DATABASE_URL ?? "";
const clusterAdminUrl = originalDatabaseUrl.replace(/\/[^/]+$/, "/postgres");

async function freshDatabase(name: string): Promise<string> {
  const admin = postgres(clusterAdminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = originalDatabaseUrl.replace(/\/[^/]+$/, `/${name}`);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }
  return url;
}

async function dropDatabase(name: string): Promise<void> {
  const admin = postgres(clusterAdminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.end();
  }
}

/** Point the runtime's lazy database singleton at another database. */
async function pointAt(url: string): Promise<void> {
  process.env.DATABASE_URL = url;
  await closeDb();
  resetEnvForTests();
}

async function visitorOn(databaseUrl: string) {
  await pointAt(databaseUrl);
  await initializePlayground();
  const issued = await enterPlayground.call({}, ANONYMOUS);
  const session = await db().transaction((tx) => validateSession(tx, issued.token));
  if (!session) throw new Error("No session");
  return {
    token: issued.token,
    actor: { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants },
  };
}

describe.runIf(hasDatabase)("playground separation and reset recovery", () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pointAt(originalDatabaseUrl);
    await dropDatabase("playground_sep_prod_c138");
    await dropDatabase("playground_sep_play_c138");
    await dropDatabase("playground_sep_reset_c138");
    await closeSpineDb();
  });

  it("runs on its own database and never converts or sees production data", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
    const prodUrl = await freshDatabase("playground_sep_prod_c138");
    const playUrl = await freshDatabase("playground_sep_play_c138");
    expect(playUrl).not.toBe(prodUrl);

    // A production-shaped database: a real owner account and real content.
    await pointAt(prodUrl);
    await db().insert(users).values({ email: "owner@real-client.test", role: "owner", passwordHash: "real-hash" });
    const [prodPage] = await db().insert(pages).values({ slug: "real-client-page", title: "Real client content" }).returning({ id: pages.id });
    // The playground flag fails closed against a database holding real
    // accounts: even pointed at production by mistake, it refuses to convert
    // or seed it.
    await expect(initializePlayground()).rejects.toThrow("disposable database");
    expect(await db().select().from(users)).toHaveLength(1);

    // The playground's own database holds only the synthetic pair — the
    // production owner and page are absent from it entirely.
    const visitor = await visitorOn(playUrl);
    expect(visitor.actor.role).toBe("playground");
    const playUsers = await db().select({ email: users.email, passwordHash: users.passwordHash }).from(users);
    expect(playUsers.map((user) => user.email).sort()).toEqual([
      "operator@playground.invalid",
      "visitor@playground.invalid",
    ]);
    expect(playUsers.every((user) => !user.passwordHash)).toBe(true);
    expect(
      await db().select({ id: pages.id }).from(pages).where(eq(pages.id, prodPage!.id)),
    ).toHaveLength(0);

    // Visitor work stays in the playground database: the graffiti page does
    // not exist in production, and the playground session does not exist in
    // the production session table either.
    const graffiti = await createPage.call({ slug: "visitor-graffiti", title: "Visitor graffiti" }, visitor.actor);
    await pointAt(prodUrl);
    expect(await db().select({ id: pages.id }).from(pages).where(eq(pages.id, graffiti.id))).toHaveLength(0);
    expect(await db().select({ id: pages.id }).from(pages)).toHaveLength(1);
    expect(
      await db().transaction((tx) => validateSession(tx, visitor.token)),
    ).toBeUndefined();
  }, 60_000);

  it("hourly reset recovers a clean, signed-out, reseeded playground", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    vi.stubEnv("FREEHOLDER_SEED_DEMO", "1");
    resetEnvForTests();
    const playUrl = await freshDatabase("playground_sep_reset_c138");
    await pointAt(playUrl);
    await initializePlayground();
    const seeded = await seedDemoIfRequested();
    expect(seeded.status).toBe("installed");
    const seededPages = await db().select({ id: pages.id }).from(pages);
    expect(seededPages.length).toBeGreaterThan(0);

    // A visitor enters and leaves marks: a session, a page, an edit.
    const before = await visitorOn(playUrl);
    const graffiti = await createPage.call({ slug: "reset-me", title: "Graffiti" }, before.actor);
    await updatePage.call({ id: graffiti.id, title: "Edited graffiti", blocks: [
      { id: "heading", type: "heading", props: { text: "Edited graffiti", level: 1 } },
    ] }, before.actor);
    expect((await getPage.call({ id: graffiti.id }, before.actor))?.title).toBe("Edited graffiti");

    // The reset job (deploy/docker-selfhost/playground/reset.sh, hourly via
    // systemd timer) recreates the disposable database and lets the ordinary
    // boot phases re-run. Simulate that cycle against a fresh database.
    await closeDb();
    await dropDatabase("playground_sep_reset_c138");
    const resetUrl = await freshDatabase("playground_sep_reset_c138");
    await pointAt(resetUrl);
    await initializePlayground();
    const reseeded = await seedDemoIfRequested();
    expect(reseeded.status).toBe("installed");

    // Recovery: the old session no longer authorizes anyone, the visitor
    // page is gone, and the sample content is back.
    expect(await db().transaction((tx) => validateSession(tx, before.token))).toBeUndefined();
    expect(await db().select({ id: pages.id }).from(pages).where(eq(pages.id, graffiti.id))).toHaveLength(0);
    const restoredPages = await db().select({ id: pages.id }).from(pages);
    expect(restoredPages.length).toBe(seededPages.length);

    // And the playground is usable again: a new visitor enters and edits.
    const after = await visitorOn(resetUrl);
    const page = await createPage.call({ slug: "after-reset", title: "After reset" }, after.actor);
    expect((await getPage.call({ id: page.id }, after.actor))?.title).toBe("After reset");
  }, 90_000);
});
