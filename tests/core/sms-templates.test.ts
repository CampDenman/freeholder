// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared email/SMS template objects and contact-local rendering (C7.14).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { updateBusiness } from "@/core/settings/service";
import { ensureTemplates } from "@/modules/cms/template-service";
import { estimatedSmsSegments, previewSms } from "@/modules/cms/sms-template-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("SMS segment preview", () => {
  it("distinguishes GSM concatenation from Unicode", () => {
    expect(estimatedSmsSegments("a".repeat(160))).toBe(1);
    expect(estimatedSmsSegments("a".repeat(161))).toBe(2);
    expect(estimatedSmsSegments("🙂".repeat(36))).toBe(2);
  });
});

describe.runIf(hasDatabase)("SMS templates", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("uses the shared template table and renders for contact locale and timezone", async () => {
    await updateBusiness.call(
      {
        name: "Harbour Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        defaultLocale: "en",
        schemaType: "ProfessionalService",
      },
      OWNER,
    );
    await ensureTemplates.call({}, OWNER);
    const [person] = await db()
      .insert(contacts)
      .values({
        name: "Sam Lee",
        email: "sam-template@example.test",
        phone: "+15005550188",
        preferredLocale: "fr-CA",
        timezone: "America/Toronto",
      })
      .returning();

    const preview = await previewSms.call(
      { key: "sms.transactional", contactId: person!.id },
      OWNER,
    );
    // There is no French row yet, so the canonical English template is the
    // safe fallback while variables still use the recipient's data and zone.
    expect(preview.locale).toBe("en");
    expect(preview.timezone).toBe("America/Toronto");
    expect(preview.body).toContain("Sam");
    expect(preview.body).toContain("Harbour Studio");
    expect(preview.body).not.toContain("{{");
    expect(preview.estimatedSegments).toBeGreaterThan(0);
  });
});
