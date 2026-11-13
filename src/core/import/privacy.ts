// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.22: staged reader comments are personal data, not a second CRM.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, like, or, sql } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { mediaObjects } from "@/core/media/schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { importSourceObjectKeys, retainedSourceFromRun, retainedSourceChunkKey } from "./retained-source";
import { captureOriginalSourceErasureScope } from "./source-erasure-scope";
import { IMPORT_SOURCE_ERASURE_JOB } from "./source-erasure";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { registerContactReference } from "@/core/contacts/service";
import { importRuns } from "@/core/plugins/schema";
import { dataRequests } from "@/core/privacy/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { completeRetentionSourceSnapshot, retentionSourceMemberIsHeld, retentionSourceSnapshotIsComplete } from "@/core/privacy/retention-snapshots";
import { contactPrivacyIdentity } from "@/core/privacy/contact-identity";
import { ServiceError, type Actor, type ServiceContext, type Tx } from "@/core/service";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { z } from "zod";
import { assertImportBatchAccess } from "./batch-context";
import { invalidateImportGraph } from "./graph-state";
import { markGraphRunWriter } from "./graph-writer";
import { markImportCrawlWriter } from "./crawl-writer";
import { collectAdditionalImportOriginals } from "./source-retention";
import { bindOwnedReaderSources, canonicalReaderSite, type ReaderSourceContext } from "./reader-ownership";
import { markReaderOwnershipWriter } from "./reader-ownership-key";

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
export async function bindReaderSources(tx: Tx, preview: unknown, source: ReaderSourceContext, actor: Actor): Promise<Json> {
  await lockContactIdentityForRead(tx);
  await markReaderOwnershipWriter(tx);
  const copy = structuredClone(object(preview));
  const hasReaders = items(copy.pages).some(page => items(page.readerComments).length > 0);
  if (hasReaders) copy.readerSourceSite = canonicalReaderSite({ kind: source.kind, origin: source.origin, preview: copy });
  return bindOwnedReaderSources(tx, copy, { ...source, ...(hasReaders ? { site: String(copy.readerSourceSite) } : {}) }, actor);
}

export class ReaderSourceErasureError extends ServiceError {
  constructor() { super("conflict", "A reader erasure started while this source upload was pending. Review the source for erased readers and upload a fresh file before importing comments."); }
}

/** Opaque chunks cannot be matched to a contact until parsing has completed. */
export async function assertReaderUploadWindow(tx: Tx, preview: unknown, startedAt: Date): Promise<void> {
  if (!items(object(preview).pages).some(page => items(page.readerComments).length > 0)) return;
  const [erasure] = await tx.select({ id: dataRequests.id }).from(dataRequests).where(and(
    eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["completed", "partially_completed", "in_progress"]),
    or(gte(dataRequests.fulfilledAt, startedAt), and(eq(dataRequests.status, "in_progress"), gte(dataRequests.updatedAt, startedAt))),
  )).limit(1);
  if (erasure) throw new ReaderSourceErasureError();
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

