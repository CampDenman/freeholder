// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social profiles: assignment, policy, review and health (MASTER.md §33, C9.24).
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { users } from "@/core/auth/schema";
import { businessLocations } from "@/core/locations/schema";
import { decryptSecret } from "@/core/connections/crypto";
import { socialAdapters } from "@/adapters/social";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import {
  SOCIAL_APPROVAL_POLICIES,
  SOCIAL_ASSIGNMENTS,
  SOCIAL_HEALTH,
  SOCIAL_PROFILE_STATUSES,
} from "./contract";
import { socialProfileLocations, socialProfiles } from "./schema";
import { beginOAuth, completeOAuth } from "./oauth";

const EXPIRING_MS = 48 * 60 * 60 * 1000;

function healthFromExpiry(
  expiresAt: Date | null,
  probeOk: boolean,
): (typeof SOCIAL_HEALTH)[number] {
  if (!probeOk) return "error";
  if (!expiresAt) return "ok";
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining <= 0) return "expired";
  if (remaining <= EXPIRING_MS) return "expiring";
  return "ok";
}

const networkRow = row({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  message: z.string(),
  pkce: z.boolean(),
  capabilities: z.object({
    read: z.boolean(),
    respond: z.boolean(),
    publish: z.boolean(),
    extras: z.array(z.string()),
  }),
});

export const networks = defineService({
  name: "social.networks",
  summary: "Every social adapter this instance knows, built-in or plugin.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(networkRow),
  handler: async () =>
    socialAdapters
      .list()
      .filter((adapter) => adapter.id !== "none")
      .map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
        available: adapter.status.available,
        message: adapter.status.message,
        pkce: adapter.pkce,
        capabilities: {
          read: adapter.declaredCapabilities.read,
          respond: adapter.declaredCapabilities.respond,
          publish: adapter.declaredCapabilities.publish,
          extras: [...adapter.declaredCapabilities.extras],
        },
      })),
});

const profileRow = row({
  id: uuid,
  provider: z.string(),
  providerAccountId: z.string(),
  displayName: z.string(),
  handle: z.string().nullable(),
  status: z.enum(SOCIAL_PROFILE_STATUSES),
  assignedTo: z.enum(SOCIAL_ASSIGNMENTS),
  assigneeUserId: uuid.nullable(),
  locationIds: z.array(uuid),
  allowRead: z.boolean(),
  allowRespond: z.boolean(),
  allowPublish: z.boolean(),
  approvalPolicy: z.enum(SOCIAL_APPROVAL_POLICIES),
  capabilities: z.object({
    read: z.boolean(),
    respond: z.boolean(),
    publish: z.boolean(),
    extras: z.array(z.string()),
  }),
  tokenExpiresAt: timestamp.nullable(),
  lastHealthAt: timestamp.nullable(),
  lastHealthStatus: z.enum(SOCIAL_HEALTH).nullable(),
  lastError: z.string().nullable(),
  createdAt: timestamp,
});

async function locationIdsFor(
  ctx: ServiceContext,
  profileId: string,
): Promise<string[]> {
  const rows = await ctx.tx
    .select({ locationId: socialProfileLocations.locationId })
    .from(socialProfileLocations)
    .where(eq(socialProfileLocations.profileId, profileId));
  return rows.map((row) => row.locationId);
}

