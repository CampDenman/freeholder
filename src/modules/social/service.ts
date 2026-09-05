// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social profiles: assignment, policy, review and health (MASTER.md §33, C9.24).
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { users } from "@/core/auth/schema";
import { businessLocations } from "@/core/locations/schema";
import { decryptSecret } from "@/core/connections/crypto";
import { socialAdapters } from "@/adapters/social";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import type { JobExecutionContext } from "@/core/jobs";
import {
  SOCIAL_APPROVAL_POLICIES,
  SOCIAL_ASSIGNMENTS,
  SOCIAL_HEALTH,
  SOCIAL_PROFILE_STATUSES,
} from "./contract";
import { socialProfileLocations, socialProfiles } from "./schema";
import { beginOAuth, completeOAuth } from "./oauth";
import {
  applyIngestedProfilePost,
  draftFromPackage,
  ingestProfile,
  ingestProfileIds,
  ingestProfileSource,
  ingestedPost,
  interactionList,
  packageList,
  recordProfileIngest,
  runIngestJob,
  runProfileIngest,
} from "./ingest";
import {
  composePackage,
  createVariants,
  publicationSource,
  publicationCalendar,
  publishDue,
  recordPublicationResult,
  reviewVariant,
  runPublication,
  runPublishJob,
  schedulePublications,
  variantList,
} from "./compose";
import {
  applyGbpReviews,
  attributionReport,
  gbpHoursSource,
  gbpProfileIds,
  gbpProfileSource,
  recordGbpHours,
  runGbpJob,
  runGbpHours,
  runGbpReviews,
  runGbpSync,
  syncGbp,
  syncGbpHours,
  syncGbpReviews,
} from "./gbp";

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
  summary: "Queue token-health probes for connected social profiles.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid.optional() }),
  output: z.object({ queued: z.number().int(), jobIds: z.array(uuid) }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(
        input.id
          ? eq(socialProfiles.id, input.id)
          : inArray(socialProfiles.status, ["active", "needs_reconnect"]),
      );
    const jobIds = [];
    for (const profile of rows) {
      const queued = await ctx.queueJob(
        "social.healthProfileOne",
        { profileId: profile.id },
        {
          idempotencyKey: `social-health:${profile.id}:${Math.floor(Date.now() / 300_000)}`,
          idempotencyTtlSeconds: 10 * 60,
        },
      );
      jobIds.push(queued.id);
    }
    if (input.id) ctx.setSubject("social_profile", input.id);
    return { queued: jobIds.length, jobIds };
  },
});

export const healthProfiles = defineService({
  name: "social.healthProfiles",
  summary: "List profiles whose provider grants need a health probe.",
  kind: "query",
  permission: "system",
  input: z.object({}),
  output: z.array(uuid),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(inArray(socialProfiles.status, ["active", "needs_reconnect"]));
    return rows.map((row) => row.id);
  },
});

export const healthProfileSource = defineService({
  name: "social.healthProfileSource",
  summary: "Read one social grant for its health worker.",
  kind: "query",
  permission: "system",
  input: z.object({ profileId: uuid }),
  output: z.unknown(),
  handler: async (input, ctx) => {
    const [profile] = await ctx.tx
      .select()
      .from(socialProfiles)
      .where(
        and(
          eq(socialProfiles.id, input.profileId),
          inArray(socialProfiles.status, ["active", "needs_reconnect"]),
        ),
      )
      .limit(1);
    if (!profile) return null;
    let accessToken: string | null = null;
    let sourceError: string | null = null;
    try {
      if (!profile.credentials) {
        sourceError = "This profile has no stored credentials.";
      } else {
        const tokens = JSON.parse(decryptSecret(profile.credentials, profile.id)) as {
          accessToken?: string;
        };
        accessToken = tokens.accessToken ?? null;
        if (!accessToken) sourceError = "The stored credentials have no access token.";
      }
    } catch {
      sourceError = "The stored credentials could not be read.";
    }
    return { id: profile.id, provider: profile.provider, accessToken, sourceError };
  },
});

export const applyProfileHealth = defineService({
  name: "social.applyProfileHealth",
  summary: "Record a provider health result fetched by the social worker.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    profileId: uuid,
    response: z.unknown(),
  }),
  output: profileRow.nullable(),
  handler: async (input, ctx) => {
    // Provider text is operational state but not audit input. The service
    // redactor replaces a `response` field wholesale before writing AuditLog.
    const response = z
      .object({ probeOk: z.boolean(), message: z.string().max(1_000).nullable() })
      .parse(input.response);
    const [profile] = await ctx.tx
      .select()
      .from(socialProfiles)
      .where(
        and(
          eq(socialProfiles.id, input.profileId),
          inArray(socialProfiles.status, ["active", "needs_reconnect"]),
        ),
      )
      .limit(1);
    if (!profile) return null;
    const health = healthFromExpiry(profile.tokenExpiresAt, response.probeOk);
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
        lastError: response.message,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(socialProfiles.id, profile.id));
    if (health === "expiring" || health === "expired" || health === "error") {
      ctx.queueEvent("social.profileUnhealthy", { id: profile.id, health });
    }
    ctx.setSubject("social_profile", profile.id);
    return presentProfile(ctx, profile.id);
  },
});

export async function runProfileHealth(
  profileId: string,
  context?: JobExecutionContext,
) {
  const source = await healthProfileSource.call({ profileId }, { kind: "system" });
  if (!source) return null;
  await context?.throwIfCancelled();
  let probeOk = false;
  let message = source.sourceError;
  if (source.accessToken) {
    try {
      const result = await socialAdapters.get(source.provider).health(source.accessToken);
      probeOk = result.ok;
      message = result.ok ? null : result.message;
    } catch (error) {
      message = error instanceof Error ? error.message.slice(0, 1_000) : "Health check failed.";
    }
  }
  await context?.throwIfCancelled();
  return applyProfileHealth.call(
    { profileId: source.id, response: { probeOk, message } },
    { kind: "system" },
  );
}

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

export async function runHealthJob(context?: JobExecutionContext): Promise<void> {
  const profileIds = await healthProfiles.call({}, { kind: "system" });
  for (const profileId of profileIds) await runProfileHealth(profileId, context);
}

export {
  beginOAuth,
  completeOAuth,
  ingestProfile,
  packageList,
  draftFromPackage,
  interactionList,
  runIngestJob,
  runProfileIngest,
  composePackage,
  createVariants,
  reviewVariant,
  variantList,
  schedulePublications,
  publishDue,
  publicationSource,
  recordPublicationResult,
  publicationCalendar,
  runPublishJob,
  runPublication,
  syncGbpHours,
  syncGbpReviews,
  syncGbp,
  attributionReport,
  runGbpJob,
  runGbpHours,
  runGbpReviews,
  runGbpSync,
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
  healthProfiles,
  healthProfileSource,
  applyProfileHealth,
  disconnectProfile,
  ingestProfile,
  ingestProfileIds,
  ingestProfileSource,
  ingestedPost,
  applyIngestedProfilePost,
  recordProfileIngest,
  packageList,
  draftFromPackage,
  interactionList,
  composePackage,
  createVariants,
  reviewVariant,
  variantList,
  schedulePublications,
  publishDue,
  publicationSource,
  recordPublicationResult,
  publicationCalendar,
  syncGbpHours,
  syncGbpReviews,
  syncGbp,
  gbpProfileSource,
  gbpProfileIds,
  gbpHoursSource,
  recordGbpHours,
  applyGbpReviews,
  attributionReport,
];
