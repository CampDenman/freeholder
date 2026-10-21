// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pull owned posts back into packages and the asset library (MASTER.md §33, C9.25).
//
// Three brakes stop a repost loop: the provider's own post id, a digest of
// the caption plus media checksums, and a publication ancestry row. Comments
// reach the unified inbox only when the provider gave an email — a handle
// is not identity, and inventing a contact from one would fork the spine.
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { storage } from "@/adapters/storage";
import { storageKey } from "@/adapters/storage/types";
import {
  socialAdapters,
  type SocialInteraction,
  type SocialOwnedPost,
} from "@/adapters/social";
import { downloadSocialMedia } from "@/adapters/social/media";
import { decryptSecret } from "@/core/connections/crypto";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { recordMessage } from "@/core/messaging/service";
import {
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import {
  SOCIAL_INTERACTION_KINDS,
  SOCIAL_RIGHTS,
  SOCIAL_SOURCE_KINDS,
} from "./contract";
import {
  socialInteractions,
  socialPackageAssets,
  socialPackages,
  socialProfiles,
  socialPublications,
} from "./schema";
import type { JobExecutionContext } from "@/core/jobs";

function digestOf(body: string, checksums: readonly string[]): string {
  return createHash("sha256")
    .update(`${body}\n${[...checksums].sort().join("\n")}`)
    .digest("hex");
}

function tokensFor(profile: { id: string; credentials: string | null }): {
  accessToken: string;
} {
  if (!profile.credentials) {
    throw new ServiceError("validation", "This profile has no stored credentials.");
  }
  const parsed = JSON.parse(decryptSecret(profile.credentials, profile.id)) as {
    accessToken?: string;
  };
  if (!parsed.accessToken) {
    throw new ServiceError("validation", "The stored credentials have no access token.");
  }
  return { accessToken: parsed.accessToken };
}

async function requireReadableProfile(ctx: ServiceContext, profileId: string) {
  const [profile] = await ctx.tx
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new ServiceError("not_found", "There is no such social profile.");
  if (profile.status !== "active") {
    throw new ServiceError(
      "conflict",
      "Only a reviewed, active profile can be ingested.",
    );
  }
  if (!profile.allowRead) {
    throw new ServiceError(
      "permission",
      "Reading this profile is not switched on.",
    );
  }
  return profile;
}

interface StagedMedia {
  assetId: string;
  checksumSha256: string;
}

interface ProfileIngestResult {
  packagesCreated: number;
  packagesSeen: number;
  interactions: number;
}

const stagedMediaSchema: z.ZodType<StagedMedia> = z.object({
  assetId: uuid,
  checksumSha256: z.string().length(64),
});

const ownedPostSchema = z.object({
  providerRef: z.string().min(1).max(500),
  url: z.string().url().max(2_048).nullable(),
  body: z.string().max(100_000),
  publishedAt: z.iso.datetime(),
});

const interactionSchema = z.object({
  providerRef: z.string().min(1).max(500),
  postProviderRef: z.string().min(1).max(500),
  kind: z.enum(SOCIAL_INTERACTION_KINDS),
  body: z.string().min(1).max(100_000),
  occurredAt: z.iso.datetime(),
  authorHandle: z.string().min(1).max(500),
  authorEmail: z.string().email().max(320).nullable(),
});

async function reclaimMedia(
  profile: { id: string; provider: string },
  post: SocialOwnedPost,
): Promise<StagedMedia[]> {
  const staged: StagedMedia[] = [];
  const { registerStoredOriginal } = await import("@/core/media/service");
  for (const media of post.media) {
    let storedKey: string | undefined;
    try {
      const bytes = await downloadSocialMedia(profile.provider, media.url);
      if (bytes.byteLength === 0) continue;
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const key = storageKey(media.filename, new Date(), randomUUID());
      const store = storage();
      await store.put(key, bytes, media.mime);
      storedKey = key;
      const asset = await registerStoredOriginal.call(
        {
        key,
        filename: media.filename,
        contentType: media.mime,
        bytes: bytes.byteLength,
        altText: media.altText,
        source: "import",
        checksumSha256: checksum,
        provenance: {
          sourceUrl: media.url,
          capturedAt: post.publishedAt,
          note: `social:${profile.provider}:${post.providerRef}`,
        },
        metadata: {},
        },
        { kind: "system" },
      );
      storedKey = undefined;
      staged.push({ assetId: asset.id, checksumSha256: checksum });
    } catch {
      if (storedKey) await storage().delete(storedKey).catch(() => undefined);
      // A missing image must not block the caption. The package still
      // records the post; the owner can see it has no file.
    }
  }
  return staged;
}

async function attachAssets(
  ctx: ServiceContext,
  packageId: string,
  assetIds: readonly string[],
): Promise<void> {
  let position = 0;
  for (const assetId of assetIds) {
    await ctx.tx
      .insert(socialPackageAssets)
      .values({ packageId, assetId, position })
      .onConflictDoNothing();
    position += 1;
  }
}

const packageRow = row({
  id: uuid,
  sourceKind: z.enum(SOCIAL_SOURCE_KINDS),
  sourceProfileId: uuid.nullable(),
  sourceProvider: z.string().nullable(),
  sourceRef: z.string().nullable(),
  contentDigest: z.string(),
  parentPackageId: uuid.nullable(),
  body: z.string(),
  rights: z.enum(SOCIAL_RIGHTS),
  canonicalUrl: z.string().nullable(),
  assetIds: z.array(uuid),
  createdAt: timestamp,
});

async function presentPackage(ctx: ServiceContext, id: string) {
  const [found] = await ctx.tx
    .select()
    .from(socialPackages)
    .where(eq(socialPackages.id, id))
    .limit(1);
  if (!found) throw new ServiceError("not_found", "There is no such package.");
  const assets = await ctx.tx
    .select({ assetId: socialPackageAssets.assetId })
    .from(socialPackageAssets)
    .where(eq(socialPackageAssets.packageId, id));
  return {
    id: found.id,
    sourceKind: found.sourceKind,
    sourceProfileId: found.sourceProfileId,
    sourceProvider: found.sourceProvider,
    sourceRef: found.sourceRef,
    contentDigest: found.contentDigest,
    parentPackageId: found.parentPackageId,
    body: found.body,
    rights: found.rights,
    canonicalUrl: found.canonicalUrl,
    assetIds: assets.map((row) => row.assetId),
    createdAt: found.createdAt,
  };
}

async function applyIngestedPost(
  ctx: ServiceContext,
  profile: { id: string; provider: string },
  post: z.infer<typeof ownedPostSchema>,
  stagedMedia: readonly StagedMedia[],
): Promise<{ packageId: string; created: boolean; usedMedia: boolean }> {
  const [seen] = await ctx.tx
    .select({ packageId: socialPublications.packageId })
    .from(socialPublications)
    .where(
      and(
        eq(socialPublications.provider, profile.provider),
        eq(socialPublications.providerRef, post.providerRef),
      ),
    )
    .limit(1);
  if (seen) return { packageId: seen.packageId, created: false, usedMedia: false };

  const assetIds = stagedMedia.map((media) => media.assetId);
  const contentDigest = digestOf(
    post.body,
    stagedMedia.map((media) => media.checksumSha256),
  );
  const [same] = await ctx.tx
    .select({ id: socialPackages.id })
    .from(socialPackages)
    .where(eq(socialPackages.contentDigest, contentDigest))
    .limit(1);

  let packageId = same?.id;
  let created = false;
  if (!packageId) {
    const author = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [saved] = await ctx.tx
      .insert(socialPackages)
      .values({
        sourceKind: "ingest",
        sourceProfileId: profile.id,
        sourceProvider: profile.provider,
        sourceRef: post.providerRef,
        contentDigest,
        authorUserId: author,
        body: post.body,
        canonicalUrl: post.url,
        rights: "owned",
        provenance: {
          profileId: profile.id,
          provider: profile.provider,
          providerRef: post.providerRef,
          publishedAt: post.publishedAt,
        },
      })
      .returning({ id: socialPackages.id });
    packageId = saved!.id;
    created = true;
    await attachAssets(ctx, packageId, assetIds);
  }
  await ctx.tx.insert(socialPublications).values({
    packageId,
    profileId: profile.id,
    provider: profile.provider,
    providerRef: post.providerRef,
    status: "ingested",
    publishedAt: new Date(post.publishedAt),
  });
  return { packageId, created, usedMedia: stagedMedia.length > 0 };
}

async function ingestInteractions(
  ctx: ServiceContext,
  profile: { id: string; provider: string },
  packageId: string,
  postProviderRef: string,
  items: readonly SocialInteraction[],
): Promise<number> {
  let stored = 0;
  for (const item of items) {
    const [existing] = await ctx.tx
      .select({ id: socialInteractions.id })
      .from(socialInteractions)
      .where(eq(socialInteractions.providerRef, item.providerRef))
      .limit(1);
    if (existing) continue;

    let contactId: string | null = null;
    let conversationId: string | null = null;
    if (item.authorEmail) {
      const recorded = await ctx.callAsSystem(recordMessage, {
        email: item.authorEmail,
        name: item.authorHandle,
        direction: "inbound",
        channel: "social",
        body: item.body,
        providerRef: item.providerRef,
        threadKey: `social:${profile.provider}:${postProviderRef}`,
        occurredAt: item.occurredAt,
      });
      contactId = recorded.conversation.contactId;
      conversationId = recorded.conversation.id;
    }
    await ctx.tx.insert(socialInteractions).values({
      packageId,
      profileId: profile.id,
      providerRef: item.providerRef,
      kind: item.kind,
      body: item.body,
      authorHandle: item.authorHandle,
      authorEmail: item.authorEmail,
      contactId,
      conversationId,
      occurredAt: new Date(item.occurredAt),
    });
    stored += 1;
  }
  return stored;
}

export const ingestProfile = defineService({
  name: "social.ingestProfile",
  writeClass: "write",
  summary: "Queue owned posts and comments to be pulled from one connected profile.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ profileId: uuid }),
  output: row({
    profileId: uuid,
    jobId: uuid,
    queued: z.literal(true),
  }),
  handler: async (input, ctx) => {
    const profile = await requireReadableProfile(ctx, input.profileId);
    const queued = await ctx.queueJob(
      "social.ingestProfileOne",
      { profileId: profile.id },
      {
        idempotencyKey: `social-ingest:${profile.id}:${Math.floor(Date.now() / 300_000)}`,
        idempotencyTtlSeconds: 10 * 60,
      },
    );
    ctx.setSubject("social_profile", profile.id);
    return { profileId: profile.id, jobId: queued.id, queued: true as const };
  },
});

export const ingestProfileSource = defineService({
  name: "social.ingestProfileSource",
  summary: "Read one active profile for the social ingestion worker.",
  kind: "query",
  permission: "system",
  input: z.object({ profileId: uuid }),
  output: z
    .object({ id: uuid, provider: z.string(), accessToken: z.string().min(1) })
    .nullable(),
  handler: async (input, ctx) => {
    try {
      const profile = await requireReadableProfile(ctx, input.profileId);
      return {
        id: profile.id,
        provider: profile.provider,
        accessToken: tokensFor(profile).accessToken,
      };
    } catch (error) {
      if (
        error instanceof ServiceError &&
        ["not_found", "conflict", "permission"].includes(error.code)
      ) {
        return null;
      }
      throw error;
    }
  },
});

export const ingestProfileIds = defineService({
  name: "social.ingestProfileIds",
  summary: "List active readable profiles for the scheduled ingestion fan-out.",
  kind: "query",
  permission: "system",
  input: z.object({}),
  output: z.array(uuid),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(and(eq(socialProfiles.status, "active"), eq(socialProfiles.allowRead, true)));
    return rows.map((row) => row.id);
  },
});

