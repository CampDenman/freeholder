// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deliver the security escalation (MASTER.md §39.10, C10.22).
//
// The decision is in `escalation.ts` and is pure. This is the part that reads
// the cache, finds the owners and writes the notification — kept apart so the
// rule about *when* to interrupt somebody can be tested without a database.
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { PLATFORM_VERSION } from "@/core/platform";
import { createNotificationTx } from "@/core/notifications/service";
import { listCachedReleases, updateStatus } from "./catalog";
import { decideEscalation, escalationMessage } from "./escalation";
import { updateCheckEnabled } from "./check";
import { updateSettings } from "./schema";
import { isPaused } from "./policy";

export interface EscalationRun {
  escalated: boolean;
  version: string | null;
  notified: number;
  reason: string;
}

export async function escalateOutstandingSecurityUpdates(
  now = new Date(),
): Promise<EscalationRun> {
  return db().transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(updateSettings)
      .where(eq(updateSettings.id, 1))
      .limit(1);
    const channel = settings?.channel === "off" ? "security" : (settings?.channel ?? "security");
    const cached = await listCachedReleases(tx as never);
    const status = updateStatus({
      currentVersion: PLATFORM_VERSION,
      channel,
      cached,
      lastCheckedAt: settings?.lastCheckedAt ?? null,
      checksEnabled: updateCheckEnabled(),
    });

    const decision = decideEscalation({
      missingSecurity: status.missingSecurity,
      now,
      paused: settings
        ? isPaused(
            {
              channel: settings.channel,
              applyLevel: settings.applyLevel,
              window: settings.window,
              drain: settings.drain,
              notifyChannels: settings.notifyChannels,
              keepSnapshots: settings.keepSnapshots,
              lastCheckedAt: settings.lastCheckedAt,
              pausedUntil: settings.pausedUntil,
            },
            now,
          )
        : false,
    });
    if (!decision.escalate) {
      return { escalated: false, version: null, notified: 0, reason: decision.reason };
    }

    // Owners, because this is a decision about the business's exposure and
    // staff cannot act on it: applying an update is a `platform` grant.
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    if (owners.length === 0) {
      return {
        escalated: false,
        version: decision.release!.version,
        notified: 0,
        reason: "No owner account exists to notify.",
      };
    }

    const message = escalationMessage(decision);
    let notified = 0;
    for (const owner of owners) {
      const result = await createNotificationTx(tx, {
        recipient: { kind: "user", id: owner.id },
        topic: "platform.securityUpdate",
        // Critical, so it escapes a digest. A CVSS 9 release that waits for
        // the weekly summary has not been escalated, it has been filed.
        priority: decision.band === "low" ? "warning" : "critical",
        title: message.title,
        body: message.body,
        href: "/admin/updates",
        messageParams: {},
        // Bucketed by version and day, so a job that runs often escalates
        // once a day at most, and a newer release still gets its own alarm.
        idempotencyKey: `${decision.idempotencyKey}:${owner.id}`,
        dedupeKey: `platform.securityUpdate:${owner.id}`,
        occurredAt: now,
      });
      if (!result.duplicate) notified += 1;
    }
    return {
      escalated: true,
      version: decision.release!.version,
      notified,
      reason: decision.reason,
    };
  });
}
