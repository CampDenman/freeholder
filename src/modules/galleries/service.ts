// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private client galleries (MASTER.md §4.5, C8.03).
//
// Three access modes, one contact. PIN, magic-link and login all open the
// same gallery for the same person; a guest is also a Contact, resolved
// through the spine. Per-asset flags are a ceiling: a guest overlay cannot
// grant more than the item allows.
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { sendMail } from "@/core/mail/service";
import { businessProfile } from "@/core/settings/schema";
import { env } from "@/core/env";
import { assets } from "@/core/media/schema";
import {
  isRasterImage,
  pickRendition,
  publicRenditions,
  watermarkedRenditions,
  type VariantSet,
} from "@/core/media/variants";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import {
  GALLERY_ACCESS_ACTIONS,
  GALLERY_ACCESS_MODES,
  GALLERY_DOWNLOAD_POLICIES,
  GALLERY_GUEST_ROLES,
  galleries,
  galleryAccessLogs,
  galleryGuests,
  galleryItems,
  gallerySessions,
} from "./schema";
import { hashGalleryToken, newGalleryToken } from "./tokens";

const id = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.")
  .max(120);
const pinSecret = z.string().regex(/^\d{4,8}$/, "A PIN is four to eight digits.");
const passwordSecret = z.string().min(8).max(200);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage galleries.");
  }
}

/** Tests and API keys can be user-shaped without a users row. */
async function actingUserId(ctx: ServiceContext): Promise<string | null> {
  if (ctx.actor.kind !== "user") return null;
  const [user] = await ctx.tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.actor.userId))
    .limit(1);
  return user?.id ?? null;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "gallery"
  );
}

function now(): Date {
  return new Date();
}

/**
 * Send the link, and report whether it went. A suppressed address or an
 * unconfigured mailbox is news for the owner, not a reason to refuse to
 * create the guest: the admin screen shows the link so it can be handed over
 * some other way.
 */
async function sendGuestInvite(
  tx: Tx,
  input: {
    to: string;
    site: string;
    title: string;
    link: string;
    expiresAt: Date | null;
    idempotencyKey: string;
  },
): Promise<boolean> {
  try {
    const sent = await sendMail(
      tx,
      {
        to: input.to,
        subject: `${input.title} — your private gallery`,
        text: [
          `${input.site} has shared the gallery "${input.title}" with you.`,
          "",
          "Open it here:",
          input.link,
          "",
          input.expiresAt
            ? `This private link stops working ${input.expiresAt.toISOString()}.`
            : "This link is private to you. Please do not forward it.",
        ].join("\n"),
      },
      { requestedBy: "system", idempotencyKey: input.idempotencyKey },
    );
    return sent.delivers;
  } catch {
    return false;
  }
}

/**
 * The address a guest is actually sent. `/g/{slug}` renders the lock screen
 * with a redeem button rather than opening on GET: a link that mutates when
 * a mail scanner follows it is a link that is spent before it arrives.
 */
function guestLink(slug: string, token: string): string {
  return `${env().APP_URL.replace(/\/+$/, "")}/g/${slug}?token=${encodeURIComponent(token)}`;
}

function isExpired(at: Date | null | undefined): boolean {
  return Boolean(at && at.getTime() <= Date.now());
}

function sessionExpiry(galleryExpiresAt: Date | null): Date {
  const cap = new Date(Date.now() + SESSION_MS);
  if (!galleryExpiresAt) return cap;
  return galleryExpiresAt.getTime() < cap.getTime() ? galleryExpiresAt : cap;
}

const galleryRow = row({
  id: uuid,
  contactId: uuid.nullable(),
  title: z.string(),
  slug: z.string(),
  kind: z.literal("client_delivery"),
  coverAssetId: uuid.nullable(),
  access: z.enum(GALLERY_ACCESS_MODES),
  secretSet: z.boolean(),
  expiresAt: timestamp.nullable(),
  downloadPolicy: z.enum(GALLERY_DOWNLOAD_POLICIES),
  downloadLimit: z.number().int().nullable(),
  watermark: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const itemRow = row({
  id: uuid,
  galleryId: uuid,
  assetId: uuid,
  position: z.number().int(),
  canView: z.boolean(),
  canDownload: z.boolean(),
  filename: z.string().optional(),
  altText: z.string().nullable().optional(),
  mime: z.string().optional(),
  status: z.string().optional(),
});

const guestRow = row({
  id: uuid,
  galleryId: uuid,
  contactId: uuid,
  contactName: z.string().optional(),
  contactEmail: z.string().nullable().optional(),
  role: z.enum(GALLERY_GUEST_ROLES),
  canView: z.boolean(),
  canDownload: z.boolean(),
  expiresAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
});

const logRow = row({
  id: uuid,
  galleryId: uuid,
  contactId: uuid.nullable(),
  action: z.enum(GALLERY_ACCESS_ACTIONS),
  assetId: uuid.nullable(),
  at: timestamp,
});

function publicGallery(
  gallery: typeof galleries.$inferSelect,
): z.infer<typeof galleryRow> {
  const { secretHash, ...rest } = gallery;
  return {
    ...rest,
    kind: "client_delivery",
    secretSet: Boolean(secretHash),
  };
}

async function loadGallery(ctx: ServiceContext, galleryId: string) {
  const [gallery] = await ctx.tx.select().from(galleries).where(eq(galleries.id, galleryId)).limit(1);
  if (!gallery) throw new ServiceError("not_found", "That gallery is not here.");
  return gallery;
}

function assertLive(gallery: { expiresAt: Date | null }): void {
  if (isExpired(gallery.expiresAt)) {
    throw new ServiceError("permission", "This gallery is no longer available.");
  }
}

async function logAccess(
  ctx: ServiceContext,
  input: {
    galleryId: string;
    contactId: string | null;
    action: (typeof GALLERY_ACCESS_ACTIONS)[number];
    assetId?: string | null;
  },
): Promise<void> {
  await ctx.tx.insert(galleryAccessLogs).values({
    galleryId: input.galleryId,
    contactId: input.contactId,
    action: input.action,
    assetId: input.assetId ?? null,
  });
  if (input.contactId) {
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType:
        input.action === "denied"
          ? "gallery.denied"
          : input.action === "download"
            ? "gallery.downloaded"
            : "gallery.viewed",
      subjectType: "gallery",
      subjectId: input.galleryId,
      payload: input.assetId ? { assetId: input.assetId } : {},
    });
  }
}

