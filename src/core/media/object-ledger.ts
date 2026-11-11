// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared infrastructure: reserve before provider I/O on the owning service TX.
import { mediaObjects } from "./schema";
import type { ServiceContext } from "@/core/service";
import { storage } from "@/adapters/storage";

const owners = new Map<string, (key: string, now: Date) => Promise<boolean>>();
export function registerPendingObjectOwner(prefix: string, owns: (key: string, now: Date) => Promise<boolean>): void {
  if (!prefix || !prefix.endsWith("/")) throw new Error("A pending object owner needs a namespace prefix.");
  owners.set(prefix, owns);
}
export async function pendingObjectIsOwned(key: string, now = new Date()): Promise<boolean> {
  for (const [prefix, owns] of owners) if (key.startsWith(prefix) && await owns(key, now)) return true;
  return false;
}
/** A queued deletion never overrides later, explicitly retained ownership. */
export async function deleteUnownedPendingObjects(keys: readonly string[]): Promise<{ deleted: number }> {
  let deleted = 0;
  for (const key of keys) if (!await pendingObjectIsOwned(key)) { await storage().delete(key); deleted += 1; }
  return { deleted };
}

/** The caller authorizes the operation and derives its own storage namespace. */
export async function reservePendingMediaObject(
  ctx: Pick<ServiceContext, "tx">,
  input: { key: string; role: "original" | "staged"; contentType: string; bytes: number },
): Promise<void> {
  await ctx.tx.insert(mediaObjects).values({
    key: input.key, role: input.role, state: "pending", bytes: input.bytes, contentType: input.contentType,
  }).onConflictDoNothing();
}
