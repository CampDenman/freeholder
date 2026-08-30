// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents shared with a client, and their history (MASTER.md §4.5, C8.13).
//
// Three rules from §4.5 shape every service here.
//
//   "A document is revised, not replaced." So `addVersion` is the only way a
//   file changes, there is no service that edits a version, and the version
//   number comes from the database rather than the caller.
//
//   "Documents reuse the gallery access vocabulary deliberately." So `open`
//   below reads almost exactly like `galleries.open`: the same modes, the same
//   expiry check, the same refusal to say *why* a secret was wrong.
//
//   "Every open is on the record." So each of the four ways a share can fail
//   writes a `denied` row with its reason before it throws, and the throw says
//   less than the row does — the owner learns which of expiry, revocation, the
//   download limit or the password stopped somebody; the visitor learns only
//   that it did not open.
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";
import { assets } from "@/core/media/schema";
import { users } from "@/core/auth/schema";
import {
  DOCUMENT_ACCESS_ACTIONS,
  DOCUMENT_ACCESS_MODES,
  DOCUMENT_DOWNLOAD_POLICIES,
  documentAccessLogs,
  documentShares,
  documentVersions,
  documents,
} from "./schema";
import { hashShareToken, newShareToken } from "./tokens";
// Claims this module's room in the customer portal (C8.11). Imported for its
// side effect: core owns the registry so it never imports a module.
import "./portal";

const documentRow = row({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: uuidSchema.nullable(),
  contactId: uuidSchema.nullable(),
  currentVersionId: uuidSchema.nullable(),
  status: z.enum(["draft", "shared", "archived"]),
  updatedAt: z.date(),
});

const versionRow = row({
  id: uuidSchema,
  documentId: uuidSchema,
  version: z.number().int(),
  assetId: uuidSchema,
  note: z.string().nullable(),
  createdAt: z.date(),
});

const shareRow = row({
  id: uuidSchema,
  documentId: uuidSchema,
  contactId: uuidSchema.nullable(),
  access: z.enum(DOCUMENT_ACCESS_MODES),
  pinnedVersionId: uuidSchema.nullable(),
  downloadPolicy: z.enum(DOCUMENT_DOWNLOAD_POLICIES),
  downloadLimit: z.number().int().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

/**
 * The acting user, if there really is such a row.
 *
 * Tests and API keys can be user-shaped without a `users` row, so writing
 * `ctx.actor.userId` straight into a foreign key fails on exactly the callers
 * that are hardest to notice. Galleries solved this the same way; the
 * attribution is worth having and worth not crashing over.
 */
async function actingUserId(ctx: ServiceContext): Promise<string | null> {
  if (ctx.actor.kind !== "user") return null;
  const [user] = await ctx.tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.actor.userId))
    .limit(1);
  return user?.id ?? null;
}

function isExpired(at: Date | null): boolean {
  return at !== null && at.getTime() <= Date.now();
}