async function hashSecret(
  access: (typeof GALLERY_ACCESS_MODES)[number],
  secret: string | null | undefined,
): Promise<string | null> {
  if (access === "login") {
    if (secret) {
      throw new ServiceError("validation", "A login gallery does not take a shared secret.");
    }
    return null;
  }
  if (!secret) {
    throw new ServiceError("validation", "Set a PIN or password before this gallery can open.");
  }
  if (access === "pin") {
    pinSecret.parse(secret);
  } else {
    passwordSecret.parse(secret);
  }
  return hashPassword(secret);
}

/**
 * A gallery is looked at on a screen. 1600px is the widest rendition either
 * ladder builds, so asking for it means "the best rendition there is".
 */
const SERVE_WIDTH = 1600;

interface Delivery {
  storageKey: string;
  filename: string;
  mime: string;
  bytes: number;
}

/** A rendition is a different format; the name a client saves must say so. */
function renditionName(filename: string, format: string): string {
  return `${filename.replace(/\.[^.]+$/, "") || "file"}.${format}`;
}

/**
 * Which stored object a gallery hands over for one asset, or null when the
 * policy cannot be honoured.
 *
 * Null is the important case. A watermarked gallery whose asset has no marked
 * rendition must refuse rather than fall back to the master: falling back is
 * indistinguishable, from the client's side, from the owner never having asked
 * for a watermark, and it is the exact file the mark exists to withhold. The
 * same applies to `web_res` on a raster image with no renditions.
 */
function deliverableFor(
  asset: typeof assets.$inferSelect,
  gallery: {
    watermark: boolean;
    downloadPolicy: (typeof GALLERY_DOWNLOAD_POLICIES)[number];
  },
  purpose: "view" | "download",
): Delivery | null {
  const variants = (asset.variants ?? {}) as VariantSet;
  const master: Delivery = {
    storageKey: asset.storageKey,
    filename: asset.filename,
    mime: asset.mime,
    bytes: asset.bytes,
  };

  if (gallery.watermark) {
    // Watermark outranks resolution. An owner who asks for both a mark and
    // full-resolution files is asking for two incompatible things, and the
    // safe reading of that is the marked file.
    const marked = pickRendition(watermarkedRenditions(variants), SERVE_WIDTH);
    if (!marked) return null;
    return {
      storageKey: marked.key,
      filename: renditionName(asset.filename, "webp"),
      mime: "image/webp",
      bytes: marked.bytes,
    };
  }

  const web = pickRendition(
    publicRenditions(variants).flatMap(([, renditions]) => renditions),
    SERVE_WIDTH,
  );

  if (purpose === "view") {
    // Viewing always prefers a rendition when one exists — it is smaller and
    // the client is looking at it on a screen — and the master is a correct
    // fallback because an unwatermarked gallery is not withholding anything.
    if (!web) return master;
    return {
      storageKey: web.key,
      filename: renditionName(asset.filename, "webp"),
      mime: "image/webp",
      bytes: web.bytes,
    };
  }

  if (gallery.downloadPolicy === "web_res") {
    if (web) {
      return {
        storageKey: web.key,
        filename: renditionName(asset.filename, "webp"),
        mime: "image/webp",
        bytes: web.bytes,
      };
    }
    // There is no web resolution of a PDF or a video, so the master is what
    // "web-sized" means for them. A raster image with no renditions is a
    // different story: the master is the full-resolution file the owner
    // declined to hand over.
    return isRasterImage(asset.mime) ? null : master;
  }

  return master;
}

function itemAllowed(
  item: { canView: boolean; canDownload: boolean },
  guest: { canView: boolean; canDownload: boolean } | null,
  kind: "view" | "download",
): boolean {
  const itemOk = kind === "view" ? item.canView : item.canDownload;
  if (!itemOk) return false;
  if (!guest) return true;
  return kind === "view" ? guest.canView : guest.canDownload;
}

