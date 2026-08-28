// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Mandatory SMS consent and control-word proof (MASTER.md C7.12).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { availableLocales } from "@/core/i18n";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { consentRecords } from "@/core/privacy/schema";
import {
  canContact,
  getConsentPreferences,
  recordConsent,
} from "@/core/privacy/service";
import {
  classifySmsComplianceKeyword,
  listSmsComplianceEvents,
  SMS_COMPLIANCE_KEYWORDS,
  smsComplianceReply,
} from "@/core/messaging/consent";
import { smsComplianceEvents, messages } from "@/core/messaging/schema";
import { applySmsEvents, sendSms } from "@/core/messaging/sms";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

function daytimeTimezone(): string {
  let offset = 12 - new Date().getUTCHours();
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  if (offset === 0) return "UTC";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

describe("mandatory SMS control words", () => {
  it("ships a vocabulary for every production locale", () => {
    expect(Object.keys(SMS_COMPLIANCE_KEYWORDS).sort()).toEqual(
      availableLocales().sort(),
    );
  });

  it("recognizes localized words despite accents and punctuation", () => {
    expect(classifySmsComplianceKeyword("  ARRÊT! ")).toMatchObject({
      intent: "stop",
      locale: "fr",
      keyword: "ARRET",
    });
    expect(classifySmsComplianceKeyword("¿Ayuda?")).toMatchObject({
      intent: "help",
      locale: "es",
    });
    expect(classifySmsComplianceKeyword("unsubscribe")).toMatchObject({
      intent: "stop",
      locale: "en",
    });
  });

  it("does not turn an ordinary sentence into a control command", () => {
    expect(classifySmsComplianceKeyword("Please stop by after lunch")).toBeNull();
    expect(classifySmsComplianceKeyword("Can you help with my booking?")).toBeNull();
  });

  it("answers in the supported language without owner-configurable copy", () => {
    expect(smsComplianceReply("help", "fr-CA")).toContain("ARRÊT");
    expect(smsComplianceReply("start", "es-MX")).toContain("ALTO");
    expect(smsComplianceReply("stop", "de")).toContain("START");
  });
});

describe.runIf(hasDatabase)("SMS consent boundary", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function contact(preferredLocale = "fr-CA") {
    const [created] = await db()
      .insert(contacts)
      .values({
        name: "Consent Person",
        email: "consent@example.test",
        phone: "+1 (604) 555-0123",
        preferredLocale,
        timezone: daytimeTimezone(),
      })
      .returning();
    return created!;
  }

  async function grantEveryMarketingChannel(contactId: string) {
    for (const channel of ["email", "sms", "push"] as const) {
      await recordConsent.call(
        {
          contactId,
          purpose: "marketing",
          channel,
          state: "granted",
          method: "written",
          termsVersion: "campaign-v1",
          evidence: { source: "signed-card" },
          occurredAt: "2026-08-24T09:00:00.000Z",
        },
        OWNER,
      );
    }
  }

  const stopEvent = {
    id: "SM-stop",
    kind: "received" as const,
    providerRef: "SM-stop",
    from: "+16045550123",
    to: "+15005550006",
    body: "ARRÊT",
    occurredAt: "2026-08-25T09:00:00.000Z",
  };

  it("withdraws every marketing channel before the command reaches the inbox", async () => {
    const person = await contact();
    await grantEveryMarketingChannel(person.id);

    expect(
      await applySmsEvents.call({ events: [stopEvent] }, { kind: "system" }),
    ).toEqual({ received: 1, reported: 0 });

    const preferences = await getConsentPreferences.call(
      { contactId: person.id },
      OWNER,
    );
    for (const channel of ["email", "sms", "push"] as const) {
      expect(
        preferences.effective.find(
          (choice) => choice.purpose === "marketing" && choice.channel === channel,
        ),
      ).toMatchObject({ state: "withdrawn" });
    }
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await db().select().from(smsComplianceEvents)).toMatchObject([
      {
        contactId: person.id,
        intent: "stop",
        keyword: "ARRET",
        locale: "fr",
        providerRef: "SM-stop",
      },
    ]);
  });

  it("handles a carrier retry exactly once", async () => {
    const person = await contact();
    await grantEveryMarketingChannel(person.id);
    await applySmsEvents.call({ events: [stopEvent] }, { kind: "system" });
    await applySmsEvents.call({ events: [stopEvent] }, { kind: "system" });

    expect(await db().select().from(smsComplianceEvents)).toHaveLength(1);
    // Three grants and one withdrawal per channel, not a second retry set.
    expect(
      await db()
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.contactId, person.id)),
    ).toHaveLength(6);
  });

  it("START restores SMS only and leaves the global email/push opt-out intact", async () => {
    const person = await contact("es-MX");
    await grantEveryMarketingChannel(person.id);
    await applySmsEvents.call({ events: [stopEvent] }, { kind: "system" });
    await applySmsEvents.call(
      {
        events: [
          {
            ...stopEvent,
            id: "SM-start",
            providerRef: "SM-start",
            body: "INICIAR",
            occurredAt: "2026-08-25T09:01:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );

    expect(
      await canContact.call(
        { contactId: person.id, purpose: "marketing", channel: "sms" },
        OWNER,
      ),
    ).toMatchObject({ allowed: true });
    for (const channel of ["email", "push"] as const) {
      expect(
        await canContact.call(
          { contactId: person.id, purpose: "marketing", channel },
          OWNER,
        ),
      ).toMatchObject({ allowed: false, reason: "withdrawn" });
    }
    expect(await listSmsComplianceEvents.call({ contactId: person.id }, OWNER))
      .toHaveLength(2);
  });

  it("checks the destination against affirmative evidence before any adapter call", async () => {
    const person = await contact("en");
    const missing = await failure(
      sendSms.call(
        {
          contactId: person.id,
          to: "+16045550123",
          body: "Campaign",
          purpose: "marketing",
          idempotencyKey: "campaign-1",
        },
        OWNER,
      ),
    );
    expect(missing.message).toContain("express SMS consent");

    await recordConsent.call(
      {
        contactId: person.id,
        purpose: "marketing",
        channel: "sms",
        state: "granted",
        method: "written",
        termsVersion: "campaign-v1",
        evidence: {},
      },
      OWNER,
    );
    const mismatch = await failure(
      sendSms.call(
        {
          contactId: person.id,
          to: "+16045550999",
          body: "Campaign",
          purpose: "marketing",
          idempotencyKey: "campaign-2",
        },
        OWNER,
      ),
    );
    expect(mismatch.message).toContain("does not match");

    const passedConsent = await failure(
      sendSms.call(
        {
          contactId: person.id,
          to: "+16045550123",
          body: "Campaign",
          purpose: "marketing",
          idempotencyKey: "campaign-3",
        },
        OWNER,
      ),
    );
    // Consent passed; this test instance then reaches its deliberately absent carrier.
    expect(passedConsent.message).toContain("not configured");
  });

  it("keeps immutable compliance evidence in chronological order", async () => {
    const person = await contact();
    await applySmsEvents.call({ events: [stopEvent] }, { kind: "system" });
    const rows = await db()
      .select()
      .from(smsComplianceEvents)
      .where(eq(smsComplianceEvents.contactId, person.id))
      .orderBy(asc(smsComplianceEvents.occurredAt));
    expect(rows.map((entry) => entry.intent)).toEqual(["stop"]);
  });
});