async function presentProfile(ctx: ServiceContext, id: string) {
  const [found] = await ctx.tx
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.id, id))
    .limit(1);
  if (!found) throw new ServiceError("not_found", "There is no such social profile.");
  const capabilities = found.capabilities ?? {
    read: false,
    respond: false,
    publish: false,
    extras: [],
  };
  return {
    id: found.id,
    provider: found.provider,
    providerAccountId: found.providerAccountId,
    displayName: found.displayName,
    handle: found.handle,
    status: found.status,
    assignedTo: found.assignedTo,
    assigneeUserId: found.assigneeUserId,
    locationIds: await locationIdsFor(ctx, found.id),
    allowRead: found.allowRead,
    allowRespond: found.allowRespond,
    allowPublish: found.allowPublish,
    approvalPolicy: found.approvalPolicy,
    capabilities: {
      read: Boolean(capabilities.read),
      respond: Boolean(capabilities.respond),
      publish: Boolean(capabilities.publish),
      extras: Array.isArray(capabilities.extras)
        ? capabilities.extras.map(String)
        : [],
    },
    tokenExpiresAt: found.tokenExpiresAt,
    lastHealthAt: found.lastHealthAt,
    lastHealthStatus: found.lastHealthStatus,
    lastError: found.lastError,
    createdAt: found.createdAt,
  };
}

export const profiles = defineService({
  name: "social.profiles",
  summary: "Connected social profiles, including those still waiting for review.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(profileRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .orderBy(desc(socialProfiles.createdAt));
    const presented = [];
    for (const row of rows) {
      presented.push(await presentProfile(ctx, row.id));
    }
    return presented;
  },
});

export const staffMembers = defineService({
  name: "social.staffMembers",
  summary: "People a social profile can be assigned to.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(row({ id: uuid, email: z.string() })),
  handler: (_input, ctx) =>
    ctx.tx.select({ id: users.id, email: users.email }).from(users),
});

export const reviewProfile = defineService({
  name: "social.reviewProfile",
  writeClass: "write",
  summary: "Approve or reject a newly connected social profile.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuid,
    approved: z.boolean(),
  }),
  output: profileRow,
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.id, input.id))
      .limit(1);
    if (!found) throw new ServiceError("not_found", "There is no such social profile.");
    if (found.status !== "pending_review") {
      throw new ServiceError("conflict", "That profile has already been reviewed.");
    }
    const reviewer = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    await ctx.tx
      .update(socialProfiles)
      .set({
        status: input.approved ? "active" : "revoked",
        reviewedAt: new Date(),
        reviewedBy: reviewer,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.id, input.id));
    ctx.setSubject("social_profile", input.id);
    ctx.queueEvent("social.profileReviewed", {
      id: input.id,
      approved: input.approved,
    });
    return presentProfile(ctx, input.id);
  },
});

export const assignProfile = defineService({
  name: "social.assignProfile",
  writeClass: "write",
  summary: "Assign a social profile to a person, the business, or locations.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuid,
    assignedTo: z.enum(SOCIAL_ASSIGNMENTS),
    assigneeUserId: uuid.nullish(),
    locationIds: z.array(uuid).max(50).default([]),
  }),
  output: profileRow,
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(eq(socialProfiles.id, input.id))
      .limit(1);
    if (!found) throw new ServiceError("not_found", "There is no such social profile.");

    if (input.assignedTo === "user") {
      if (!input.assigneeUserId) {
        throw new ServiceError(
          "validation",
          "Assigning a profile to a person needs that person.",
        );
      }
      const [person] = await ctx.tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.assigneeUserId))
        .limit(1);
      if (!person) {
        throw new ServiceError("not_found", "There is no such person to assign this profile to.");
      }
    }
    if (input.assignedTo === "locations") {
      if (input.locationIds.length === 0) {
        throw new ServiceError(
          "validation",
          "Assigning a profile to locations needs at least one location.",
        );
      }
      const existing = await ctx.tx
        .select({ id: businessLocations.id })
        .from(businessLocations)
        .where(inArray(businessLocations.id, input.locationIds));
      if (existing.length !== input.locationIds.length) {
        throw new ServiceError("not_found", "One of those locations does not exist.");
      }
    }

    await ctx.tx
      .update(socialProfiles)
      .set({
        assignedTo: input.assignedTo,
        assigneeUserId: input.assignedTo === "user" ? input.assigneeUserId! : null,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.id, input.id));
    await ctx.tx
      .delete(socialProfileLocations)
      .where(eq(socialProfileLocations.profileId, input.id));
    if (input.assignedTo === "locations") {
      await ctx.tx.insert(socialProfileLocations).values(
        input.locationIds.map((locationId) => ({
          profileId: input.id,
          locationId,
        })),
      );
    }
    ctx.setSubject("social_profile", input.id);
    ctx.queueEvent("social.profileAssigned", {
      id: input.id,
      assignedTo: input.assignedTo,
    });
    return presentProfile(ctx, input.id);
  },
});

