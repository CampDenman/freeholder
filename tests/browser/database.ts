// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared disposable-database reset for serial real-browser suites.
import postgres from "postgres";
import { db } from "@/core/db";
import { seedDefaultRoles } from "@/core/roles/defaults";
import { seedCoreGuidanceFlows } from "@/core/guidance/definitions";
import { demoScenarios } from "@/core/demo/schema";
import cmsOnboarding from "@/modules/cms/onboarding";
import formsOnboarding from "@/modules/forms/onboarding";
import seedOnboarding from "@/modules/seed/onboarding";

export async function resetBrowserDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL was not configured for the browser suite.");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await client<{ tablename: string }[]>`
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename <> '__drizzle_migrations'
      order by tablename
    `;
    if (rows.length === 0) {
      throw new Error("The browser test database has no migrated tables.");
    }
    const names = rows.map(
      ({ tablename }) => `"${tablename.replaceAll('"', '""')}"`,
    );
    await client.unsafe(`truncate table ${names.join(", ")} restart identity cascade`);
  } finally {
    await client.end();
  }
  await db().transaction(async (tx) => {
    await seedDefaultRoles(tx);
    await seedCoreGuidanceFlows(tx);
    const scenario = seedOnboarding.scenarios[0]!;
    await tx
      .insert(demoScenarios)
      .values({
        key: scenario.key,
        version: scenario.version,
        titleKey: scenario.titleKey,
        descriptionKey: scenario.descriptionKey,
        preset: scenario.preset,
        requiredModules: scenario.requiredModules,
        requiredCapabilities: scenario.requiredCapabilities,
        fixtureManifest: [
          cmsOnboarding.fixtures[0]!,
          formsOnboarding.fixtures[0]!,
        ],
        defaultLocale: scenario.defaultLocale,
        supportedLocales: scenario.supportedLocales,
        tourFlowKey: scenario.tourFlowKey,
        status: scenario.status,
      })
      .onConflictDoNothing();
  });
}
