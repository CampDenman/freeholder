// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Compose once, variant per profile, publish idempotently (MASTER.md §33, C9.26).
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { storage } from "@/adapters/storage";
import { storageKey } from "@/adapters/storage/types";
import { socialAdapters } from "@/adapters/social";
import { decryptSecret } from "@/core/connections/crypto";
import { assets } from "@/core/media/schema";
import { registerStoredOriginal } from "@/core/media/service";
import {
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import {
  SOCIAL_ASPECTS,
  SOCIAL_PUBLICATION_STATUSES,
  SOCIAL_VARIANT_STATUSES,
} from "./contract";
import { clipCaption, parseHashtags, policyFor } from "./policy";
import { clipVideo, cropStill, stillThumbnail } from "./render";
import {
  socialPackageAssets,
  socialPackages,
  socialProfiles,
  socialPublications,
  socialVariants,
} from "./schema";

function digestOf(body: string, checksums: readonly string[]): string {
  return createHash("sha256")
    .update(`${body}\n${[...checksums].sort().join("\n")}`)
    .digest("hex");
}

const variantRow = row({
  id: uuid,
  packageId: uuid,
  profileId: uuid,
  caption: z.string(),
  hashtags: z.array(z.string()),
  assetIds: z.array(z.string()),
  aspectRatio: z.enum(SOCIAL_ASPECTS),
  generated: z.boolean(),
  status: z.enum(SOCIAL_VARIANT_STATUSES),
  createdAt: timestamp,
});

const publicationRow = row({
  id: uuid,
  packageId: uuid,
  variantId: uuid.nullable(),
  profileId: uuid.nullable(),
  provider: z.string(),
  providerRef: z.string().nullable(),
  status: z.enum(SOCIAL_PUBLICATION_STATUSES),
  scheduledAt: timestamp.nullable(),
  publishedAt: timestamp.nullable(),
  lastError: z.string().nullable(),
  createdAt: timestamp,
});

async function checksumsFor(ctx: ServiceContext, assetIds: readonly string[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const rows = await ctx.tx
    .select({ checksumSha256: assets.checksumSha256 })
    .from(assets)
    .where(inArray(assets.id, [...assetIds]));
  return rows.map((row) => row.checksumSha256 ?? "");
}

export const composePackage = defineService({
  name: "social.composePackage",
  writeClass: "write",
  summary: "Author a social package from caption and library assets.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    body: z.string().trim().max(8_000).default(""),
    assetIds: z.array(uuid).max(20).default([]),
    locale: z.string().trim().min(2).max(20).default("en"),
  }),
  output: row({ id: uuid, contentDigest: z.string() }),
  handler: async (input, ctx) => {
    if (input.assetIds.length === 0 && !input.body) {
      throw new ServiceError("validation", "A post needs a caption or at least one file.");
    }
    if (input.assetIds.length > 0) {
      const found = await ctx.tx
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, input.assetIds));
      if (found.length !== input.assetIds.length) {
        throw new ServiceError("not_found", "One of those files is not in the library.");
      }
    }
    const digest = digestOf(input.body, await checksumsFor(ctx, input.assetIds));
    const author = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [saved] = await ctx.tx
      .insert(socialPackages)
      .values({
        sourceKind: "authored",
        contentDigest: digest,
        authorUserId: author,
        body: input.body,
        locale: input.locale,
        rights: "owned",
        provenance: { composed: true },
      })
      .returning({ id: socialPackages.id });
    let position = 0;
    for (const assetId of input.assetIds) {
      await ctx.tx.insert(socialPackageAssets).values({
        packageId: saved!.id,
        assetId,
        position,
      });
      position += 1;
    }
    ctx.setSubject("social_package", saved!.id);
    return { id: saved!.id, contentDigest: digest };
  },
});

async function storeRendition(
  ctx: ServiceContext,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const key = storageKey(filename, new Date(), randomUUID());
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  await storage().put(key, body, mime);
  const asset = await ctx.callAsSystem(registerStoredOriginal, {
    key,
    filename,
    contentType: mime,
    bytes: bytes.byteLength,
    source: "generated",
    checksumSha256: checksum,
    provenance: { note: "social-variant" },
    metadata: {},
  });
  return asset.id;
}