async function liveItems(
  ctx: ServiceContext,
  gallery: {
    id: string;
    downloadPolicy: (typeof GALLERY_DOWNLOAD_POLICIES)[number];
    watermark: boolean;
  },
  guest: { canView: boolean; canDownload: boolean } | null,
) {
  const rows = await ctx.tx
    .select({
      item: galleryItems,
      asset: assets,
    })
    .from(galleryItems)
    .innerJoin(assets, eq(assets.id, galleryItems.assetId))
    .where(eq(galleryItems.galleryId, gallery.id))
    .orderBy(asc(galleryItems.position));
  return rows
    .filter((row) => row.asset.status === "ready" && itemAllowed(row.item, guest, "view"))
    .map((row) => ({
      id: row.item.id,
      galleryId: row.item.galleryId,
      assetId: row.item.assetId,
      position: row.item.position,
      canView: true,
      canDownload:
        gallery.downloadPolicy !== "none" &&
        itemAllowed(row.item, guest, "download") &&
        deliverableFor(row.asset, gallery, "download") !== null,
      filename: row.asset.filename,
      altText: row.asset.altText,
      mime: row.asset.mime,
      status: row.asset.status,
    }));
}

async function issueSession(
  ctx: ServiceContext,
  gallery: typeof galleries.$inferSelect,
  contactId: string | null,
  guestId: string | null,
) {
  assertLive(gallery);
  const token = newGalleryToken();
  await ctx.tx.insert(gallerySessions).values({
    galleryId: gallery.id,
    tokenHash: hashGalleryToken("session", token),
    contactId,
    guestId,
    expiresAt: sessionExpiry(gallery.expiresAt),
  });
  return token;
}

async function loadSession(ctx: ServiceContext, token: string) {
  const [session] = await ctx.tx
    .select()
    .from(gallerySessions)
    .where(eq(gallerySessions.tokenHash, hashGalleryToken("session", token)))
    .limit(1);
  if (!session || isExpired(session.expiresAt)) {
    throw new ServiceError("permission", "That did not work. Nothing has changed.");
  }
  const gallery = await loadGallery(ctx, session.galleryId);
  assertLive(gallery);
  const guest = session.guestId
    ? (
        await ctx.tx
          .select()
          .from(galleryGuests)
          .where(eq(galleryGuests.id, session.guestId))
          .limit(1)
      )[0] ?? null
    : null;
  if (guest && (guest.revokedAt || isExpired(guest.expiresAt))) {
    throw new ServiceError("permission", "That did not work. Nothing has changed.");
  }
  return { session, gallery, guest };
}

async function contactForUser(tx: Tx, userId: string): Promise<string | null> {
  const [contact] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .limit(1);
  return contact?.id ?? null;
}

export const createGallery = defineService({
  name: "galleries.create",
  summary: "Start a private client gallery.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: id,
    title: z.string().trim().min(1).max(160),
    slug: slug.optional(),
    access: z.enum(GALLERY_ACCESS_MODES),
    secret: z.string().min(1).max(200).optional(),
    expiresAt: z.iso.datetime().nullish(),
    downloadPolicy: z.enum(GALLERY_DOWNLOAD_POLICIES).default("none"),
    downloadLimit: z.number().int().positive().optional(),
    watermark: z.boolean().default(false),
  }),
  output: galleryRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");
    const secretHash = await hashSecret(input.access, input.secret);
    const downloadPolicy = input.downloadPolicy;
    const downloadLimit = downloadPolicy === "limit_n" ? (input.downloadLimit ?? null) : null;
    if (downloadPolicy === "limit_n" && !downloadLimit) {
      throw new ServiceError("validation", "A limited gallery needs a download count.");
    }
    const candidate = input.slug ?? slugify(input.title);
    try {
      const [created] = await ctx.tx
        .insert(galleries)
        .values({
          contactId: input.contactId,
          title: input.title,
          slug: candidate,
          kind: "client_delivery",
          access: input.access,
          secretHash,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          downloadPolicy,
          downloadLimit,
          watermark: input.watermark,
          createdByUserId: await actingUserId(ctx),
        })
        .returning();
      ctx.setSubject("gallery", created!.id);
      await ctx.emitTimeline({
        contactId: input.contactId,
        eventType: "gallery.created",
        subjectType: "gallery",
        subjectId: created!.id,
      });
      ctx.queueEvent("gallery.created", { id: created!.id, contactId: input.contactId });
      return publicGallery(created!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ServiceError("conflict", "That address is already in use.");
      }
      throw error;
    }
  },
});

