// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The narrow authorization boundary for first boot. A newly registered owner
// must finish setup before they can enrol the two-factor credential required
// by their full-access role, so the wizard cannot use ordinary scoped writes.
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { businessProfile } from "@/core/settings/schema";
import { ServiceError, type Actor, type Tx } from "@/core/service";

/**
 * Admit only the instance's real owner, and only while first boot is open.
 *
 * Locking the owner row makes setup mutations serialize with completion. A
 * location request racing the final button therefore cannot sneak in after
 * the wizard has been locked.
 */
export async function requireSetupOwner(tx: Tx, actor: Actor): Promise<void> {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in as the owner to finish setup.");
  }

  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "owner"))
    .limit(1)
    .for("update");
  if (!owner || owner.id !== actor.userId) {
    throw new ServiceError("permission", "Only the owner can finish setup.");
  }

  const [profile] = await tx
    .select({ completedAt: businessProfile.setupCompletedAt })
    .from(businessProfile)
    .where(eq(businessProfile.id, 1))
    .limit(1);
  if (profile?.completedAt) {
    throw new ServiceError("conflict", "Setup is already complete.");
  }
}
