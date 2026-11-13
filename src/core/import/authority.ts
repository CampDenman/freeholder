// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: no source phase inherits a revoked credential's old permission snapshot.
import { eq } from "drizzle-orm";
import { apiKeys } from "@/core/apikeys/schema";
import { roleGrants, sessions, totpFactors, users, webauthnCredentials } from "@/core/auth/schema";
import { isPrivilegedGrants } from "@/core/auth/two-factor-crypto";
import { STEP_UP_TTL_MS } from "@/core/auth/sessions";
import { permits, ServiceError, type Actor, type ServiceContext, type Permission } from "@/core/service";

const checked = new WeakMap<object, WeakMap<Actor, Actor>>();

/** Original audit actor stays unchanged; this is an additional refusal fence. */
async function loadCurrentImportAuthority(ctx: ServiceContext): Promise<Actor> {
  const actor = ctx.actor;
  const cached = checked.get(ctx.tx)?.get(actor);
  if (cached) return cached;
  let current: Actor = actor;
  if ((actor.kind === "agent" || actor.kind === "user") && actor.keyId) {
    const [key] = await ctx.tx.select({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, actsAsUserId: apiKeys.actsAsUserId, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt }).from(apiKeys).where(eq(apiKeys.id, actor.keyId)).limit(1).for("share", { noWait: true });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now()) || (actor.kind === "agent" ? key.actsAsUserId !== null : key.actsAsUserId !== actor.userId)) throw new ServiceError("permission", "The original import credential is no longer active.");
    current = actor.kind === "agent" ? { ...actor, scopes: key.scopes } : { ...actor, keyScopes: key.scopes };
  } else if (actor.kind === "agent") {
    // A friendly name is reusable after revocation. It never identifies the
    // credential that authorized a durable phase.
    throw new ServiceError("permission", "A resumable import needs a current authenticated credential.");
  }
  if (current.kind === "user" && (current.sessionId || current.keyId)) {
    if (current.sessionId) {
      const [session] = await ctx.tx.select({ userId: sessions.userId, expiresAt: sessions.expiresAt, verifiedAt: sessions.twoFactorVerifiedAt, stepUpAt: sessions.stepUpAt }).from(sessions).where(eq(sessions.id, current.sessionId)).limit(1).for("share", { noWait: true });
      if (!session || session.userId !== current.userId || session.expiresAt.getTime() <= Date.now()) throw new ServiceError("permission", "The original import session is no longer active.");
      const factor = await ctx.tx.select({ id: totpFactors.userId }).from(totpFactors).where(eq(totpFactors.userId, current.userId)).limit(1).for("share", { noWait: true });
      const passkey = await ctx.tx.select({ id: webauthnCredentials.id }).from(webauthnCredentials).where(eq(webauthnCredentials.userId, current.userId)).limit(1).for("share", { noWait: true });
      current = { ...current, security: { twoFactorRequired: false, twoFactorEnrolled: factor.length + passkey.length > 0, twoFactorVerified: Boolean(session.verifiedAt), stepUpValid: Boolean(session.stepUpAt && Date.now() - session.stepUpAt.getTime() <= STEP_UP_TTL_MS) } };
    }
    const [person] = await ctx.tx.select({ role: users.role }).from(users).where(eq(users.id, current.userId)).limit(1).for("share", { noWait: true });
    if (!person) throw new ServiceError("permission", "The original import account is no longer active.");
    const grants = await ctx.tx.select({ module: roleGrants.module, access: roleGrants.access }).from(roleGrants).where(eq(roleGrants.roleKey, person.role)).for("share", { noWait: true });
    current = { ...current, role: person.role, grants, ...(current.security ? { security: { ...current.security, twoFactorRequired: isPrivilegedGrants(grants) } } : {}) };
  }
  if (current.kind === "system" || current.kind === "anonymous" || current.kind === "plugin") throw new ServiceError("permission", "The original caller no longer has permission to advance this import.");
  let actors = checked.get(ctx.tx);
  if (!actors) { actors = new WeakMap(); checked.set(ctx.tx, actors); }
  actors.set(actor, current);
  return current;
}

export async function currentImportAuthority(ctx: ServiceContext): Promise<Actor> {
  try {
    return await loadCurrentImportAuthority(ctx);
  }
  catch (error) {
    // Identity/erasure callers may already hold their own rows. Never wait
    // while holding another authorization row in the opposite order.
    const raw = error as { code?: string; cause?: { code?: string } };
    if (raw.code === "55P03" || raw.cause?.code === "55P03") throw new ServiceError("conflict", "Import authorization is changing. Retry after the current operation completes.");
    throw error;
  }
}

export async function assertCurrentImportAuthority(ctx: ServiceContext, parent: string, kind: "query" | "mutation" = "mutation", permission: Permission = "scoped"): Promise<void> {
  const current = await currentImportAuthority(ctx);
  if (!permits(current, permission, parent, kind)) throw new ServiceError("permission", "The original caller no longer has permission to advance this import.");
}

/** Durable private phases bind a credential ID, independently of audit names. */
export async function importLeaseOwner(ctx: ServiceContext): Promise<string> {
  const actor = await currentImportAuthority(ctx);
  if ((actor.kind === "user" || actor.kind === "agent") && actor.keyId) return `key:${actor.keyId}`;
  if (actor.kind === "user") return `user:${actor.userId}`;
  throw new ServiceError("permission", "The original import phase needs its current authenticated caller.");
}