export const updateGallery = defineService({
  name: "galleries.update",
  summary: "Change a gallery's access, expiry or download rules.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    title: z.string().trim().min(1).max(160).optional(),
    access: z.enum(GALLERY_ACCESS_MODES).optional(),
    secret: z.string().min(1).max(200).nullish(),
    expiresAt: z.iso.datetime().nullish(),
    downloadPolicy: z.enum(GALLERY_DOWNLOAD_POLICIES).optional(),
    downloadLimit: z.number().int().positive().nullish(),
    watermark: z.boolean().optional(),
    coverAssetId: id.nullish(),
  }),
  output: galleryRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const gallery = await loadGallery(ctx, input.id);
    const access = input.access ?? gallery.access;
    let secretHash = gallery.secretHash;
    if (access === "login") {
      secretHash = null;
    } else if (input.secret) {
      secretHash = await hashSecret(access, input.secret);
    } else if (access !== gallery.access || !gallery.secretHash) {
      throw new ServiceError("validation", "Set a PIN or password before this gallery can open.");
    }
    const downloadPolicy = input.downloadPolicy ?? gallery.downloadPolicy;
    const downloadLimit =
      downloadPolicy === "limit_n"
        ? (input.downloadLimit ?? gallery.downloadLimit)
        : null;
    if (downloadPolicy === "limit_n" && !downloadLimit) {
      throw new ServiceError("validation", "A limited gallery needs a download count.");
    }
    const [updated] = await ctx.tx
      .update(galleries)
      .set({
        title: input.title ?? gallery.title,
        access,
        secretHash,
        expiresAt:
          input.expiresAt === undefined
            ? gallery.expiresAt
            : input.expiresAt
              ? new Date(input.expiresAt)
              : null,
        downloadPolicy,
        downloadLimit,
        watermark: input.watermark ?? gallery.watermark,
        coverAssetId:
          input.coverAssetId === undefined ? gallery.coverAssetId : input.coverAssetId,
      })
      .where(eq(galleries.id, gallery.id))
      .returning();
    if (access !== gallery.access || secretHash !== gallery.secretHash) {
      // A changed door closes the ones already open: a session issued under
      // the old PIN is exactly what rotating the PIN is meant to end.
      await ctx.tx.delete(gallerySessions).where(eq(gallerySessions.galleryId, gallery.id));
    }
    ctx.setSubject("gallery", gallery.id);
    return publicGallery(updated!);
  },
});

export const listGalleries = defineService({
  name: "galleries.list",
  summary: "The private galleries this business is delivering.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  output: listed(galleryRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(galleries)
      .where(eq(galleries.kind, "client_delivery"))
      .orderBy(desc(galleries.updatedAt))
      .limit(input.limit);
    return rows.map(publicGallery);
  },
});

export const getGallery = defineService({
  name: "galleries.get",
  summary: "One gallery, with its items, for the owner.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: galleryRow.extend({ items: listed(itemRow) }),
  handler: async (input, ctx) => {
    const gallery = await loadGallery(ctx, input.id);
    const items = await liveItems(ctx, gallery, null);
    return { ...publicGallery(gallery), items };
  },
});

export const addGalleryItem = defineService({
  name: "galleries.addItem",
  summary: "Put a ready asset in a client gallery.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    galleryId: id,
    assetId: id,
    canView: z.boolean().default(true),
    canDownload: z.boolean().default(true),
  }),
  output: itemRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    await loadGallery(ctx, input.galleryId);
    const [asset] = await ctx.tx
      .select({ id: assets.id, status: assets.status, filename: assets.filename })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not in the library.");
    if (asset.status !== "ready") {
      throw new ServiceError("validation", "Only a ready file can go in a client gallery.");
    }
    const [last] = await ctx.tx
      .select({ position: galleryItems.position })
      .from(galleryItems)
      .where(eq(galleryItems.galleryId, input.galleryId))
      .orderBy(desc(galleryItems.position))
      .limit(1);
    try {
      const [created] = await ctx.tx
        .insert(galleryItems)
        .values({
          galleryId: input.galleryId,
          assetId: input.assetId,
          position: (last?.position ?? -1) + 1,
          canView: input.canView,
          canDownload: input.canDownload,
        })
        .returning();
      ctx.setSubject("gallery", input.galleryId);
      return created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ServiceError("conflict", "That file is already in this gallery.");
      }
      throw error;
    }
  },
});

export const updateGalleryItem = defineService({
  name: "galleries.updateItem",
  summary: "Change what a guest may do with one file.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    canView: z.boolean().optional(),
    canDownload: z.boolean().optional(),
  }),
  output: itemRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [item] = await ctx.tx.select().from(galleryItems).where(eq(galleryItems.id, input.id)).limit(1);
    if (!item) throw new ServiceError("not_found", "That file is not in this gallery.");
    const [updated] = await ctx.tx
      .update(galleryItems)
      .set({
        canView: input.canView ?? item.canView,
        canDownload: input.canDownload ?? item.canDownload,
      })
      .where(eq(galleryItems.id, item.id))
      .returning();
    ctx.setSubject("gallery", item.galleryId);
    return updated!;
  },
});

export const removeGalleryItem = defineService({
  name: "galleries.removeItem",
  summary: "Take a file out of a gallery.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: okResult,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(galleryItems)
      .where(eq(galleryItems.id, input.id))
      .returning({ id: galleryItems.id, galleryId: galleryItems.galleryId });
    if (!removed) throw new ServiceError("not_found", "That file is not in this gallery.");
    ctx.setSubject("gallery", removed.galleryId);
    return { ok: true as const };
  },
});