export const setPolicy = defineService({
  name: "social.setPolicy",
  writeClass: "write",
  summary: "Set read, respond, publish and approval policy on one profile.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuid,
    allowRead: z.boolean(),
    allowRespond: z.boolean(),
    allowPublish: z.boolean(),
    approvalPolicy: z.enum(SOCIAL_APPROVAL_POLICIES),
  }),
  output: profileRow,
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(socialProfiles)
      .set({
        allowRead: input.allowRead,
        allowRespond: input.allowRespond,
        allowPublish: input.allowPublish,
        approvalPolicy: input.approvalPolicy,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.id, input.id))
      .returning({ id: socialProfiles.id });
    if (!updated) throw new ServiceError("not_found", "There is no such social profile.");
    ctx.setSubject("social_profile", input.id);
    return presentProfile(ctx, input.id);
  },
});

export const checkHealth = defineService({
  name: "social.checkHealth",
  writeClass: "write",
  summary: "Probe one profile's token and record whether it will survive post time.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid.optional() }),
  output: listed(profileRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(socialProfiles)
      .where(
        input.id
          ? eq(socialProfiles.id, input.id)
          : inArray(socialProfiles.status, ["active", "needs_reconnect"]),
      );
    const presented = [];
    for (const profile of rows) {
      let probeOk = false;
      let message: string | null = null;
      try {
        if (!profile.credentials) {
          message = "This profile has no stored credentials.";
        } else {
          const tokens = JSON.parse(
            decryptSecret(profile.credentials, profile.id),
          ) as { accessToken?: string };
          const adapter = socialAdapters.get(profile.provider);
          if (!tokens.accessToken) {
            message = "The stored credentials have no access token.";
          } else {
            const result = await adapter.health(tokens.accessToken);
            probeOk = result.ok;
            message = result.ok ? null : result.message;
          }
        }
      } catch (error) {
        message = error instanceof Error ? error.message : "Health check failed.";
      }
      const health = healthFromExpiry(profile.tokenExpiresAt, probeOk);
      const nextStatus =
        health === "expired" || health === "error"
          ? "needs_reconnect"
          : profile.status === "needs_reconnect" && health === "ok"
            ? "active"
            : profile.status;
      await ctx.tx
        .update(socialProfiles)
        .set({
          lastHealthAt: new Date(),
          lastHealthStatus: health,
          lastError: message,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.id, profile.id));
      if (health === "expiring" || health === "expired" || health === "error") {
        ctx.queueEvent("social.profileUnhealthy", {
          id: profile.id,
          health,
        });
      }
      presented.push(await presentProfile(ctx, profile.id));
    }
    return presented;
  },
});

export const disconnectProfile = defineService({
  name: "social.disconnectProfile",
  writeClass: "write",
  summary: "Revoke a social profile and drop its credentials.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(socialProfiles)
      .set({
        status: "revoked",
        credentials: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.id, input.id))
      .returning({ id: socialProfiles.id });
    if (!updated) throw new ServiceError("not_found", "There is no such social profile.");
    ctx.setSubject("social_profile", input.id);
    return { ok: true as const };
  },
});

export async function runHealthJob(): Promise<void> {
  await checkHealth.call({}, { kind: "system" });
}

export {
  beginOAuth,
  completeOAuth,
};

export default [
  networks,
  profiles,
  staffMembers,
  beginOAuth,
  completeOAuth,
  reviewProfile,
  assignProfile,
  setPolicy,
  checkHealth,
  disconnectProfile,
];
