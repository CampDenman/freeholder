// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, getService, ServiceError } from "@/core/service";
import { resolveContact, registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { auditLog } from "@/core/events/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contactPrivacyIdentity } from "@/core/privacy/contact-identity";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { pages } from "./schema";
import { blogPosts } from "./blog-schema";
import { blogReaderComments as comments } from "./blog-comments-schema";
import { isPublicPage, loadBlogSettings } from "./blog-service";
import { markReaderOwnershipWriter } from "@/core/import/reader-ownership-key";
import { acceptReaderOwnership, assertOriginalReaderPayload, readerOwnershipForComment } from "@/core/import/reader-ownership";
import { importRuns } from "@/core/plugins/schema";
import { dataRequests } from "@/core/privacy/schema";
import { withoutPrivacyHold } from "@/core/retention/holds";

const state = z.enum(["pending", "approved", "spam", "trash"]);
const privateRow = row({ id: uuid, pageId: uuid, parentId: uuid.nullable(), contactId: uuid.nullable(), authorName: z.string(), body: z.string(), status: state, source: z.string(), externalId: z.string().nullable(), createdAt: timestamp, updatedAt: timestamp });
const publicRow = z.object({ id: uuid, parentId: uuid.nullable(), authorName: z.string(), body: z.string(), createdAt: timestamp });

registerContactReference({
  table: "blog_reader_comments",
  repoint: async (tx, duplicateId, survivingId) => { await markReaderOwnershipWriter(tx); return tx.update(comments).set({ contactId: survivingId }).where(eq(comments.contactId, duplicateId)); },
  captureForUndo: async (tx, duplicateId, survivingId) => ({ state: await tx.select({ id: comments.id, contactId: comments.contactId }).from(comments).where(inArray(comments.contactId, [duplicateId, survivingId])).orderBy(asc(comments.id)), undoable: true }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    await markReaderOwnershipWriter(tx);
    const pointers = z.array(z.object({ id: uuid, contactId: uuid.nullable() }));
    const before = pointers.parse(beforeState), after = pointers.parse(afterState);
    const current = after.length ? await tx.select({ id: comments.id, contactId: comments.contactId }).from(comments).where(inArray(comments.id, after.map(one => one.id))).orderBy(asc(comments.id)) : [];
    if (JSON.stringify(current) !== JSON.stringify(after)) throw new ServiceError("conflict", "Reader comments changed after the contact merge.");
    const ids = before.filter(one => one.contactId === duplicateId).map(one => one.id);
    if (ids.length) await tx.update(comments).set({ contactId: duplicateId }).where(inArray(comments.id, ids));
  },
});
registerContactPrivacySource({
  scope: "cms.readerComments", tables: ["blog_reader_comments"], eraseOrder: 20,
  exportData: (tx, contactId) => tx.select().from(comments).where(eq(comments.contactId, contactId)),
  erase: async (tx, contactId) => {
    await markReaderOwnershipWriter(tx);
    const identity = await contactPrivacyIdentity(tx, contactId);
    const owned = await tx.select({ id: comments.id }).from(comments).where(inArray(comments.contactId, identity.contactIds));
    await tx.update(auditLog).set({ diff: sql`${auditLog.diff} - 'name' - 'email' - 'body' - 'website' - 'sourceContactId'` }).where(and(
      inArray(auditLog.action, ["cms.submitReaderComment", "cms.importReaderComment"]),
      or(owned.length ? and(eq(auditLog.subjectType, "blog_comment"), inArray(auditLog.subjectId, owned.map(row => row.id))) : sql`false`,
        identity.emails.length ? inArray(sql<string>`lower(${auditLog.diff}->>'email')`, identity.emails) : sql`false`),
    ));
    return { affected: (await tx.delete(comments).where(inArray(comments.contactId, identity.contactIds)).returning({ id: comments.id })).length };
  },
});

export const listReaderComments = defineService({
  name: "cms.listReaderComments", summary: "Approved public reader comments on a published blog post; private contact details are never returned.",
  kind: "query", permission: "public", input: z.object({ pageId: uuid, limit: z.number().int().min(1).max(100).default(100), page: z.number().int().min(1).max(10000).default(1) }), output: listed(publicRow),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx.select({ id: pages.id, slug: pages.slug }).from(pages).innerJoin(blogPosts, eq(blogPosts.pageId, pages.id)).where(and(eq(pages.id, input.pageId), eq(pages.status, "published"), isNull(pages.trashedAt))).limit(1);
    if (!page || !await isPublicPage(ctx, page)) return [];
    // A legal hold keeps evidence private; it does not authorize continued
    // publication after an erasure has started or been acknowledged.
    return ctx.tx.select({ id: comments.id, parentId: comments.parentId, authorName: comments.authorName, body: comments.body, createdAt: comments.createdAt }).from(comments).where(and(eq(comments.pageId, page.id), eq(comments.status, "approved"), sql`not exists (
      select 1 from ${dataRequests} where ${dataRequests.contactId}=${comments.contactId}
        and ${dataRequests.kind}='erasure' and ${dataRequests.status} in ('in_progress','completed','partially_completed')
    )`, sql`not exists(select 1 from ${contacts} where ${contacts.id}=${comments.contactId} and ${contacts.source}='privacy-erasure')`)).orderBy(asc(comments.createdAt), asc(comments.id)).limit(input.limit).offset((input.page - 1) * input.limit);
  },
});

