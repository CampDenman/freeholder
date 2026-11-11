// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.22: staged reader comments are personal data, not a second CRM.
import { and, asc, eq, gt, gte, inArray } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { importRuns } from "@/core/plugins/schema";
import { dataRequests } from "@/core/privacy/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { contactPrivacyIdentity } from "@/core/privacy/contact-identity";
import { ServiceError, type Tx } from "@/core/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { z } from "zod";

type Run = typeof importRuns.$inferSelect;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const items = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const email = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
const sourceKey = (page: Json): string => typeof page.wpId === "string" ? page.wpId : typeof page.slug === "string" ? page.slug : "";

/** Only source reader copies: article text, other readers and ownership stay. */
export function stripReaderCopies(preview: unknown): Json {
  const copy = structuredClone(object(preview));
  for (const page of items(copy.pages)) delete page.readerComments;
  return copy;
}

/** Bind existing readers without creating CRM contacts just to preview a file. */
export async function bindReaderSources(tx: Tx, preview: unknown): Promise<Json> {
  const copy = structuredClone(object(preview));
  const readers = items(copy.pages).flatMap(page => items(page.readerComments));
  const addresses = [...new Set(readers.map(comment => email(comment.email)).filter(Boolean))];
  const known = addresses.length ? await tx.select({ id: contacts.id, email: contacts.email }).from(contacts)
    .where(inArray(contacts.email, addresses)).for("key share") : [];
  const byEmail = new Map(known.map(contact => [email(contact.email), contact.id]));
  for (const comment of readers) {
    delete comment.contactId;
    const id = byEmail.get(email(comment.email));
    if (id) comment.contactId = id;
  }
  return copy;
}

/** Opaque chunks cannot be matched to a contact until parsing has completed. */
export async function assertReaderUploadWindow(tx: Tx, preview: unknown, startedAt: Date): Promise<void> {
  if (!items(object(preview).pages).some(page => items(page.readerComments).length > 0)) return;
  const [erasure] = await tx.select({ id: dataRequests.id }).from(dataRequests).where(and(
    eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["completed", "partially_completed"]),
    gte(dataRequests.fulfilledAt, startedAt),
  )).limit(1);
  if (erasure) throw new ServiceError("conflict", "A reader erasure completed while this source upload was pending. Review the source for erased readers and upload a fresh file before importing comments.");
}

/** Old checkpoints cannot prove whether a previously erased reader was cached. */
export async function assertLegacyReaderSafety(tx: Tx, run: Run): Promise<void> {
  const preview = object(run.preview), checkpoint = object(run.checkpoint);
  if (checkpoint.readerPrivacyReviewRequired === true) {
    throw new ServiceError("conflict", "This older import needs reader-erasure review. Roll it back, review the source for erased readers, and start a new import before publishing comments.");
  }
  const hasPreview = items(preview.pages).some(page => items(page.readerComments).length > 0);
  const hasPending = items(checkpoint.pendingBlogPosts).some(post => items(post.comments).length > 0);
  if ((!hasPreview || preview.readerPrivacyVersion === 1) && (!hasPending || checkpoint.readerPrivacyVersion === 1)) return;
  const [erasure] = await tx.select({ id: dataRequests.id }).from(dataRequests).where(and(
    eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["completed", "partially_completed"]),
    gte(dataRequests.fulfilledAt, run.createdAt),
  )).limit(1);
  if (erasure) throw new ServiceError("conflict", "This older import predates reader-erasure protection. Roll it back, review the source for erased readers, and start a new import before publishing comments.");
}

async function subject(tx: Tx, contactId: string) {
  const identity = await contactPrivacyIdentity(tx, contactId);
  const emails = new Set(identity.emails), seen = new Set(identity.contactIds);
  const comments = await tx.select({ source: blogReaderComments.source, externalId: blogReaderComments.externalId })
    .from(blogReaderComments).where(eq(blogReaderComments.contactId, contactId));
  const references = new Set(comments.filter(comment => comment.externalId).map(comment => `${comment.source}:${comment.externalId}`));
  return (runId: string, key: string, comment: Json) => typeof comment.contactId === "string"
    ? seen.has(comment.contactId)
    : emails.has(email(comment.email)) || references.has(`import:${runId}:${key}:${String(comment.id)}`);
}

type SourceEntry = { runId: string; stage: "preview" | "pending"; key: string; comment: Json };
function sourceEntries(run: Run): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const page of items(object(run.preview).pages)) {
    const key = sourceKey(page);
    for (const comment of items(page.readerComments)) entries.push({ runId: run.id, stage: "preview", key, comment });
  }
  for (const post of items(object(run.checkpoint).pendingBlogPosts)) {
    for (const comment of items(post.comments)) entries.push({ runId: run.id, stage: "pending", key: String(post.key), comment });
  }
  return entries;
}

/** Import scopes may see their supplied source, not probe existing CRM IDs. */
export function publicImportRun(run: Run): Run {
  const project = (value: unknown, collection: string, readers: string): unknown => {
    const source = object(value);
    if (!Array.isArray(source[collection])) return value;
    return { ...source, [collection]: source[collection].map((row: unknown) => {
      const entry = object(row);
      if (!Array.isArray(entry[readers])) return row;
      return { ...entry, [readers]: entry[readers].map((comment: unknown) => {
        if (!Object.hasOwn(object(comment), "contactId")) return comment;
        const copy = { ...object(comment) }; delete copy.contactId; return copy;
      }) };
    }) };
  };
  // Copy only changed reader objects; do not clone every multi-megabyte body
  // again while projecting a list of otherwise unchanged import runs.
  return { ...run, preview: project(run.preview, "pages", "readerComments"), checkpoint: project(run.checkpoint, "pendingBlogPosts", "comments") };
}