export const ingestedPost = defineService({
  name: "social.ingestedPost",
  summary: "Check whether a provider post already crossed the ingestion boundary.",
  kind: "query",
  permission: "system",
  input: z.object({ provider: z.string(), providerRef: z.string().min(1).max(500) }),
  output: z.object({ packageId: uuid }).nullable(),
  handler: async (input, ctx) => {
    const [seen] = await ctx.tx
      .select({ packageId: socialPublications.packageId })
      .from(socialPublications)
      .where(
        and(
          eq(socialPublications.provider, input.provider),
          eq(socialPublications.providerRef, input.providerRef),
        ),
      )
      .limit(1);
    return seen ?? null;
  },
});

const appliedPostResult = z.object({
  created: z.boolean(),
  interactions: z.number().int(),
  usedMedia: z.boolean(),
});

export const applyIngestedProfilePost = defineService({
  name: "social.applyIngestedProfilePost",
  summary: "Atomically apply one provider post already fetched by the ingestion worker.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    profileId: uuid,
    provider: z.string(),
    response: z.unknown(),
  }),
  output: appliedPostResult,
  handler: async (input, ctx) => {
    const response = z
      .object({
        post: ownedPostSchema,
        media: z.array(stagedMediaSchema).max(20),
        interactions: z.array(interactionSchema).max(1_000),
      })
      .parse(input.response);
    const profile = await requireReadableProfile(ctx, input.profileId);
    if (profile.provider !== input.provider) {
      throw new ServiceError("conflict", "The social profile provider changed during ingestion.");
    }
    const applied = await applyIngestedPost(
      ctx,
      profile,
      response.post,
      response.media,
    );
    const interactions = await ingestInteractions(
      ctx,
      profile,
      applied.packageId,
      response.post.providerRef,
      response.interactions,
    );
    ctx.setSubject("social_profile", profile.id);
    return { created: applied.created, interactions, usedMedia: applied.usedMedia };
  },
});