/** Append one row to the history. Never conditional on the outcome. */
async function logAccess(
  tx: Tx,
  entry: {
    documentId: string;
    versionId?: string | null;
    shareId?: string | null;
    contactId?: string | null;
    action: "view" | "download" | "denied";
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(documentAccessLogs).values({
    documentId: entry.documentId,
    versionId: entry.versionId ?? null,
    shareId: entry.shareId ?? null,
    contactId: entry.contactId ?? null,
    action: entry.action,
    reason: entry.reason ?? null,
  });
}

/* ------------------------------------------------------------ the owner */

export const saveDocument = defineService({
  name: "documents.save",
  writeClass: "write",
  summary: "Create or rename a document.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullish(),
    subjectType: z.string().trim().max(40).nullish(),
    subjectId: uuidSchema.nullish(),
    contactId: uuidSchema.nullish(),
    status: z.enum(["draft", "shared", "archived"]).default("draft"),
  }),
  output: documentRow,
  handler: async (input, ctx) => {
    const values = {
      title: input.title,
      description: input.description ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      contactId: input.contactId ?? null,
      status: input.status,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(documents)
        .set(values)
        .where(eq(documents.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such document.");
      ctx.setSubject("document", updated.id);
      return updated;
    }
    const [created] = await ctx.tx
      .insert(documents)
      .values({
        ...values,
        createdByUserId: await actingUserId(ctx),
      })
      .returning();
    ctx.setSubject("document", created!.id);
    ctx.queueEvent("document.created", { documentId: created!.id });
    return created!;
  },
});

export const addVersion = defineService({
  name: "documents.addVersion",
  writeClass: "write",
  summary: "Add a revision. The previous one is kept, never overwritten.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    documentId: uuidSchema,
    assetId: uuidSchema,
    note: z.string().trim().max(2000).nullish(),
  }),
  output: versionRow,
  handler: async (input, ctx) => {
    const [document] = await ctx.tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId));
    if (!document) throw new ServiceError("not_found", "There is no such document.");

    const [asset] = await ctx.tx
      .select({ id: assets.id, status: assets.status, scanStatus: assets.scanStatus })
      .from(assets)
      .where(eq(assets.id, input.assetId));
    if (!asset) throw new ServiceError("not_found", "There is no such file.");
    // A quarantined or still-processing upload must not become the thing a
    // client downloads. The media console already knows this about an asset;
    // sending it to somebody is the moment it stops being reversible.
    if (asset.status !== "ready") {
      throw new ServiceError("conflict", "That file is not ready to be shared yet.");
    }
    if (asset.scanStatus === "infected") {
      throw new ServiceError("conflict", "That file failed its virus scan.");
    }

    // The number comes from the database, not the caller. Two uploads racing
    // would otherwise both compute "3" and one would win silently; here the
    // unique index refuses and the loser retries.
    const [last] = await ctx.tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
      .orderBy(desc(documentVersions.version))
      .limit(1);

    const [created] = await ctx.tx
      .insert(documentVersions)
      .values({
        documentId: document.id,
        version: (last?.version ?? 0) + 1,
        assetId: input.assetId,
        note: input.note ?? null,
        createdByUserId: await actingUserId(ctx),
      })
      .returning();

    await ctx.tx
      .update(documents)
      .set({ currentVersionId: created!.id })
      .where(eq(documents.id, document.id));

    if (document.contactId) {
      await ctx.emitTimeline({
        contactId: document.contactId,
        eventType: "document.revised",
        subjectType: "document",
        subjectId: document.id,
        payload: { version: created!.version, title: document.title },
      });
    }
    ctx.setSubject("document", document.id);
    ctx.queueEvent("document.revised", {
      documentId: document.id,
      versionId: created!.id,
      version: created!.version,
    });
    return created!;
  },
});

export const versions = defineService({
  name: "documents.versions",
  summary: "Every revision of a document, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ documentId: uuidSchema }),
  output: listed(versionRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, input.documentId))
      .orderBy(desc(documentVersions.version)),
});

