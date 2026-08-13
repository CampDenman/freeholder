// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contact-driven customer locale resolution (MASTER.md §4.9, C1.16).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { getMyLocale, setMyLocale } from "@/core/i18n/service";
import { localeForRecipient } from "@/core/i18n/customer";
import { businessProfile } from "@/core/settings/schema";
import {
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("customer locale", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(businessProfile).values({
      name: "Locale Studio",
      country: "CA",
      defaultLocale: "en",
      enabledLocales: ["en", "fr"],
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
    });
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email: "customer@example.test",
      role: "customer",
      passwordHash: null,
    });
  });

  afterAll(closeDb);

  it("resolves the linked Contact preference for portal and delivery callers", async () => {
    const [contact] = await db().insert(contacts).values({
      userId: CUSTOMER.userId,
      name: "Portal Customer",
      email: "customer@example.test",
      preferredLocale: "fr-CA",
    }).returning();

    await expect(getMyLocale.call({}, CUSTOMER)).resolves.toMatchObject({
      locale: "fr",
      defaultLocale: "en",
      enabledLocales: ["en", "fr"],
    });
    await expect(db().transaction((tx) => localeForRecipient(tx, {
      kind: "contact",
      id: contact!.id,
    }))).resolves.toMatchObject({ locale: "fr" });
  });

  it("changes the Contact fact once and rejects a language the site does not publish", async () => {
    const [contact] = await db().insert(contacts).values({
      userId: CUSTOMER.userId,
      name: "Portal Customer",
      email: "customer@example.test",
      preferredLocale: "fr",
    }).returning();

    await expect(setMyLocale.call({ locale: "en" }, CUSTOMER))
      .resolves.toMatchObject({ locale: "en" });
    expect((await db().select().from(contacts).where(eq(contacts.id, contact!.id)))[0])
      .toMatchObject({ preferredLocale: "en" });
    expect((await db().select().from(timelineEvents))[0]).toMatchObject({
      eventType: "contact.localeChanged",
      payload: { locale: "en" },
    });

    expect((await failure(setMyLocale.call({ locale: "es" }, CUSTOMER))).code)
      .toBe("validation");
  });

  it("does not let an unlinked account invent a customer preference", async () => {
    expect((await failure(setMyLocale.call({ locale: "fr" }, CUSTOMER))).code)
      .toBe("permission");
  });
});