const profileIngestResult = row({
  packagesCreated: z.number().int(),
  packagesSeen: z.number().int(),
  interactions: z.number().int(),
});

export const recordProfileIngest = defineService({
  name: "social.recordProfileIngest",
  summary: "Record the aggregate result of a completed social ingestion job.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    profileId: uuid,
    packagesCreated: z.number().int().nonnegative(),
    packagesSeen: z.number().int().nonnegative(),
    interactions: z.number().int().nonnegative(),
  }),
  output: profileIngestResult,
  handler: async (input, ctx) => {
    const [profile] = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(eq(socialProfiles.id, input.profileId))
      .limit(1);
    if (!profile) throw new ServiceError("not_found", "There is no such social profile.");
    ctx.setSubject("social_profile", profile.id);
    ctx.queueEvent("social.ingested", {
      profileId: profile.id,
      packagesCreated: input.packagesCreated,
      packagesSeen: input.packagesSeen,
    });
    return {
      packagesCreated: input.packagesCreated,
      packagesSeen: input.packagesSeen,
      interactions: input.interactions,
    };
  },
});

export async function runProfileIngest(
  profileId: string,
  context?: JobExecutionContext,
): Promise<ProfileIngestResult> {
  const profile = await ingestProfileSource.call({ profileId }, { kind: "system" });
  if (!profile) return { packagesCreated: 0, interactions: 0, packagesSeen: 0 };
  await context?.throwIfCancelled();
  const adapter = socialAdapters.get(profile.provider);
  const posts = await adapter.listOwnedPosts(profile.accessToken);
  let packagesCreated = 0;
  let interactions = 0;

  for (const post of posts) {
    await context?.throwIfCancelled();
    const seen = await ingestedPost.call(
      { provider: profile.provider, providerRef: post.providerRef },
      { kind: "system" },
    );
    const media = seen ? [] : await reclaimMedia(profile, post);
    const remoteInteractions = await adapter.listInteractions(
      profile.accessToken,
      post.providerRef,
    );
    await context?.throwIfCancelled();
    const applied = await applyIngestedProfilePost.call(
      {
        profileId: profile.id,
        provider: profile.provider,
        response: {
          post: {
            providerRef: post.providerRef,
            url: post.url,
            body: post.body,
            publishedAt: post.publishedAt,
          },
          media,
          interactions: [...remoteInteractions],
        },
      },
      { kind: "system" },
    );
    if (applied.created) packagesCreated += 1;
    interactions += applied.interactions;
  }

  const totals = await recordProfileIngest.call(
    {
      profileId: profile.id,
      packagesCreated,
      packagesSeen: posts.length,
      interactions,
    },
    { kind: "system" },
  );
  return totals;
}