export const inviteGalleryGuest = defineService({
  name: "galleries.inviteGuest",
  summary: "Give a person scoped access to a gallery.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    galleryId: id,
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200).optional(),
    role: z.enum(GALLERY_GUEST_ROLES).default("partner"),
    canView: z.boolean().default(true),
    canDownload: z.boolean().default(false),
    expiresAt: z.iso.datetime().nullish(),
  }),
  output: guestRow.extend({
    token: z.string(),
    link: z.string(),
    delivers: z.boolean(),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const gallery = await loadGallery(ctx, input.galleryId);
    const resolved = await ctx.call(resolveContact, {
      email: input.email,
      name: input.name,
      source: "gallery-guest",
    });
    const token = newGalleryToken();
    const tokenHash = hashGalleryToken("guest", token);
    const existing = await ctx.tx
      .select()
      .from(galleryGuests)
      .where(
        and(
          eq(galleryGuests.galleryId, gallery.id),
          eq(galleryGuests.contactId, resolved.contact.id),
        ),
      )
      .limit(1);
    let guest: typeof galleryGuests.$inferSelect;
    if (existing[0]) {
      const [updated] = await ctx.tx
        .update(galleryGuests)
        .set({
          role: input.role,
          tokenHash,
          canView: input.canView,
          canDownload: input.canDownload,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : gallery.expiresAt,
          revokedAt: null,
          invitedByUserId: await actingUserId(ctx),
        })
        .where(eq(galleryGuests.id, existing[0].id))
        .returning();
      guest = updated!;
    } else {
      const [created] = await ctx.tx
        .insert(galleryGuests)
        .values({
          galleryId: gallery.id,
          contactId: resolved.contact.id,
          role: input.role,
          tokenHash,
          canView: input.canView,
          canDownload: input.canDownload,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : gallery.expiresAt,
          invitedByUserId: await actingUserId(ctx),
        })
        .returning();
      guest = created!;
    }
    const link = guestLink(gallery.slug, token);
    const [business] = await ctx.tx
      .select({ name: businessProfile.name })
      .from(businessProfile)
      .limit(1);
    const site = business?.name ?? "this Freeholder site";
    const sent = await sendGuestInvite(ctx.tx, {
      to: resolved.contact.email ?? input.email,
      site,
      title: gallery.title,
      link,
      expiresAt: guest.expiresAt,
      idempotencyKey: `gallery-guest:${guest.id}:${tokenHash.slice(0, 32)}`,
    });
    ctx.setSubject("gallery", gallery.id);
    await ctx.emitTimeline({
      contactId: resolved.contact.id,
      eventType: "gallery.guestInvited",
      subjectType: "gallery",
      subjectId: gallery.id,
      payload: { role: guest.role },
    });
    ctx.queueEvent("gallery.guestInvited", {
      id: guest.id,
      galleryId: gallery.id,
      contactId: resolved.contact.id,
    });
    return {
      ...guest,
      contactName: resolved.contact.name,
      contactEmail: resolved.contact.email,
      token,
      link,
      delivers: sent,
    };
  },
});

export const revokeGalleryGuest = defineService({
  name: "galleries.revokeGuest",
  summary: "Take a guest's access away.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: okResult,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [guest] = await ctx.tx
      .update(galleryGuests)
      .set({ revokedAt: now(), tokenHash: null })
      .where(eq(galleryGuests.id, input.id))
      .returning();
    if (!guest) throw new ServiceError("not_found", "That guest is not here.");
    await ctx.tx.delete(gallerySessions).where(eq(gallerySessions.guestId, guest.id));
    ctx.setSubject("gallery", guest.galleryId);
    await ctx.emitTimeline({
      contactId: guest.contactId,
      eventType: "gallery.guestRevoked",
      subjectType: "gallery",
      subjectId: guest.galleryId,
    });
    ctx.queueEvent("gallery.guestRevoked", { id: guest.id, galleryId: guest.galleryId });
    return { ok: true as const };
  },
});

export const listGalleryGuests = defineService({
  name: "galleries.listGuests",
  summary: "Who has been given access to a gallery.",
  kind: "query",
  permission: "scoped",
  input: z.object({ galleryId: id }),
  output: listed(guestRow),
  handler: async (input, ctx) => {
    await loadGallery(ctx, input.galleryId);
    const rows = await ctx.tx
      .select({
        guest: galleryGuests,
        name: contacts.name,
        email: contacts.email,
      })
      .from(galleryGuests)
      .innerJoin(contacts, eq(contacts.id, galleryGuests.contactId))
      .where(eq(galleryGuests.galleryId, input.galleryId))
      .orderBy(desc(galleryGuests.createdAt));
    return rows.map((row) => ({
      ...row.guest,
      contactName: row.name,
      contactEmail: row.email,
    }));
  },
});

export const listGalleryAccess = defineService({
  name: "galleries.listAccess",
  summary: "The access audit for one gallery.",
  kind: "query",
  permission: "scoped",
  input: z.object({ galleryId: id, limit: z.number().int().min(1).max(200).default(100) }),
  output: listed(logRow),
  handler: async (input, ctx) => {
    await loadGallery(ctx, input.galleryId);
    return ctx.tx
      .select()
      .from(galleryAccessLogs)
      .where(eq(galleryAccessLogs.galleryId, input.galleryId))
      .orderBy(desc(galleryAccessLogs.at))
      .limit(input.limit);
  },
});

const unlocked = z.object({
  ok: z.literal(true),
  sessionToken: z.string(),
  gallery: galleryRow.pick({
    id: true,
    title: true,
    slug: true,
    access: true,
    downloadPolicy: true,
    watermark: true,
    expiresAt: true,
  }),
  items: listed(itemRow),
});
const unlockResult = z.union([unlocked, z.object({ ok: z.literal(false) })]);

async function denyUnlock(
  ctx: ServiceContext,
  galleryId: string,
  contactId: string | null,
): Promise<{ ok: false }> {
  // Recorded as the successful outcome of this call so the audit survives
  // commit. Throwing would roll the denial back, which is how a guessed PIN
  // would leave no trace.
  await logAccess(ctx, { galleryId, contactId, action: "denied" });
  return { ok: false };
}