// One bounded row at a time: an owner may retain many 20 MB source previews.
async function* runs(tx: Tx, lock: boolean, noWait = false) {
  let after: string | undefined;
  while (true) {
    const query = tx.select().from(importRuns).where(after ? gt(importRuns.id, after) : undefined).orderBy(asc(importRuns.id)).limit(1);
    let run: Run | undefined;
    try { [run] = await (lock ? query.for("update", noWait ? { noWait: true } : undefined) : query); }
    catch (error) {
      for (let cause: unknown = error, depth = 0; cause && depth < 5; depth += 1) {
        const nested = cause as { code?: unknown; cause?: unknown };
        if (nested.code === "55P03") throw new ServiceError("conflict", "An import is changing its reader sources. Wait for that operation to finish, then retry the contact merge.");
        cause = nested.cause;
      }
      throw error;
    }
    if (!run) return;
    after = run.id;
    yield run;
  }
}

const readerPointer = z.object({ runId: z.uuid(), stage: z.enum(["preview", "pending"]), key: z.string(), commentId: z.string(), contactId: z.uuid() });
type ReaderPointer = z.infer<typeof readerPointer>;
async function readerPointers(tx: Tx, contactIds: string[]): Promise<ReaderPointer[]> {
  const result: ReaderPointer[] = [];
  // Merge already holds contact rows. Do not wait for a publisher holding its
  // import row while its comment's FK waits for those same contacts.
  for await (const run of runs(tx, true, true)) for (const entry of sourceEntries(run)) {
    if (typeof entry.comment.contactId === "string" && contactIds.includes(entry.comment.contactId)) {
      result.push({ runId: run.id, stage: entry.stage, key: entry.key, commentId: String(entry.comment.id), contactId: entry.comment.contactId });
    }
  }
  return result;
}
async function rewriteReaderPointers(tx: Tx, transform: (entry: SourceEntry) => string | undefined) {
  for await (const run of runs(tx, true, true)) {
    const copy = { ...run, preview: structuredClone(run.preview), checkpoint: structuredClone(run.checkpoint) };
    let changed = false;
    for (const entry of sourceEntries(copy)) {
      const id = transform(entry);
      if (id && id !== entry.comment.contactId) { entry.comment.contactId = id; changed = true; }
    }
    if (changed) await tx.update(importRuns).set({ preview: copy.preview, checkpoint: copy.checkpoint }).where(eq(importRuns.id, run.id));
  }
}
registerContactReference({
  // These are JSON pointers, not physical contact_id columns. Native merge
  // and conflict-checked undo controls verify the declared JSON ownership.
  table: "import_runs", columns: [],
  repoint: (tx, duplicateId, survivingId) => rewriteReaderPointers(tx, entry => entry.comment.contactId === duplicateId ? survivingId : undefined),
  captureForUndo: async (tx, duplicateId, survivingId) => ({ state: await readerPointers(tx, [duplicateId, survivingId]), undoable: true }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId, survivingId) => {
    const before = readerPointer.array().parse(beforeState), after = readerPointer.array().parse(afterState);
    if (JSON.stringify(await readerPointers(tx, [duplicateId, survivingId])) !== JSON.stringify(after)) {
      throw new ServiceError("conflict", "Imported reader sources changed after the contact merge.");
    }
    const key = (pointer: Omit<ReaderPointer, "contactId">) => JSON.stringify([pointer.runId, pointer.stage, pointer.key, pointer.commentId]);
    const previous = new Set(before.filter(pointer => pointer.contactId === duplicateId).map(key));
    await rewriteReaderPointers(tx, entry => previous.has(key({ ...entry, commentId: String(entry.comment.id) })) ? duplicateId : undefined);
  },
});

registerContactPrivacySource({
  scope: "imports.readerSources", tables: ["import_runs"], retentionScopes: ["cms.readerComments"], eraseOrder: 10,
  exportData: async (tx, contactId) => {
    const matches = await subject(tx, contactId), result: SourceEntry[] = [];
    for await (const run of runs(tx, false)) result.push(...sourceEntries(run).filter(entry => matches(run.id, entry.key, entry.comment)));
    return result;
  },
  erase: async (tx, contactId) => {
    const matches = await subject(tx, contactId);
    let affected = 0;
    // Publish/commit lock the same run before reading pending comments. Either
    // erasure removes their input, or it deletes their committed comment later
    // in this same privacy transaction; an old snapshot cannot recreate it.
    for await (const run of runs(tx, true)) {
      const preview = structuredClone(object(run.preview)), checkpoint = structuredClone(object(run.checkpoint));
      let removed = 0;
      for (const page of items(preview.pages)) {
        if (!Array.isArray(page.readerComments)) continue;
        page.readerComments = items(page.readerComments).filter(comment => {
          if (!matches(run.id, sourceKey(page), comment)) return true;
          removed += 1; return false;
        });
      }
      for (const post of items(checkpoint.pendingBlogPosts)) {
        if (!Array.isArray(post.comments)) continue;
        post.comments = items(post.comments).filter(comment => {
          if (!matches(run.id, String(post.key), comment)) return true;
          removed += 1; return false;
        });
      }
      if (removed) {
        await tx.update(importRuns).set({ preview, checkpoint }).where(eq(importRuns.id, run.id));
        affected += removed;
      }
    }
    return { affected };
  },
});
