// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Device registration for push (MASTER.md §35.1, C10.14).
//
// §35.1: "Push is a notification channel, not a second notification system.
// The device token is a `NotificationDelivery` channel like email and SMS
// (§30), registered against the contact, subject to the same per-topic
// preferences, and revoked when the session ends. A push that says something
// the platform would not have emailed is a bug. Tokens expire and are
// re-registered on every launch; a token that a provider reports as
// unregistered is deleted rather than retried, because retrying a dead token
// forever is how a push budget disappears."
//
// Everything here is about *which devices*, never about *what to say* — the
// message is whatever the notification already decided, in the recipient's
// language, subject to the preferences core already applied.
import { and, eq, isNull } from "drizzle-orm";
import { deviceTokens } from "./schema";
import type { Tx } from "@/core/service";

export interface RegisteredDevice {
  id: string;
  token: string;
  platform: "ios" | "android";
  contractVersion: number;
}

/**
 * Record that an install is reachable, moving the token if it has changed hands.
 *
 * Upsert on the token, not on (contact, token). A device token identifies an
 * install; when a phone is handed on, or a second customer signs in on the same
 * device, the row moves. Inserting instead would leave the previous owner
 * registered and push somebody else's bookings to the new one.
 */
export async function registerDevice(
  tx: Tx,
  input: {
    contactId: string;
    token: string;
    platform: "ios" | "android";
    appVersion: string;
    contractVersion: number;
  },
): Promise<{ id: string; moved: boolean }> {
  const [existing] = await tx
    .select({ id: deviceTokens.id, contactId: deviceTokens.contactId })
    .from(deviceTokens)
    .where(eq(deviceTokens.token, input.token))
    .limit(1);

  const [row] = await tx
    .insert(deviceTokens)
    .values({
      contactId: input.contactId,
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion,
      contractVersion: input.contractVersion,
    })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: {
        contactId: input.contactId,
        platform: input.platform,
        appVersion: input.appVersion,
        contractVersion: input.contractVersion,
        lastSeenAt: new Date(),
        // Re-registering un-revokes: the install is demonstrably alive again,
        // and §35.1 says tokens are re-registered on every launch.
        revokedAt: null,
      },
    })
    .returning({ id: deviceTokens.id });

  return {
    id: row!.id,
    moved: Boolean(existing && existing.contactId !== input.contactId),
  };
}

/**
 * Stop pushing to one install.
 *
 * Revoked rather than deleted, so a device that signs back in is recognised
 * rather than treated as new — and so an owner asking "why did this stop" has
 * something to look at.
 */
export async function revokeDevice(tx: Tx, token: string): Promise<boolean> {
  const rows = await tx
    .update(deviceTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceTokens.token, token), isNull(deviceTokens.revokedAt)))
    .returning({ id: deviceTokens.id });
  return rows.length > 0;
}

/** Every install this contact can currently be reached on. */
export async function devicesForContact(
  tx: Tx,
  contactId: string,
): Promise<RegisteredDevice[]> {
  const rows = await tx
    .select({
      id: deviceTokens.id,
      token: deviceTokens.token,
      platform: deviceTokens.platform,
      contractVersion: deviceTokens.contractVersion,
    })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.contactId, contactId), isNull(deviceTokens.revokedAt)));
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    platform: row.platform,
    contractVersion: row.contractVersion,
  }));
}

/**
 * Forget a token a provider has told us is dead.
 *
 * Deleted, not revoked. §35.1: "a token that a provider reports as
 * unregistered is deleted rather than retried, because retrying a dead token
 * forever is how a push budget disappears." A revoked row would keep being
 * inspected; a deleted one cannot be.
 */
export async function forgetDeadToken(tx: Tx, token: string): Promise<void> {
  await tx.delete(deviceTokens).where(eq(deviceTokens.token, token));
}

/**
 * Move a duplicate contact's devices onto the survivor (CLAUDE.md's spine rule).
 *
 * A plain repoint is safe here precisely because the unique index is on the
 * token alone: the survivor cannot already hold the row being moved, so there
 * is no conflict to resolve. Had the index been on (contact, token), this would
 * have needed a decision instead of an update.
 */
export async function repointDeviceTokens(
  tx: Tx,
  duplicateId: string,
  survivingId: string,
): Promise<void> {
  await tx
    .update(deviceTokens)
    .set({ contactId: survivingId })
    .where(eq(deviceTokens.contactId, duplicateId));
}
