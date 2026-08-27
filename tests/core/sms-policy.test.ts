// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recipient-local quiet hours and frequency caps (MASTER.md C7.13).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { recordMessage } from "@/core/messaging/service";
import { sendSms } from "@/core/messaging/sms";
import {
  evaluateSmsPolicy,
  isQuietLocalTime,
  setMessagingWindow,
} from "@/core/messaging/policy";
import { saveSegment } from "@/core/segments/service";
import { businessProfile } from "@/core/settings/schema";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("quiet-hour arithmetic", () => {
  it("handles a recipient window that crosses midnight", () => {
    expect(isQuietLocalTime(22 * 60, "21:00", "08:00")).toBe(true);
    expect(isQuietLocalTime(7 * 60 + 59, "21:00", "08:00")).toBe(true);
    expect(isQuietLocalTime(8 * 60, "21:00", "08:00")).toBe(false);
    expect(isQuietLocalTime(12 * 60, "21:00", "08:00")).toBe(false);
  });

  it("handles a same-day window without reversing it", () => {
    expect(isQuietLocalTime(12 * 60, "11:00", "13:00")).toBe(true);
    expect(isQuietLocalTime(14 * 60, "11:00", "13:00")).toBe(false);
  });
});

describe.runIf(hasDatabase)("recipient messaging policy", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await db().insert(businessProfile).values({
      name: "Policy Test",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Toronto",
      firstDayOfWeek: 1,
    });
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function person(overrides: Partial<typeof contacts.$inferInsert> = {}) {
    const [created] = await db()
      .insert(contacts)
      .values({
        name: "Policy Person",
        email: `policy-${Math.random().toString(36).slice(2)}@example.test`,
        phone: "+1 (604) 555-0123",
        timezone: "America/Vancouver",
        ...overrides,
      })
      .returning();
    return created!;
  }

  it("uses the recipient's clock and ships a safe 8am–9pm baseline", async () => {
    const contact = await person();
    const quiet = await evaluateSmsPolicy.call(
      {
        contactId: contact.id,
        to: "+16045550123",
        purpose: "transactional",
        // 07:30 in Vancouver in January.
        at: "2026-01-15T15:30:00.000Z",
      },
      OWNER,
    );
    expect(quiet).toMatchObject({
      allowed: false,
      reason: "quiet_hours",
      timezone: "America/Vancouver",
      localTime: "07:30",
    });

    const daytime = await evaluateSmsPolicy.call(
      {
        contactId: contact.id,
        to: "+16045550123",
        purpose: "transactional",
        at: "2026-01-15T18:00:00.000Z",
      },
      OWNER,
    );
    expect(daytime).toMatchObject({ allowed: true, localTime: "10:00" });
  });

  it("falls back to the business timezone when the contact has none", async () => {
    const contact = await person({ timezone: null });
    const decision = await evaluateSmsPolicy.call(
      {
        contactId: contact.id,
        to: "+16045550123",
        purpose: "support",
        // 07:30 in Toronto in January.
        at: "2026-01-15T12:30:00.000Z",
      },
      OWNER,
    );
    expect(decision).toMatchObject({
      allowed: false,
      timezone: "America/Toronto",
      localTime: "07:30",
    });
  });

  it("counts the recipient's local day and only the policy's purpose", async () => {
    const contact = await person();
    for (let index = 0; index < 3; index += 1) {
      await recordMessage.call(
        {
          contactId: contact.id,
          direction: "outbound",
          channel: "sms",
          purpose: "marketing",
          body: `Campaign ${index + 1}`,
          providerRef: `cap-${index}`,
          occurredAt: `2026-01-15T${18 + index}:00:00.000Z`,
        },
        { kind: "system" },
      );
    }
    // A transactional reply is visible history, but not marketing frequency.
    await recordMessage.call(
      {
        contactId: contact.id,
        direction: "outbound",
        channel: "sms",
        purpose: "transactional",
        body: "Your receipt",
        providerRef: "cap-transactional",
        occurredAt: "2026-01-15T21:30:00.000Z",
      },
      { kind: "system" },
    );

    const decision = await evaluateSmsPolicy.call(
      {
        contactId: contact.id,
        to: "+16045550123",
        purpose: "marketing",
        at: "2026-01-15T22:00:00.000Z",
      },
      OWNER,
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: "daily_cap",
      blockedBy: { code: "marketing-frequency-cap" },
    });
  });

  it("allows only trusted, named transactional exceptions and records the kind", async () => {
    const contact = await person();
    const base = {
      contactId: contact.id,
      to: "+16045550123",
      purpose: "transactional" as const,
      at: "2026-01-15T15:30:00.000Z",
    };
    expect(await evaluateSmsPolicy.call(base, OWNER)).toMatchObject({
      allowed: false,
      reason: "quiet_hours",
    });

    const humanBypass = await failure(
      evaluateSmsPolicy.call(
        {
          ...base,
          exception: { kind: "booking_update", referenceId: "booking-1" },
        },
        OWNER,
      ),
    );
    expect(humanBypass.code).toBe("permission");

    const systemException = await evaluateSmsPolicy.call(
      {
        ...base,
        exception: { kind: "booking_update", referenceId: "booking-1" },
      },
      { kind: "system" },
    );
    expect(systemException).toMatchObject({
      allowed: true,
      exceptionApplied: "booking_update",
    });

    const marketingBypass = await failure(
      evaluateSmsPolicy.call(
        {
          ...base,
          purpose: "marketing",
          exception: { kind: "booking_update", referenceId: "booking-1" },
        },
        { kind: "system" },
      ),
    );
    expect(marketingBypass.message).toContain("never");
  });

  it("applies contact and canonical segment scopes without a second audience model", async () => {
    const customer = await person({ lifecycleStage: "customer" });
    const lead = await person({
      name: "Lead",
      email: "lead@example.test",
      phone: "+16045550999",
      lifecycleStage: "lead",
    });
    const segment = await saveSegment.call(
      {
        name: "Customers",
        definition: {
          match: "all",
          rules: [
            { field: "contact.lifecycleStage", op: "is", value: "customer" },
          ],
        },
      },
      OWNER,
    );
    await setMessagingWindow.call(
      {
        name: "Customer lunch pause",
        scope: "segment",
        segmentId: segment.id,
        quietFrom: "11:00",
        quietTo: "13:00",
        appliesTo: "marketing",
      },
      OWNER,
    );

    const customerDecision = await evaluateSmsPolicy.call(
      {
        contactId: customer.id,
        to: "+16045550123",
        purpose: "marketing",
        at: "2026-01-15T20:00:00.000Z",
      },
      OWNER,
    );
    expect(customerDecision).toMatchObject({
      allowed: false,
      blockedBy: { code: "customer-lunch-pause" },
    });

    const leadDecision = await evaluateSmsPolicy.call(
      {
        contactId: lead.id,
        to: "+16045550999",
        purpose: "marketing",
        at: "2026-01-15T20:00:00.000Z",
      },
      OWNER,
    );
    expect(leadDecision).toMatchObject({ allowed: true });
  });

  it("refuses malformed policies before PostgreSQL has to", async () => {
    const contact = await person();
    expect(
      (
        await failure(
          setMessagingWindow.call(
            {
              name: "Broken",
              scope: "contact",
              contactId: contact.id,
              quietFrom: "12:00",
              appliesTo: "all",
            },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
  });

  it("runs the policy before an SMS adapter can be called", async () => {
    const contact = await person({ timezone: "UTC" });
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 60_000);
    const to = new Date(now.getTime() + 5 * 60_000);
    const hhmm = (value: Date) =>
      `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
    await setMessagingWindow.call(
      {
        name: "Immediate contact pause",
        scope: "contact",
        contactId: contact.id,
        quietFrom: hhmm(from),
        quietTo: hhmm(to),
        appliesTo: "transactional",
      },
      OWNER,
    );

    const blocked = await failure(
      sendSms.call(
        {
          contactId: contact.id,
          to: "+16045550123",
          body: "This must not reach the adapter",
          purpose: "transactional",
          idempotencyKey: "policy-before-adapter",
        },
        OWNER,
      ),
    );
    expect(blocked.message).toContain("recipient quiet hours");

    const forgedEvidence = await failure(
      recordMessage.call(
        {
          contactId: contact.id,
          direction: "outbound",
          channel: "sms",
          purpose: "transactional",
          policyException: "booking_update",
          policyExceptionRef: "booking-1",
          body: "Not actually sent",
        },
        OWNER,
      ),
    );
    expect(forgedEvidence.code).toBe("permission");
  });
});