export const unlockGallery = defineService({
  name: "galleries.unlock",
  summary: "Open a gallery with its PIN or password.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    slug,
    secret: z.string().min(1).max(200),
  }),
  rateLimit: {
    limit: 8,
    windowSeconds: 15 * 60,
    subject: (input) => `gallery-unlock:${input.slug}`,
    message: "Too many tries. Wait a few minutes and try again.",
  },
  output: unlockResult,
  handler: async (input, ctx) => {
    const [gallery] = await ctx.tx
      .select()
      .from(galleries)
      .where(and(eq(galleries.slug, input.slug), eq(galleries.kind, "client_delivery")))
      .limit(1);
    if (!gallery) throw new ServiceError("not_found", "That gallery is not here.");
    if (isExpired(gallery.expiresAt)) {
      await logAccess(ctx, { galleryId: gallery.id, contactId: null, action: "denied" });
      throw new ServiceError("permission", "This gallery is no longer available.");
    }
    if (gallery.access === "login" || !gallery.secretHash) {
      return denyUnlock(ctx, gallery.id, null);
    }
    const ok = await verifyPassword(input.secret, gallery.secretHash);
    // The audit records that the gallery refused someone. It does not record
    // that the client was refused: a wrong PIN is anonymous by definition.
    if (!ok) return denyUnlock(ctx, gallery.id, null);
    const token = await issueSession(ctx, gallery, gallery.contactId, null);
    await logAccess(ctx, { galleryId: gallery.id, contactId: gallery.contactId, action: "view" });
    ctx.setSubject("gallery", gallery.id);
    ctx.queueEvent("gallery.accessed", { id: gallery.id, via: gallery.access });
    return {
      ok: true as const,
      sessionToken: token,
      gallery: publicGallery(gallery),
      items: await liveItems(ctx, gallery, null),
    };
  },
});

export const redeemGalleryGuest = defineService({
  name: "galleries.redeemGuest",
  summary: "Open a gallery from a magic-link token.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({ token: z.string().min(20).max(200) }),
  rateLimit: {
    limit: 20,
    windowSeconds: 15 * 60,
    subject: (input) => `gallery-guest:${hashGalleryToken("guest", input.token)}`,
    message: "Too many tries. Wait a few minutes and try again.",
  },
  output: unlockResult,
  handler: async (input, ctx) => {
    const [guest] = await ctx.tx
      .select()
      .from(galleryGuests)
      .where(eq(galleryGuests.tokenHash, hashGalleryToken("guest", input.token)))
      .limit(1);
    if (!guest || guest.revokedAt || isExpired(guest.expiresAt)) {
      throw new ServiceError("permission", "That did not work. Nothing has changed.");
    }
    const gallery = await loadGallery(ctx, guest.galleryId);
    if (isExpired(gallery.expiresAt)) {
      await logAccess(ctx, { galleryId: gallery.id, contactId: guest.contactId, action: "denied" });
      throw new ServiceError("permission", "This gallery is no longer available.");
    }
    const token = await issueSession(ctx, gallery, guest.contactId, guest.id);
    await logAccess(ctx, { galleryId: gallery.id, contactId: guest.contactId, action: "view" });
    ctx.setSubject("gallery", gallery.id);
    ctx.queueEvent("gallery.accessed", { id: gallery.id, via: "magic-link" });
    return {
      ok: true as const,
      sessionToken: token,
      gallery: publicGallery(gallery),
      items: await liveItems(ctx, gallery, guest),
    };
  },
});

export const openGalleryWithLogin = defineService({
  name: "galleries.openWithLogin",
  summary: "Open a gallery as the signed-in client or guest.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ slug }),
  output: unlockResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to open this gallery.");
    }
    const [gallery] = await ctx.tx
      .select()
      .from(galleries)
      .where(and(eq(galleries.slug, input.slug), eq(galleries.kind, "client_delivery")))
      .limit(1);
    if (!gallery) throw new ServiceError("not_found", "That gallery is not here.");
    if (isExpired(gallery.expiresAt)) {
      await logAccess(ctx, { galleryId: gallery.id, contactId: null, action: "denied" });
      throw new ServiceError("permission", "This gallery is no longer available.");
    }
    const contactId = await contactForUser(ctx.tx, ctx.actor.userId);
    if (!contactId) return denyUnlock(ctx, gallery.id, null);
    const isClient = contactId === gallery.contactId;
    const [guest] = isClient
      ? []
      : await ctx.tx
          .select()
          .from(galleryGuests)
          .where(
            and(
              eq(galleryGuests.galleryId, gallery.id),
              eq(galleryGuests.contactId, contactId),
              isNull(galleryGuests.revokedAt),
            ),
          )
          .limit(1);
    if (!isClient && (!guest || isExpired(guest.expiresAt))) {
      return denyUnlock(ctx, gallery.id, contactId);
    }
    const token = await issueSession(ctx, gallery, contactId, guest?.id ?? null);
    await logAccess(ctx, { galleryId: gallery.id, contactId, action: "view" });
    ctx.setSubject("gallery", gallery.id);
    ctx.queueEvent("gallery.accessed", { id: gallery.id, via: "login" });
    return {
      ok: true as const,
      sessionToken: token,
      gallery: publicGallery(gallery),
      items: await liveItems(ctx, gallery, guest ?? null),
    };
  },
});

