// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { db, type Database } from "@/core/db";
import { moduleSettings } from "@/core/settings/schema";
import { ServiceError } from "@/core/service";

export const RENEWAL_ALERTS_MODULE = "renewal-alerts";

export async function renewalAlertsEnabled(reader: Pick<Database, "select"> = db()): Promise<boolean> {
  const [setting] = await reader.select({ enabled: moduleSettings.enabled })
    .from(moduleSettings).where(eq(moduleSettings.module, RENEWAL_ALERTS_MODULE));
  return setting?.enabled === true;
}

export async function requireRenewalAlertsEnabled(reader: Pick<Database, "select">): Promise<void> {
  if (!await renewalAlertsEnabled(reader)) {
    throw new ServiceError("not_found", "Renewal alerts are not available.");
  }
}