export const listDocuments = defineService({
  name: "documents.list",
  summary: "Documents, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema.optional(),
    subjectType: z.string().trim().max(40).optional(),
    subjectId: uuidSchema.optional(),
    status: z.enum(["draft", "shared", "archived"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(documentRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(documents)
      .where(
        and(
          input.contactId ? eq(documents.contactId, input.contactId) : undefined,
          input.subjectType ? eq(documents.subjectType, input.subjectType) : undefined,
          input.subjectId ? eq(documents.subjectId, input.subjectId) : undefined,
          input.status ? eq(documents.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(input.limit),
  // C8.11: the customer this asks about may ask it themselves. The framework
  // checks the field is present and is their own contact before the handler
  // runs, so this widens what a customer can see about themselves and nothing
  // else.
  selfService: { contactField: "contactId" },
});

/* ------------------------------------------------------------- sharing */

export const share = defineService({
  name: "documents.share",
  writeClass: "write",
  summary: "Share a document, with a stated expiry and download policy.",
  kind: "mutation",
  permission: "scoped",
  input: z
    .object({
      documentId: uuidSchema,
      contactId: uuidSchema.nullish(),
      access: z.enum(DOCUMENT_ACCESS_MODES),
      password: z.string().min(6).max(200).optional(),
      /** Pin to one revision, or follow whatever is current. */
      pinnedVersionId: uuidSchema.nullish(),
      downloadPolicy: z.enum(DOCUMENT_DOWNLOAD_POLICIES).default("download"),
      downloadLimit: z.number().int().min(1).max(10_000).nullish(),
      expiresAt: z.date().nullish(),
    })
    .refine((value) => value.access !== "password" || Boolean(value.password), {
      message: "A password share needs a password.",
      path: ["password"],
    })
    .refine((value) => value.access !== "login" || Boolean(value.contactId), {
      message: "A login share needs the contact it is for.",
      path: ["contactId"],
    }),
  output: row({ shareId: uuidSchema, token: z.string().nullable() }),
  handler: async (input, ctx) => {
    const [document] = await ctx.tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId));
    if (!document) throw new ServiceError("not_found", "There is no such document.");
    if (!document.currentVersionId) {
      throw new ServiceError("conflict", "Add a file before sharing this document.");
    }
    if (isExpired(input.expiresAt ?? null)) {
      throw new ServiceError("validation", "That expiry is already in the past.");
    }

    // The token is returned once, here, and only its HMAC is stored. There is
    // no service that can read it back, which is the property that makes a
    // leaked database not a set of working share links.
    const token = input.access === "login" ? null : newShareToken();

    const [created] = await ctx.tx
      .insert(documentShares)
      .values({
        documentId: document.id,
        contactId: input.contactId ?? null,
        access: input.access,
        secretHash: input.password ? await hashPassword(input.password) : null,
        tokenHash: token ? hashShareToken(token) : null,
        pinnedVersionId: input.pinnedVersionId ?? null,
        downloadPolicy: input.downloadPolicy,
        downloadLimit: input.downloadLimit ?? null,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: await actingUserId(ctx),
      })
      .returning();

    if (document.status === "draft") {
      await ctx.tx
        .update(documents)
        .set({ status: "shared" })
        .where(eq(documents.id, document.id));
    }

    if (input.contactId) {
      await ctx.emitTimeline({
        contactId: input.contactId,
        eventType: "document.shared",
        subjectType: "document",
        subjectId: document.id,
        payload: { title: document.title, access: input.access },
      });
    }
    ctx.setSubject("document", document.id);
    ctx.queueEvent("document.shared", { documentId: document.id, shareId: created!.id });
    return { shareId: created!.id, token };
  },
});

export const revokeShare = defineService({
  name: "documents.revokeShare",
  writeClass: "write",
  summary: "Take a share back. The record that it existed stays.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ shareId: uuidSchema }),
  output: row({ shareId: uuidSchema, revokedAt: z.date() }),
  handler: async (input, ctx) => {
    const [revoked] = await ctx.tx
      .update(documentShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(documentShares.id, input.shareId), isNull(documentShares.revokedAt)))
      .returning();
    if (!revoked) throw new ServiceError("conflict", "That share is already revoked.");
    ctx.setSubject("document", revoked.documentId);
    ctx.queueEvent("document.shareRevoked", {
      documentId: revoked.documentId,
      shareId: revoked.id,
    });
    return { shareId: revoked.id, revokedAt: revoked.revokedAt! };
  },
});

export const shares = defineService({
  name: "documents.shares",
  summary: "How a document has been shared, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ documentId: uuidSchema }),
  output: listed(shareRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(documentShares)
      .where(eq(documentShares.documentId, input.documentId))
      .orderBy(desc(documentShares.createdAt)),
});

/* -------------------------------------------------------------- opening */

/**
 * Count what this share has already handed over.
 *
 * Downloads only. A limit is about copies leaving, and counting views against
 * it would mean a client who opened the page twice could no longer fetch the
 * file they were sent.
 */
async function downloadsSoFar(tx: Tx, shareId: string): Promise<number> {
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(documentAccessLogs)
    .where(
      and(
        eq(documentAccessLogs.shareId, shareId),
        eq(documentAccessLogs.action, "download"),
      ),
    );
  return counted?.n ?? 0;
}

/**
 * Deny, on the record.
 *
 * Returned as the successful outcome of the call rather than thrown, which is
 * the same decision `galleries.unlock` documents: throwing would roll the
 * denial back, and a guessed password would leave no trace. The row is the
 * feature; the refusal is just what the visitor sees.
 *
 * The visitor is told `{ ok: false }` and nothing else — an expired link, a
 * revoked one and a token that never existed are indistinguishable from
 * outside, and distinguishable in the history, which is the right way round.
 */
async function deny(
  tx: Tx,
  share_: { id: string; documentId: string; contactId: string | null } | null,
  reason: string,
): Promise<{ ok: false }> {
  if (share_) {
    await logAccess(tx, {
      documentId: share_.documentId,
      shareId: share_.id,
      contactId: share_.contactId,
      action: "denied",
      reason,
    });
  }
  return { ok: false };
}

export const openShare = defineService({
  name: "documents.open",
  writeClass: "write",
  summary: "Open a shared document by its link.",
  // A mutation because opening writes history. The access log is the point of
  // the feature, not a side effect of it.
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => `document-open:${hashShareToken(input.token)}`,
    message: "Too many tries. Wait a few minutes and try again.",
  },
  input: z.object({
    token: z.string().min(10).max(200),
    password: z.string().max(200).optional(),
    /** Whether the caller is fetching the file or just looking at the page. */
    action: z.enum(["view", "download"]).default("view"),
  }),
  output: z.union([
    row({
      ok: z.literal(true),
      documentId: uuidSchema,
      title: z.string(),
      version: z.number().int(),
      assetId: uuidSchema,
      filename: z.string(),
      mime: z.string(),
      downloadPolicy: z.enum(DOCUMENT_DOWNLOAD_POLICIES),
    }),
    z.object({ ok: z.literal(false) }),
  ]),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(documentShares)
      .where(eq(documentShares.tokenHash, hashShareToken(input.token)))
      .limit(1);
    // Nothing to log against, and an unknown token is as likely to be a typo
    // as an attack. The visitor sees what every other refusal shows.
    if (!found) return deny(ctx.tx, null, "unknown");

    if (found.revokedAt) return deny(ctx.tx, found, "revoked");
    if (isExpired(found.expiresAt)) return deny(ctx.tx, found, "expired");
    if (found.access === "password") {
      const ok = input.password
        ? await verifyPassword(input.password, found.secretHash!)
        : false;
      // The same outcome whichever of "no password" and "wrong password".
      if (!ok) return deny(ctx.tx, found, "secret");
    }
    if (input.action === "download" && found.downloadPolicy === "none") {
      return deny(ctx.tx, found, "policy");
    }
    if (
      input.action === "download" &&
      found.downloadLimit !== null &&
      (await downloadsSoFar(ctx.tx, found.id)) >= found.downloadLimit
    ) {
      return deny(ctx.tx, found, "limit");
    }

    const [document] = await ctx.tx
      .select()
      .from(documents)
      .where(eq(documents.id, found.documentId));
    if (!document) return deny(ctx.tx, found, "missing");

    // Pinned wins, and null means current. §4.5: guessing between them is how
    // somebody signs the wrong page.
    const versionId = found.pinnedVersionId ?? document.currentVersionId;
    if (!versionId) return deny(ctx.tx, found, "empty");

    const [version] = await ctx.tx
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        assetId: documentVersions.assetId,
        filename: assets.filename,
        mime: assets.mime,
      })
      .from(documentVersions)
      .innerJoin(assets, eq(assets.id, documentVersions.assetId))
      .where(eq(documentVersions.id, versionId));
    if (!version) return deny(ctx.tx, found, "empty");

    await logAccess(ctx.tx, {
      documentId: document.id,
      versionId: version.id,
      shareId: found.id,
      contactId: found.contactId,
      action: input.action,
    });

    if (found.contactId) {
      await ctx.emitTimeline({
        contactId: found.contactId,
        eventType: input.action === "download" ? "document.downloaded" : "document.viewed",
        subjectType: "document",
        subjectId: document.id,
        payload: { title: document.title, version: version.version },
      });
    }
    ctx.queueEvent("document.accessed", {
      documentId: document.id,
      shareId: found.id,
      action: input.action,
    });

    return {
      ok: true as const,
      documentId: document.id,
      title: document.title,
      version: version.version,
      assetId: version.assetId,
      filename: version.filename,
      mime: version.mime,
      downloadPolicy: found.downloadPolicy,
    };
  },
});