export const viewGallerySession = defineService({
  name: "galleries.viewSession",
  summary: "Read a gallery through a live session token.",
  kind: "query",
  permission: "public",
  input: z.object({ sessionToken: z.string().min(20).max(200) }),
  output: unlocked,
  handler: async (input, ctx) => {
    const { gallery, guest } = await loadSession(ctx, input.sessionToken);
    return {
      ok: true as const,
      sessionToken: input.sessionToken,
      gallery: publicGallery(gallery),
      items: await liveItems(ctx, gallery, guest),
    };
  },
});

export const downloadGalleryItem = defineService({
  name: "galleries.downloadItem",
  summary: "Download one gallery file the session is allowed to take.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    sessionToken: z.string().min(20).max(200),
    itemId: id,
  }),
  output: row({
    assetId: uuid,
    storageKey: z.string(),
    filename: z.string(),
    mime: z.string(),
    bytes: z.number(),
  }),
  handler: async (input, ctx) => {
    const { session, gallery, guest } = await loadSession(ctx, input.sessionToken);
    const [row] = await ctx.tx
      .select({ item: galleryItems, asset: assets })
      .from(galleryItems)
      .innerJoin(assets, eq(assets.id, galleryItems.assetId))
      .where(and(eq(galleryItems.id, input.itemId), eq(galleryItems.galleryId, gallery.id)))
      .limit(1);
    if (!row || row.asset.status !== "ready") {
      throw new ServiceError("not_found", "That file is not in this gallery.");
    }
    const delivery =
      gallery.downloadPolicy === "none" || !itemAllowed(row.item, guest, "download")
        ? null
        : deliverableFor(row.asset, gallery, "download");
    if (!delivery) {
      await logAccess(ctx, {
        galleryId: gallery.id,
        contactId: session.contactId,
        action: "denied",
        assetId: row.asset.id,
      });
      throw new ServiceError("permission", "That file cannot be downloaded.");
    }
    if (gallery.downloadPolicy === "limit_n") {
      const [taken] = await ctx.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(galleryAccessLogs)
        .where(
          and(
            eq(galleryAccessLogs.galleryId, gallery.id),
            eq(galleryAccessLogs.action, "download"),
          ),
        );
      const next = (taken?.count ?? 0) + 1;
      if (next > (gallery.downloadLimit ?? 0)) {
        await logAccess(ctx, {
          galleryId: gallery.id,
          contactId: session.contactId,
          action: "denied",
          assetId: row.asset.id,
        });
        throw new ServiceError("permission", "This gallery's download limit has been reached.");
      }
      // The limit is the gallery's; this column only records what this
      // session took, which is what the owner sees per visit.
      await ctx.tx
        .update(gallerySessions)
        .set({ downloadsUsed: session.downloadsUsed + 1 })
        .where(eq(gallerySessions.id, session.id));
    }
    await logAccess(ctx, {
      galleryId: gallery.id,
      contactId: session.contactId,
      action: "download",
      assetId: row.asset.id,
    });
    ctx.setSubject("gallery", gallery.id);
    return { assetId: row.asset.id, ...delivery };
  },
});

export const viewGalleryItem = defineService({
  name: "galleries.viewItem",
  summary: "Authorize one gallery image for a live session.",
  kind: "query",
  permission: "public",
  input: z.object({
    sessionToken: z.string().min(20).max(200),
    itemId: id,
  }),
  output: row({
    assetId: uuid,
    storageKey: z.string(),
    filename: z.string(),
    mime: z.string(),
    bytes: z.number().int(),
  }).nullable(),
  handler: async (input, ctx) => {
    const { gallery, guest } = await loadSession(ctx, input.sessionToken);
    const [found] = await ctx.tx
      .select({ item: galleryItems, asset: assets })
      .from(galleryItems)
      .innerJoin(assets, eq(assets.id, galleryItems.assetId))
      .where(and(eq(galleryItems.id, input.itemId), eq(galleryItems.galleryId, gallery.id)))
      .limit(1);
    if (!found || found.asset.status !== "ready") return null;
    if (!itemAllowed(found.item, guest, "view")) return null;
    // Null when a watermarked gallery has nothing marked to show: the page
    // renders a gap rather than the unmarked original.
    const delivery = deliverableFor(found.asset, gallery, "view");
    if (!delivery) return null;
    return { assetId: found.asset.id, ...delivery };
  },
});

export const galleryBySlug = defineService({
  name: "galleries.publicBySlug",
  summary: "The lock screen facts for a gallery, never its files.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: row({
    title: z.string(),
    slug: z.string(),
    access: z.enum(GALLERY_ACCESS_MODES),
    expired: z.boolean(),
  }).nullable(),
  handler: async (input, ctx) => {
    const [gallery] = await ctx.tx
      .select({
        title: galleries.title,
        slug: galleries.slug,
        access: galleries.access,
        expiresAt: galleries.expiresAt,
        kind: galleries.kind,
      })
      .from(galleries)
      .where(and(eq(galleries.slug, input.slug), eq(galleries.kind, "client_delivery")))
      .limit(1);
    if (!gallery) return null;
    return {
      title: gallery.title,
      slug: gallery.slug,
      access: gallery.access,
      expired: isExpired(gallery.expiresAt),
    };
  },
});