export const packageList = defineService({
  name: "social.packageList",
  summary: "Owned content packages ingested or drafted from social profiles.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(packageRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ id: socialPackages.id })
      .from(socialPackages)
      .orderBy(desc(socialPackages.createdAt));
    const presented = [];
    for (const row of rows) {
      presented.push(await presentPackage(ctx, row.id));
    }
    return presented;
  },
});

export const draftFromPackage = defineService({
  name: "social.draftFromPackage",
  writeClass: "write",
  summary: "Turn an ingested post into a reviewed cross-pollination draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: packageRow,
  handler: async (input, ctx) => {
    const source = await presentPackage(ctx, input.id);
    const author = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [saved] = await ctx.tx
      .insert(socialPackages)
      .values({
        sourceKind: "draft",
        sourceProfileId: null,
        sourceProvider: null,
        sourceRef: null,
        contentDigest: source.contentDigest,
        parentPackageId: source.id,
        authorUserId: author,
        body: source.body,
        canonicalUrl: source.canonicalUrl,
        rights: source.rights,
        provenance: { fromPackageId: source.id },
      })
      .returning({ id: socialPackages.id });
    await attachAssets(ctx, saved!.id, source.assetIds);
    ctx.setSubject("social_package", saved!.id);
    return presentPackage(ctx, saved!.id);
  },
});

