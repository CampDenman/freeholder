// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.40: native renewal claims and the shared mail queue, with a synthetic SMTP endpoint.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMailForTests } from "@/adapters/mail";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { mailDeliveries } from "@/core/mail/schema";
import { deliverQueuedMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { moduleSettings } from "@/core/settings/schema";
import { runRenewalLookAhead } from "@/modules/renewal-alerts/jobs";
import { renewalAlerts, trackedSubscriptions } from "@/modules/renewal-alerts/schema";
import { RENEWAL_ALERTS_MODULE } from "@/modules/renewal-alerts/settings";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

type SmtpMessage = { to: string; subject: string; text: string; html: string };
type SmtpReceipt = { messageId: string; accepted: string[]; rejected: string[]; response: string };
const smtp = vi.hoisted(() => ({ send: vi.fn<(message: SmtpMessage) => Promise<SmtpReceipt>>() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: smtp.send }) }));

const now = new Date("2031-09-01T08:00:00Z");
const upcoming = new Date("2031-09-03T08:00:00Z");

async function seedCharge(
  label: string,
  values: Partial<Pick<typeof trackedSubscriptions.$inferInsert, "costMinor" | "currency" | "nextRenewalAt" | "status">> = {},
) {
  const email = `${label.toLowerCase()}@example.test`;
  const [contact] = await db().insert(contacts).values({ name: label, email }).returning();
  const [charge] = await db().insert(trackedSubscriptions).values({
    contactId: contact!.id,
    name: label,
    costMinor: 1000,
    currency: "USD",
    firstChargeAt: new Date("2031-08-03T08:00:00Z"),
    nextRenewalAt: upcoming,
    alertDays: 2,
    ...values,
  }).returning();
  return { email, charge: charge! };
}

function mailAdapter(name: "smtp" | "console") {
  vi.stubEnv("MAIL_ADAPTER", name);
  resetEnvForTests();
  resetMailForTests();
}

describe.runIf(hasDatabase)("scheduled renewal alert delivery", () => {
  beforeAll(ready, 60_000);

  beforeEach(async () => {
    vi.stubEnv("APP_URL", "https://renewals.example.test");
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0");
    vi.stubEnv("FREEHOLDER_PREVIEW_KEY", undefined);
    vi.stubEnv("MAIL_FROM", "sender@example.test");
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_PORT", "587");
    mailAdapter("smtp");
    smtp.send.mockReset().mockImplementation(async ({ to }) => ({
      messageId: `renewal-test-${to}`,
      accepted: [to],
      rejected: [],
      response: "250 queued",
    }));
    await truncateSpine();
    await db().insert(moduleSettings).values({ module: RENEWAL_ALERTS_MODULE, enabled: true });
    await startJobProducer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetMailForTests();
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it("queues and submits only due active alerts with accurate currency and a usable portal link", async () => {
    const yen = await seedCharge("Yen", { costMinor: 1200, currency: "JPY" });
    const dinar = await seedCharge("Dinar", { costMinor: 1500, currency: "KWD" });
    await seedCharge("Archived", { status: "archived" });
    await seedCharge("Later", { nextRenewalAt: new Date("2031-09-04T08:00:00Z") });

    await expect(runRenewalLookAhead(now)).resolves.toEqual({
      examined: 2, rolledForward: 0, alerted: 2, failed: 0, suppressed: 0,
    });
    const alerts = await db().select().from(renewalAlerts);
    expect(alerts.map((alert) => alert.subscriptionId)).toEqual(expect.arrayContaining([yen.charge.id, dinar.charge.id]));
    expect(alerts).toHaveLength(2);
    expect(smtp.send).not.toHaveBeenCalled();
    for (const alert of alerts) {
      expect(alert).toMatchObject({ renewalAt: upcoming, daysAhead: 2 });
      expect(typeof alert.mailDeliveryId).toBe("string");
      await expect(deliverQueuedMail(alert.mailDeliveryId!)).resolves.toMatchObject({ status: "submitted" });
    }
    expect(smtp.send).toHaveBeenCalledTimes(2);
    const messages = smtp.send.mock.calls.map(([message]) => message);
    for (const [to, amount] of [[yen.email, "¥1,200"], [dinar.email, "KWD\u00a01.500"]]) {
      const message = messages.find((item) => item.to === to);
      expect(message?.subject).toContain(amount);
      expect(message?.text).toContain("https://renewals.example.test/portal/renewals");
      expect(message?.html).toContain('href="https://renewals.example.test/portal/renewals"');
    }
  });

  it("rolls a missed charge forward and gives concurrent passes one alert and one mail job", async () => {
    const { charge } = await seedCharge("Missed", { nextRenewalAt: new Date("2031-08-03T08:00:00Z") });
    const passes = await Promise.all([runRenewalLookAhead(now), runRenewalLookAhead(now)]);
    expect(passes.map((pass) => pass.alerted).sort()).toEqual([0, 1]);
    expect(passes.map((pass) => pass.suppressed).sort()).toEqual([0, 1]);
    expect(passes.map((pass) => pass.failed)).toEqual([0, 0]);
    const [rolled] = await db().select().from(trackedSubscriptions).where(eq(trackedSubscriptions.id, charge.id));
    expect(rolled?.nextRenewalAt).toEqual(upcoming);
    const alerts = await db().select().from(renewalAlerts);
    expect(alerts).toHaveLength(1);
    const [delivery] = await db().select().from(mailDeliveries);
    expect(delivery?.id).toBe(alerts[0]!.mailDeliveryId);
    const boss = await startJobProducer();
    const jobs = await boss!.findJobs("core.deliverMail");
    expect(jobs.map((job) => job.data)).toEqual([{ deliveryId: delivery?.id }]);
  });

  it("counts a non-delivering adapter as a failure and leaves the charge retryable", async () => {
    await seedCharge("Recovery");
    mailAdapter("console");
    await expect(runRenewalLookAhead(now)).resolves.toMatchObject({ alerted: 0, failed: 1, suppressed: 0 });
    expect(await db().select().from(renewalAlerts)).toHaveLength(0);
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);

    mailAdapter("smtp");
    await expect(runRenewalLookAhead(now)).resolves.toMatchObject({ alerted: 1, failed: 0, suppressed: 0 });
    expect(await db().select().from(renewalAlerts)).toHaveLength(1);
  });

  it("leaves due renewals alone until an owner enables the module", async () => {
    await seedCharge("Opt-in");
    await db().delete(moduleSettings).where(eq(moduleSettings.module, RENEWAL_ALERTS_MODULE));
    await expect(runRenewalLookAhead(now)).resolves.toEqual({
      examined: 0, rolledForward: 0, alerted: 0, failed: 0, suppressed: 0,
    });
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
    await db().insert(moduleSettings).values({ module: RENEWAL_ALERTS_MODULE, enabled: true });
    await expect(runRenewalLookAhead(now)).resolves.toMatchObject({ alerted: 1 });
  });
});