export const createVariants = defineService({
  name: "social.createVariants",
  writeClass: "write",
  summary: "Make a reviewable rendition of one package for each selected profile.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    packageId: uuid,
    profileIds: z.array(uuid).min(1).max(20),
    caption: z.string().trim().max(8_000).optional(),
  }),
  output: listed(variantRow),
  handler: async (input, ctx) => {
    const [pack] = await ctx.tx
      .select()
      .from(socialPackages)
      .where(eq(socialPackages.id, input.packageId))
      .limit(1);
    if (!pack) throw new ServiceError("not_found", "There is no such package.");
    const attached = await ctx.tx
      .select({ assetId: socialPackageAssets.assetId })
      .from(socialPackageAssets)
      .where(eq(socialPackageAssets.packageId, pack.id));
    const originals = attached.length
      ? await ctx.tx
          .select()
          .from(assets)
          .where(
            inArray(
              assets.id,
              attached.map((row) => row.assetId),
            ),
          )
      : [];
    const created = [];
    for (const profileId of input.profileIds) {
      const [profile] = await ctx.tx
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.id, profileId))
        .limit(1);
      if (!profile || profile.status !== "active") {
        throw new ServiceError("not_found", "One of those profiles is not active.");
      }
      const policy = policyFor(profile.provider);
      const caption = clipCaption(input.caption ?? pack.body, policy.captionLimit);
      const hashtags = parseHashtags(caption);
      const assetIds: string[] = [];
      let generated = false;
      for (const original of originals) {
        const stored = await storage().get(original.storageKey);
        if (!stored) {
          assetIds.push(original.id);
          continue;
        }
        if (original.kind === "image") {
          const crop = await cropStill(stored, policy.aspect, original.filename);
          generated = generated || crop.generated;
          assetIds.push(await storeRendition(ctx, crop.bytes, crop.mime, crop.filename));
          const thumb = await stillThumbnail(stored, original.filename);
          assetIds.push(await storeRendition(ctx, thumb.bytes, thumb.mime, thumb.filename));
        } else if (original.kind === "video") {
          const clip = await clipVideo(
            stored,
            policy.aspect,
            policy.maxDurationSeconds,
            original.filename,
          );
          if (clip) {
            generated = true;
            assetIds.push(await storeRendition(ctx, clip.bytes, clip.mime, clip.filename));
          } else {
            assetIds.push(original.id);
          }
        } else {
          assetIds.push(original.id);
        }
      }
      const needsReview = generated || profile.approvalPolicy === "required";
      const [saved] = await ctx.tx
        .insert(socialVariants)
        .values({
          packageId: pack.id,
          profileId: profile.id,
          caption,
          hashtags,
          assetIds,
          aspectRatio: policy.aspect,
          safeArea: policy.safeArea,
          generated,
          status: needsReview ? "pending_review" : "approved",
        })
        .returning();
      created.push({
        id: saved!.id,
        packageId: saved!.packageId,
        profileId: saved!.profileId,
        caption: saved!.caption,
        hashtags: saved!.hashtags,
        assetIds: saved!.assetIds,
        aspectRatio: saved!.aspectRatio,
        generated: saved!.generated,
        status: saved!.status,
        createdAt: saved!.createdAt,
      });
    }
    ctx.setSubject("social_package", pack.id);
    ctx.queueEvent("social.variantsCreated", {
      packageId: pack.id,
      count: created.length,
    });
    return created;
  },
});

export const reviewVariant = defineService({
  name: "social.reviewVariant",
  writeClass: "write",
  summary: "Approve or reject a generated or policy-gated variant.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid, approved: z.boolean() }),
  output: variantRow,
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(socialVariants)
      .where(eq(socialVariants.id, input.id))
      .limit(1);
    if (!found) throw new ServiceError("not_found", "There is no such variant.");
    if (found.status !== "pending_review" && found.status !== "draft") {
      throw new ServiceError("conflict", "That variant has already been reviewed.");
    }
    const [saved] = await ctx.tx
      .update(socialVariants)
      .set({
        status: input.approved ? "approved" : "rejected",
        updatedAt: new Date(),
      })
      .where(eq(socialVariants.id, input.id))
      .returning();
    ctx.setSubject("social_variant", input.id);
    return {
      id: saved!.id,
      packageId: saved!.packageId,
      profileId: saved!.profileId,
      caption: saved!.caption,
      hashtags: saved!.hashtags,
      assetIds: saved!.assetIds,
      aspectRatio: saved!.aspectRatio,
      generated: saved!.generated,
      status: saved!.status,
      createdAt: saved!.createdAt,
    };
  },
});

export const variantList = defineService({
  name: "social.variantList",
  summary: "Renditions waiting for review or ready to publish.",
  kind: "query",
  permission: "scoped",
  input: z.object({ packageId: uuid.optional() }),
  output: listed(variantRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(socialVariants)
      .where(input.packageId ? eq(socialVariants.packageId, input.packageId) : undefined)
      .orderBy(desc(socialVariants.createdAt));
    return rows.map((saved) => ({
      id: saved.id,
      packageId: saved.packageId,
      profileId: saved.profileId,
      caption: saved.caption,
      hashtags: saved.hashtags,
      assetIds: saved.assetIds,
      aspectRatio: saved.aspectRatio,
      generated: saved.generated,
      status: saved.status,
      createdAt: saved.createdAt,
    }));
  },
});

function accessTokenFor(profile: { id: string; credentials: string | null }): string {
  if (!profile.credentials) {
    throw new ServiceError("validation", "This profile has no stored credentials.");
  }
  const parsed = JSON.parse(decryptSecret(profile.credentials, profile.id)) as {
    accessToken?: string;
  };
  if (!parsed.accessToken) {
    throw new ServiceError("validation", "The stored credentials have no access token.");
  }
  return parsed.accessToken;
}