export const expireGallerySessions = defineService({
  name: "galleries.expireSessions",
  summary: "Delete gallery sessions that have expired.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({}),
  output: row({ deleted: z.number().int() }),
  handler: async (_input, ctx) => {
    const deleted = await ctx.tx
      .delete(gallerySessions)
      .where(lt(gallerySessions.expiresAt, sql`now()`))
      .returning({ id: gallerySessions.id });
    return { deleted: deleted.length };
  },
});

registerContactReference({
  table: "galleries",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(galleries).set({ contactId: survivingId }).where(eq(galleries.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: galleries.id, contactId: galleries.contactId })
      .from(galleries)
      .where(inArray(galleries.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((gallery) => gallery.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(galleries)
        .set({ contactId: duplicateId })
        .where(inArray(galleries.id, moved.map((gallery) => gallery.id)));
    }
  },
});

registerContactReference({
  table: "gallery_guests",
  // A guest row is unique per gallery+person. If the survivor is already a
  // guest on the same gallery, the duplicate's row is dropped rather than
  // violating the unique index — two invitations to the same person are one.
  repoint: async (tx, duplicateId, survivingId) => {
    const duplicateGuests = await tx
      .select()
      .from(galleryGuests)
      .where(eq(galleryGuests.contactId, duplicateId));
    for (const guest of duplicateGuests) {
      const [survivor] = await tx
        .select({ id: galleryGuests.id })
        .from(galleryGuests)
        .where(
          and(eq(galleryGuests.galleryId, guest.galleryId), eq(galleryGuests.contactId, survivingId)),
        )
        .limit(1);
      if (survivor) {
        await tx.delete(gallerySessions).where(eq(gallerySessions.guestId, guest.id));
        await tx.delete(galleryGuests).where(eq(galleryGuests.id, guest.id));
      } else {
        await tx
          .update(galleryGuests)
          .set({ contactId: survivingId })
          .where(eq(galleryGuests.id, guest.id));
      }
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: galleryGuests.id, contactId: galleryGuests.contactId })
      .from(galleryGuests)
      .where(inArray(galleryGuests.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((guest) => guest.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(galleryGuests)
        .set({ contactId: duplicateId })
        .where(inArray(galleryGuests.id, moved.map((guest) => guest.id)));
    }
  },
});

registerContactReference({
  table: "gallery_access_logs",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(galleryAccessLogs)
      .set({ contactId: survivingId })
      .where(eq(galleryAccessLogs.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: galleryAccessLogs.id, contactId: galleryAccessLogs.contactId })
      .from(galleryAccessLogs)
      .where(inArray(galleryAccessLogs.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((entry) => entry.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(galleryAccessLogs)
        .set({ contactId: duplicateId })
        .where(inArray(galleryAccessLogs.id, moved.map((entry) => entry.id)));
    }
  },
});

registerContactReference({
  table: "gallery_sessions",
  // A bearer for the duplicate identity must not silently become a credential
  // for the survivor. Invalidate it by deletion, same as customer magic links.
  repoint: (tx, duplicateId) =>
    tx.delete(gallerySessions).where(eq(gallerySessions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => {
    const rows = await tx
      .select({ id: gallerySessions.id })
      .from(gallerySessions)
      .where(eq(gallerySessions.contactId, duplicateId));
    return {
      state: rows,
      undoable: rows.length === 0,
      blocker:
        rows.length > 0
          ? "A gallery session was invalidated for security and cannot be restored."
          : undefined,
    };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactPrivacySource({
  scope: "contact.galleries",
  tables: ["galleries", "gallery_guests", "gallery_access_logs", "gallery_sessions"],
  exportData: async (tx, contactId) => {
    const owned = await tx.select().from(galleries).where(eq(galleries.contactId, contactId));
    const guests = await tx.select().from(galleryGuests).where(eq(galleryGuests.contactId, contactId));
    const logs = await tx
      .select()
      .from(galleryAccessLogs)
      .where(eq(galleryAccessLogs.contactId, contactId));
    return { galleries: owned, guests, logs };
  },
  erase: async (tx, contactId) => {
    // The gallery is the business's delivery record. The person goes; the
    // work stays. What is stripped is the link and every credential issued
    // to them.
    const owned = await tx
      .update(galleries)
      .set({ contactId: null })
      .where(eq(galleries.contactId, contactId))
      .returning({ id: galleries.id });
    await tx.delete(gallerySessions).where(eq(gallerySessions.contactId, contactId));
    await tx.delete(galleryGuests).where(eq(galleryGuests.contactId, contactId));
    await tx
      .update(galleryAccessLogs)
      .set({ contactId: null })
      .where(eq(galleryAccessLogs.contactId, contactId));
    return { affected: owned.length };
  },
});

export default [
  createGallery,
  updateGallery,
  listGalleries,
  getGallery,
  addGalleryItem,
  updateGalleryItem,
  removeGalleryItem,
  inviteGalleryGuest,
  revokeGalleryGuest,
  listGalleryGuests,
  listGalleryAccess,
  unlockGallery,
  redeemGalleryGuest,
  openGalleryWithLogin,
  viewGallerySession,
  viewGalleryItem,
  downloadGalleryItem,
  galleryBySlug,
  expireGallerySessions,
];