export const submitReaderComment = defineService({
  auditInputFields: ["pageId", "parentId"],
  name: "cms.submitReaderComment", summary: "Submit a reader comment for moderation; this never publishes immediately or subscribes the contact to marketing.",
  kind: "mutation", permission: "public", writeClass: "message",
  input: z.object({ pageId: uuid, parentId: uuid.nullable().optional(), name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().max(320), body: z.string().trim().min(1).max(10000), website: z.string().max(200).default("") }),
  rateLimit: { limit: 5, windowSeconds: 3600, subject: input => createHash("sha256").update(input.email+":"+input.pageId).digest("hex"), message: "Please wait before submitting another comment." },
  output: z.object({ ok: z.literal(true), id: uuid }),
  handler: async (input, ctx) => {
    if (input.website) return { ok: true as const, id: randomUUID() };
    await lockContactIdentityForRead(ctx.tx);
    const settings = await loadBlogSettings(ctx.tx);
    const [post] = await ctx.tx.select({ id: pages.id, slug: pages.slug, title: pages.title, enabled: blogPosts.commentsEnabled }).from(pages).innerJoin(blogPosts, eq(blogPosts.pageId, pages.id)).where(and(eq(pages.id, input.pageId), eq(pages.status, "published"), isNull(pages.trashedAt))).limit(1);
    if (!post || !settings.commentsEnabled || !post.enabled || !await isPublicPage(ctx, post)) throw new ServiceError("validation", "Comments are closed on this post.");
    if (input.parentId) {
      const [parent] = await ctx.tx.select({ id: comments.id }).from(comments).where(and(eq(comments.id, input.parentId), eq(comments.pageId, post.id), eq(comments.status, "approved"))).limit(1);
      if (!parent) throw new ServiceError("validation", "That comment cannot be replied to.");
    }
    const resolved = await ctx.callAsSystem(resolveContact, { name: input.name, email: input.email, source: "blog-comment" });
    const [saved] = await ctx.tx.insert(comments).values({ pageId: post.id, parentId: input.parentId ?? null, contactId: resolved.contact.id, authorName: input.name, body: input.body }).returning({ id: comments.id });
    ctx.setSubject("blog_comment", saved!.id);
    ctx.queueEvent("cms.readerCommentSubmitted", { pageId: post.id, commentId: saved!.id, contactId: resolved.contact.id });
    const owners = await ctx.tx.select({ id: users.id }).from(users).where(eq(users.role, "owner"));
    for (const owner of owners) await ctx.callAsSystem(getService("notifications.create"), { recipient: { kind: "user", id: owner.id }, topic: "cms.comment_pending", titleKey: "blog.commentNotificationTitle", bodyKey: "blog.commentNotificationBody", messageParams: { title: post.title }, href: "/admin/blog/comments", idempotencyKey: `reader-comment:${saved!.id}:${owner.id}` });
    return { ok: true as const, id: saved!.id };
  },
});

export const moderateReaderComment = defineService({
  name: "cms.moderateReaderComment", summary: "Approve, hold, mark spam or trash a reader comment, keeping the moderation record.",
  kind: "mutation", permission: "scoped", writeClass: "message", input: z.object({ id: uuid, status: state }), output: privateRow,
  handler: async (input, ctx) => {
    await markReaderOwnershipWriter(ctx.tx);
    const [saved] = await ctx.tx.update(comments).set({ status: input.status, updatedAt: new Date() }).where(eq(comments.id, input.id)).returning();
    if (!saved) throw new ServiceError("not_found", "That comment is gone.");
    ctx.setSubject("blog_comment", saved.id); ctx.queueEvent("cms.readerCommentModerated", { commentId: saved.id, pageId: saved.pageId, status: saved.status }); return saved;
  },
});
export const listReaderCommentsForOwner = defineService({
  name: "cms.readerCommentsForOwner", summary: "Moderation queue for public blog comments, including held, spam and trashed records.",
  kind: "query", permission: "scoped", input: z.object({ status: state.optional(), limit: z.number().int().min(1).max(200).default(100), page: z.number().int().min(1).max(10000).default(1) }), output: listed(privateRow),
  handler: (input, ctx) => ctx.tx.select().from(comments).where(input.status ? eq(comments.status, input.status) : undefined).orderBy(desc(comments.createdAt), desc(comments.id)).limit(input.limit).offset((input.page - 1) * input.limit),
});