export const schedulePublications = defineService({
  name: "social.schedulePublications",
  writeClass: "write",
  summary: "Queue approved variants to publish now or at a chosen time.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    variantIds: z.array(uuid).min(1).max(20),
    publishAt: z.string().datetime().optional(),
  }),
  output: listed(publicationRow),
  handler: async (input, ctx) => {
    const when = input.publishAt ? new Date(input.publishAt) : new Date();
    const out = [];
    for (const variantId of input.variantIds) {
      const [variant] = await ctx.tx
        .select()
        .from(socialVariants)
        .where(eq(socialVariants.id, variantId))
        .limit(1);
      if (!variant) throw new ServiceError("not_found", "There is no such variant.");
      if (variant.status !== "approved") {
        throw new ServiceError(
          "conflict",
          "A variant must be approved before it can be scheduled.",
        );
      }
      const [profile] = await ctx.tx
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.id, variant.profileId))
        .limit(1);
      if (!profile || profile.status !== "active" || !profile.allowPublish) {
        throw new ServiceError(
          "permission",
          "Publishing is not switched on for that profile.",
        );
      }
      const idempotencyKey = `social.publish:${variant.id}:${when.toISOString()}`;
      const [existing] = await ctx.tx
        .select()
        .from(socialPublications)
        .where(eq(socialPublications.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        out.push(presentPublication(existing));
        continue;
      }
      const [saved] = await ctx.tx
        .insert(socialPublications)
        .values({
          packageId: variant.packageId,
          variantId: variant.id,
          profileId: profile.id,
          provider: profile.provider,
          status: "scheduled",
          scheduledAt: when,
          idempotencyKey,
        })
        .returning();
      out.push(presentPublication(saved!));
    }
    ctx.queueEvent("social.scheduled", { count: out.length });
    return out;
  },
});

function presentPublication(row: typeof socialPublications.$inferSelect) {
  return {
    id: row.id,
    packageId: row.packageId,
    variantId: row.variantId,
    profileId: row.profileId,
    provider: row.provider,
    providerRef: row.providerRef,
    status: row.status,
    scheduledAt: row.scheduledAt,
    publishedAt: row.publishedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

export const publishDue = defineService({
  name: "social.publishDue",
  writeClass: "write",
  summary: "Publish every due scheduled variant. Partial failure does not retry successes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: listed(publicationRow),
  handler: async (_input, ctx) => {
    const due = await ctx.tx
      .select()
      .from(socialPublications)
      .where(
        and(
          eq(socialPublications.status, "scheduled"),
          or(
            sql`${socialPublications.scheduledAt} is null`,
            lte(socialPublications.scheduledAt, new Date()),
          ),
        ),
      );
    const out = [];
    for (const publication of due) {
      if (!publication.variantId || !publication.profileId) continue;
      const [variant] = await ctx.tx
        .select()
        .from(socialVariants)
        .where(eq(socialVariants.id, publication.variantId))
        .limit(1);
      const [profile] = await ctx.tx
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.id, publication.profileId))
        .limit(1);
      if (!variant || !profile) continue;
      try {
        const adapter = socialAdapters.get(profile.provider);
        const token = accessTokenFor(profile);
        const media = [];
        for (const assetId of variant.assetIds) {
          const [asset] = await ctx.tx
            .select()
            .from(assets)
            .where(eq(assets.id, assetId))
            .limit(1);
          if (!asset) continue;
          media.push({
            url: await storage().url(asset.storageKey, { expiresIn: 3_600 }),
            altText: asset.altText ?? undefined,
          });
        }
        const result = await adapter.publish({
          accountRef: token,
          text: variant.caption,
          media,
          idempotencyKey: publication.idempotencyKey ?? publication.id,
        });
        const [saved] = await ctx.tx
          .update(socialPublications)
          .set({
            status: "published",
            providerRef: result.providerRef,
            publishedAt: new Date(),
            attempts: publication.attempts + 1,
            lastError: null,
          })
          .where(eq(socialPublications.id, publication.id))
          .returning();
        out.push(presentPublication(saved!));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Publish failed.";
        const [saved] = await ctx.tx
          .update(socialPublications)
          .set({
            status: "failed",
            attempts: publication.attempts + 1,
            lastError: message.slice(0, 1_000),
          })
          .where(eq(socialPublications.id, publication.id))
          .returning();
        out.push(presentPublication(saved!));
      }
    }
    return out;
  },
});

export const publicationCalendar = defineService({
  name: "social.publicationCalendar",
  summary: "Scheduled and published posts on one calendar.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
  output: listed(publicationRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(socialPublications)
      .orderBy(desc(socialPublications.scheduledAt), desc(socialPublications.createdAt));
    return rows
      .filter((row) => {
        const at = row.scheduledAt ?? row.publishedAt ?? row.createdAt;
        if (input.from && at < new Date(input.from)) return false;
        if (input.to && at > new Date(input.to)) return false;
        return true;
      })
      .map(presentPublication);
  },
});

export async function runPublishJob(): Promise<void> {
  await publishDue.call({}, { kind: "system" });
}