async function subject(tx: Tx, contactId: string, includeUnboundAddresses = true) {
  const identity = await contactPrivacyIdentity(tx, contactId);
  const emails = new Set(identity.emails), seen = new Set(identity.contactIds);
  const comments = await tx.select({ source: blogReaderComments.source, externalId: blogReaderComments.externalId })
    .from(blogReaderComments).where(eq(blogReaderComments.contactId, contactId));
  const references = new Set(comments.filter(comment => comment.externalId).map(comment => `${comment.source}:${comment.externalId}`));
  return (runId: string, key: string, comment: Json) => typeof comment.contactId === "string"
    ? seen.has(comment.contactId)
    : includeUnboundAddresses && emails.has(email(comment.email)) || references.has(`import:${runId}:${key}:${String(comment.id)}`);
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
  assertImportBatchAccess(run);
  const project = (value: unknown, collection: string, readers: string): unknown => {
    const source = object(value);
    if (!Array.isArray(source[collection])) return value;
    return { ...source, [collection]: source[collection].map((row: unknown) => {
      const entry = object(row);
      if (!Array.isArray(entry[readers])) return row;
      return { ...entry, [readers]: entry[readers].map((comment: unknown) => {
        if (!Object.hasOwn(object(comment), "contactId") && !Object.hasOwn(object(comment), "readerOwnershipReviewRequired")) return comment;
        const copy = { ...object(comment) }; delete copy.contactId; delete copy.readerOwnershipReviewRequired; return copy;
      }) };
    }) };
  };
  // Copy only changed reader objects; do not clone every multi-megabyte body
  // again while projecting a list of otherwise unchanged import runs.
  let checkpoint = project(run.checkpoint, "pendingBlogPosts", "comments");
  const privateFields = ["sourcePrivacyHolds", "sourceWrites", "mediaClaims", "sourceGraphRebind"] as const;
  if (privateFields.some(field => Object.hasOwn(object(checkpoint), field))) {
    const visible = { ...object(checkpoint) };
    for (const field of privateFields) delete visible[field];
    checkpoint = visible;
  }
  if (Object.hasOwn(object(object(checkpoint).sourceUpload), "uploaderIdentity")) {
    const upload = { ...object(object(checkpoint).sourceUpload) };
    delete upload.uploaderIdentity;
    checkpoint = { ...object(checkpoint), sourceUpload: upload };
  }
  return { ...run, preview: project(run.preview, "pages", "readerComments"), checkpoint };
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
    if (lock) {
      await markGraphRunWriter(tx, run);
      if (object(run.checkpoint).sourceCrawl) await markImportCrawlWriter(tx);
    }
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

async function ownedSourceKeys(tx: Tx, run: Run): Promise<string[]> {
  const checkpoint = object(run.checkpoint);
  const objects = await tx.select({ key: mediaObjects.key }).from(mediaObjects).where(like(mediaObjects.key, `imports/${run.id}/%`));
  const reserved = z.object({ uploadId: z.uuid(), chunks: z.number().int().positive().max(25) }).safeParse(checkpoint.sourceUpload);
  const retained = retainedSourceFromRun(run);
  return [...new Set([...importSourceObjectKeys(run), ...objects.map(item => item.key), ...(reserved.success ? Array.from({ length: reserved.data.chunks }, (_, index) => `imports/${run.id}/${reserved.data.uploadId}/${String(index).padStart(5, "0")}.part`) : []), ...(retained ? retained.chunkDigests.map((_, index) => retainedSourceChunkKey(retained, index)) : [])])];
}
const sourceHold = z.object({ exceptionId: z.uuid(), requestId: z.uuid(), uploadId: z.uuid() });

/** A retained raw-source family can still contain later unheld originals.
 * Actual canonical membership across every live hold is the only exclusion;
 * no current mailbox or executor establishes who owns opaque file contents.
 * Unknown original holds remain protected by the shared physical boundary and
 * keep the actual job pending for review rather than claiming byte deletion.
 */
async function eraseUnheldOriginals(tx: Tx, context: { requestId: string; service: ServiceContext }): Promise<{ affected: number; pendingJobs: string[] }> {
  if (context.service.tx !== tx) throw new ServiceError("internal", "Original source cleanup requires the actual privacy transaction.");
  await captureOriginalSourceErasureScope(context.service,context.requestId);
  const pendingJobs: string[] = [];
  for await (const run of runs(tx, true)) {
    const unheld: string[] = [], generations = new Map<string, boolean>();
    for (const key of await ownedSourceKeys(tx, run)) {
      const uploadId = z.uuid().parse(key.split("/")[2]);
      let held = generations.get(uploadId);
      if (held === undefined) {
        held = await retentionSourceMemberIsHeld(tx, "imports.readerSources", run.id, uploadId, ["imports.readerSources", "cms.readerComments"]);
        generations.set(uploadId, held);
      }
      if (!held) unheld.push(key);
    }
    if (unheld.length && object(run.checkpoint).sourceGraph && !["committed", "reconciled", "published"].includes(run.status)) await invalidateImportGraph(tx, run);
    for (let offset = 0; offset < unheld.length; offset += 25) {
      const originalJobId = randomUUID();
      const queued = await context.service.queueJob(IMPORT_SOURCE_ERASURE_JOB, { requestId: context.requestId, originalJobId, keys: unheld.slice(offset, offset + 25) }, { id: originalJobId });
      pendingJobs.push(queued.id);
    }
  }
  return { affected: 0, pendingJobs };
}

registerContactPrivacySource({
  scope: "imports.readerSources", tables: ["import_runs", "import_source_erasure_scopes", "import_source_erasure_members", "import_source_erasure_objects"], retentionScopes: ["cms.readerComments"], eraseOrder: 10,
  captureRetention: async (tx, _contactId, context) => {
    if (!context.isNew) {
      if (!await retentionSourceSnapshotIsComplete(tx, context.exceptionId, "imports.readerSources")) throw new ServiceError("conflict", "Review this older hold's original uploads before changing it.");
      return;
    }
    // The identity lock fences future admission, but cannot undo a provider
    // DELETE that already left the process. Resolve its original receipt first.
    const [deleting] = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites).where(and(
      eq(mediaObjectWrites.operation, "delete"), like(mediaObjectWrites.key, "imports/%"),
      inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]),
    )).limit(1);
    if (deleting) throw new ServiceError("conflict", "An original import deletion is unresolved. Review its original storage receipt before retaining these sources.");
    const members: { sourceId: string; generation: string }[] = [];
    // Snapshot only actual original upload nonces present in this hold TX.
    // The normalized completion receipt also records an actually empty set.
    for await (const run of runs(tx, true)) {
      const keys = await ownedSourceKeys(tx, run);
      const uploadIds = [...new Set(keys.map(key => key.split("/")[2]))].map(id => z.uuid().parse(id));
      if (!uploadIds.length) continue;
      const checkpoint = object(run.checkpoint);
      const holds = sourceHold.array().parse(checkpoint.sourcePrivacyHolds ?? []);
      for (const uploadId of uploadIds) {
        members.push({ sourceId: run.id, generation: uploadId });
        // This projection keeps older readers conservative. Current cleanup
        // uses the immutable normalized members, never mutable checkpoint JSON.
        if (!holds.some(hold => hold.exceptionId === context.exceptionId && hold.uploadId === uploadId)) holds.push({ requestId: context.requestId, exceptionId: context.exceptionId, uploadId });
      }
      await tx.update(importRuns).set({ checkpoint: { ...checkpoint, sourcePrivacyHolds: holds.map(({ exceptionId, requestId, uploadId }) => ({ exceptionId, requestId, uploadId })) } }).where(eq(importRuns.id, run.id));
    }
    // Enabled HTTP originals participate before this one canonical seal. An
    // empty legacy set must not seal first and later adopt other generations.
    members.push(...await collectAdditionalImportOriginals(tx, context));
    await completeRetentionSourceSnapshot(context.service, { exceptionId: context.exceptionId, requestId: context.requestId, sourceScope: "imports.readerSources", isNew: context.isNew, members });
  },
  retain: async (tx, _contactId, context) => {
    // Fulfillment must not widen an earlier exception to later uploads.
    // A historical missing receipt is review debt, never an empty capture.
    if (!await retentionSourceSnapshotIsComplete(tx, context.exceptionId, "imports.readerSources")) throw new ServiceError("conflict", "Review this older hold's original uploads before fulfilling the request.");
  },
  eraseUnheld: (tx, _contactId, context) => eraseUnheldOriginals(tx, context),
  exportData: async (tx, contactId) => {
    // A current address can retire an unbound source during erasure, but
    // cannot prove ownership of its historical name/body for disclosure.
    const matches = await subject(tx, contactId, false), result: SourceEntry[] = [];
    for await (const run of runs(tx, false)) result.push(...sourceEntries(run).filter(entry => matches(run.id, entry.key, entry.comment)));
    return result;
  },
  erase: async (tx, contactId, context) => {
    if (!context.service) throw new ServiceError("internal","Uploaded-source erasure requires its actual privacy service context.");
    await captureOriginalSourceErasureScope(context.service,context.requestId);
    const matches = await subject(tx, contactId);
    let affected = 0;
    const pendingJobs: string[] = [];
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
      // An opaque original cannot yet prove which reader metadata it contains. Its ordinary
      // private upload window may finish, but no erasure receipt may claim
      // completion before the original chunks are confirmed gone. Article,
      // page and media ownership remain untouched.
      // Historical generic audit inputs held another raw source copy.
      // Preserve the immutable caller/action/subject and non-content fields.
      await tx.update(auditLog).set({ diff: sql`${auditLog.diff} - 'payload' - 'preview' - 'pages' - 'prefix' - 'robotsTxt' - 'report'` }).where(and(
        eq(auditLog.subjectType, "import_run"), eq(auditLog.subjectId, run.id),
        inArray(auditLog.action, ["imports.previewFromSource", "imports.preview", "imports.applyCrawl", "imports.applyUploadedPreview", "imports.claimSourceChunk"]),
      ));
      const keys = await ownedSourceKeys(tx, run);
      if (keys.length && object(run.checkpoint).sourceGraph && !["committed", "reconciled", "published"].includes(run.status)) await invalidateImportGraph(tx, run);
      for (let offset = 0; offset < keys.length; offset += 25) {
        if (!context.service) throw new ServiceError("internal", "Source-object erasure requires the real privacy service context.");
        const originalJobId = randomUUID();
        const queued = await context.service.queueJob(IMPORT_SOURCE_ERASURE_JOB, { requestId: context.requestId, originalJobId, keys: keys.slice(offset, offset + 25) }, { id: originalJobId });
        pendingJobs.push(queued.id);
      }
    }
    return { affected, pendingJobs };
  },
});
