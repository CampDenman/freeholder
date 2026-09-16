// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Seeded owner session for C11 browser journeys. First-boot is C1.22; these
// proofs start after setup. Inserts only — service.call boots the job graph
// in a way Playwright's test process cannot wire.
import type { BrowserContext } from "@playwright/test";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { OWNER } from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

export const C11_OWNER_EMAIL = "owner@example.test";
export const C11_BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
export const C11_OWNER = OWNER;

export async function seedC11Owner(name = "C11 Studio"): Promise<string> {
  await resetBrowserDatabase();
  await db().insert(users).values({
    id: OWNER.userId,
    email: C11_OWNER_EMAIL,
    role: "owner",
  });
  await db().insert(totpFactors).values({
    userId: OWNER.userId,
    encryptedSecret: "c11-browser-fixture",
  });
  await db()
    .insert(businessProfile)
    .values({
      name,
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
      defaultLocale: "en",
      enabledLocales: ["en", "es", "fr"],
      setupCompletedAt: new Date(),
    });
  const session = await db().transaction((tx) =>
    createSession(tx, OWNER.userId, { twoFactorVerified: true }),
  );
  return session.token;
}

export async function useOwnerSession(
  context: BrowserContext,
  token: string,
): Promise<void> {
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, url: C11_BASE_URL },
  ]);
}