const interactionRow = row({
  id: uuid,
  packageId: uuid,
  kind: z.enum(SOCIAL_INTERACTION_KINDS),
  body: z.string(),
  authorHandle: z.string(),
  authorEmail: z.string().nullable(),
  contactId: uuid.nullable(),
  conversationId: uuid.nullable(),
  occurredAt: timestamp,
});

export const interactionList = defineService({
  name: "social.interactionList",
  summary: "Comments and mentions pulled with an ingested post.",
  kind: "query",
  permission: "scoped",
  input: z.object({ packageId: uuid.optional() }),
  output: listed(interactionRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: socialInteractions.id,
        packageId: socialInteractions.packageId,
        kind: socialInteractions.kind,
        body: socialInteractions.body,
        authorHandle: socialInteractions.authorHandle,
        authorEmail: socialInteractions.authorEmail,
        contactId: socialInteractions.contactId,
        conversationId: socialInteractions.conversationId,
        occurredAt: socialInteractions.occurredAt,
      })
      .from(socialInteractions)
      .where(
        input.packageId
          ? eq(socialInteractions.packageId, input.packageId)
          : undefined,
      )
      .orderBy(desc(socialInteractions.occurredAt)),
});

export async function runIngestJob(): Promise<void> {
  const profileIds = await ingestProfileIds.call({}, { kind: "system" });
  for (const profileId of profileIds) {
    await ingestProfile.call({ profileId }, { kind: "system" });
  }
}

registerContactReference({
  table: "social_interactions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(socialInteractions)
      .set({ contactId: survivingId })
      .where(eq(socialInteractions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({
        id: socialInteractions.id,
        contactId: socialInteractions.contactId,
      })
      .from(socialInteractions)
      .where(inArray(socialInteractions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((row) => row.contactId === duplicateId);
    for (const row of moved) {
      await tx
        .update(socialInteractions)
        .set({ contactId: duplicateId })
        .where(eq(socialInteractions.id, row.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.social",
  tables: ["social_interactions"],
  exportData: async (tx, contactId) => ({
    interactions: await tx
      .select()
      .from(socialInteractions)
      .where(eq(socialInteractions.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    const removed = await tx
      .update(socialInteractions)
      .set({ contactId: null, authorEmail: null })
      .where(eq(socialInteractions.contactId, contactId))
      .returning({ id: socialInteractions.id });
    return { affected: removed.length };
  },
});