export const importReaderComment = defineService({
  auditInputFields: ["runId", "externalId", "pageId", "parentId", "status", "createdAt"],
  name: "cms.importReaderComment", summary: "Import one WordPress reader comment idempotently, preserving its date and moderation state.",
  kind: "mutation", permission: "scoped", writeClass: "message",
  input: z.object({ runId: uuid, externalId: z.string().min(1).max(200), pageId: uuid, parentId: uuid.nullable().optional(), name: z.string().min(1).max(200), email: z.string().email().nullable(), sourceContactId: uuid.optional(), body: z.string().min(1).max(10000), status: state, createdAt: z.iso.datetime({ offset: true }).optional() }), output: privateRow,
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    await markReaderOwnershipWriter(ctx.tx);
    const source = `import:${input.runId}`;
    const [prior] = await ctx.tx.select().from(comments).where(and(eq(comments.source, source), eq(comments.externalId, input.externalId))).limit(1);
    if (prior) return prior;
    const [original] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.runId)).limit(1);
    const separator = input.externalId.lastIndexOf(":"), postKey = input.externalId.slice(0, separator), commentKey = input.externalId.slice(separator + 1);
    if (!original || separator < 1 || !commentKey) throw new ServiceError("conflict", "Stage the original reader source before importing this comment.");
    assertOriginalReaderPayload(original, postKey, commentKey, input);
    const ownership = await readerOwnershipForComment(ctx.tx, original, postKey, commentKey);
    if (input.sourceContactId && ownership.contactId !== input.sourceContactId) throw new ServiceError("conflict", "This comment's supplied identity differs from its original reader owner.");
    const boundId = ownership.contactId;
    const bound = boundId ? (await ctx.tx.select({ id: contacts.id, source: contacts.source }).from(contacts).where(eq(contacts.id, boundId)).limit(1))[0] : undefined;
    if (bound?.source === "privacy-erasure") throw new ServiceError("conflict", "That reader was erased. Review the original source before importing comments.");
    if (input.sourceContactId && !bound) throw new ServiceError("conflict", "The imported reader's contact changed. Review the source before importing this comment.");
    const resolved = !bound && input.email ? await ctx.callAsSystem(resolveContact, { name: input.name, email: input.email, source: "wordpress-comment" }) : null;
    if (input.parentId) {
      const [parent] = await ctx.tx.select({ id: comments.id }).from(comments).where(and(eq(comments.id, input.parentId), eq(comments.pageId, input.pageId))).limit(1);
      if (!parent) throw new ServiceError("validation", "The imported parent comment belongs to another post.");
    }
    const [saved] = await ctx.tx.insert(comments).values({ source, externalId: input.externalId, pageId: input.pageId, parentId: input.parentId ?? null, authorName: input.name, body: input.body, status: input.status, contactId: bound?.id ?? resolved?.contact.id ?? null, ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}) }).returning();
    await acceptReaderOwnership(ctx.tx, original, postKey, commentKey, saved!.contactId);
    ctx.setSubject("blog_comment", saved!.id); return saved!;
  },
});
export const rollbackImportedReaderComments = defineService({
  name: "cms.rollbackImportedReaderComments", summary: "Remove only the reader comments created by one rolled-back import; unified contacts are retained.",
  kind: "mutation", permission: "scoped", writeClass: "destructive", input: z.object({ runId: uuid }), output: z.object({ removed: z.number().int() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    await markReaderOwnershipWriter(ctx.tx);
    return { removed: (await ctx.tx.delete(comments).where(and(eq(comments.source, `import:${input.runId}`), withoutPrivacyHold(comments.contactId, "cms.readerComments"))).returning({ id: comments.id })).length };
  },
});
export default [listReaderComments, submitReaderComment, moderateReaderComment, listReaderCommentsForOwner, importReaderComment, rollbackImportedReaderComments];