/* -------------------------------------------------------------- history */

export const accessHistory = defineService({
  name: "documents.history",
  summary: "Who opened this document, when, and what was refused (§4.5).",
  kind: "query",
  permission: "scoped",
  input: z.object({
    documentId: uuidSchema,
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: listed(
    row({
      id: uuidSchema,
      versionId: uuidSchema.nullable(),
      shareId: uuidSchema.nullable(),
      contactId: uuidSchema.nullable(),
      action: z.enum(DOCUMENT_ACCESS_ACTIONS),
      reason: z.string().nullable(),
      at: z.date(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: documentAccessLogs.id,
        versionId: documentAccessLogs.versionId,
        shareId: documentAccessLogs.shareId,
        contactId: documentAccessLogs.contactId,
        action: documentAccessLogs.action,
        reason: documentAccessLogs.reason,
        at: documentAccessLogs.at,
      })
      .from(documentAccessLogs)
      .where(eq(documentAccessLogs.documentId, input.documentId))
      .orderBy(desc(documentAccessLogs.at))
      .limit(input.limit),
});

/**
 * Everything about one document, in one object the owner can keep.
 *
 * §4.5: the owner can export a document's whole history, versions and access
 * alike, "because 'prove you sent it' is the reason this exists". An export
 * that omitted the denials would be the flattering half of the story.
 */
export const exportDocument = defineService({
  name: "documents.export",
  summary: "A document, its versions and its whole access history.",
  kind: "query",
  permission: "scoped",
  input: z.object({ documentId: uuidSchema }),
  output: row({
    document: documentRow,
    versions: z.array(versionRow),
    shares: z.array(shareRow),
    access: z.array(
      row({
        action: z.enum(DOCUMENT_ACCESS_ACTIONS),
        reason: z.string().nullable(),
        contactId: uuidSchema.nullable(),
        at: z.date(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const [document] = await ctx.tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId));
    if (!document) throw new ServiceError("not_found", "There is no such document.");

    return {
      document,
      versions: await ctx.tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, document.id))
        .orderBy(asc(documentVersions.version)),
      shares: await ctx.tx
        .select()
        .from(documentShares)
        .where(eq(documentShares.documentId, document.id))
        .orderBy(asc(documentShares.createdAt)),
      access: await ctx.tx
        .select({
          action: documentAccessLogs.action,
          reason: documentAccessLogs.reason,
          contactId: documentAccessLogs.contactId,
          at: documentAccessLogs.at,
        })
        .from(documentAccessLogs)
        .where(eq(documentAccessLogs.documentId, document.id))
        .orderBy(asc(documentAccessLogs.at)),
    };
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "documents",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(documents)
      .set({ contactId: survivingId })
      .where(eq(documents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(documents)
        .set({ contactId: duplicateId })
        .where(eq(documents.id, each.id));
    }
  },
});

registerContactReference({
  table: "document_shares",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(documentShares)
      .set({ contactId: survivingId })
      .where(eq(documentShares.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: documentShares.id })
      .from(documentShares)
      .where(eq(documentShares.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(documentShares)
        .set({ contactId: duplicateId })
        .where(eq(documentShares.id, each.id));
    }
  },
});

registerContactReference({
  table: "document_access_logs",
  // Repointed, never deleted. §4.5: "a document history that vanishes the
  // first time two duplicates are merged is not an audit."
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(documentAccessLogs)
      .set({ contactId: survivingId })
      .where(eq(documentAccessLogs.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: documentAccessLogs.id })
      .from(documentAccessLogs)
      .where(eq(documentAccessLogs.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(documentAccessLogs)
        .set({ contactId: duplicateId })
        .where(eq(documentAccessLogs.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.documents",
  tables: ["documents", "document_shares", "document_access_logs"],
  exportData: async (tx, contactId) => ({
    documents: await tx.select().from(documents).where(eq(documents.contactId, contactId)),
    shares: await tx
      .select()
      .from(documentShares)
      .where(eq(documentShares.contactId, contactId)),
    access: await tx
      .select()
      .from(documentAccessLogs)
      .where(eq(documentAccessLogs.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The share is revoked and unlinked rather than deleted: whether a link
    // was live on a given date is the business's own record, and the person it
    // pointed at is what belongs to the person.
    const unshared = await tx
      .update(documentShares)
      .set({ contactId: null, revokedAt: new Date(), secretHash: null, tokenHash: null })
      .where(eq(documentShares.contactId, contactId))
      .returning({ id: documentShares.id });
    // The access row survives with its person removed, exactly as an
    // attribution touch does: that a document was opened on the 4th is the
    // business's record; that it was opened by this named person is not.
    const seen = await tx
      .update(documentAccessLogs)
      .set({ contactId: null })
      .where(eq(documentAccessLogs.contactId, contactId))
      .returning({ id: documentAccessLogs.id });
    // The documents themselves are unlinked, not dropped. A signed contract is
    // the business's record of an agreement it was party to.
    const owned = await tx
      .update(documents)
      .set({ contactId: null })
      .where(eq(documents.contactId, contactId))
      .returning({ id: documents.id });
    return { affected: unshared.length + seen.length + owned.length };
  },
});

export default [
  saveDocument,
  addVersion,
  versions,
  listDocuments,
  share,
  revokeShare,
  shares,
  openShare,
  accessHistory,
  exportDocument,
];
