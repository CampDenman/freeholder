// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: ambiguous source ownership needs a verified human decision.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity, lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { getContact } from "@/core/contacts/service";
import { importRuns } from "@/core/plugins/schema";
import { dataRequests } from "@/core/privacy/schema";
import { defineService, permits, ServiceError, type ServiceContext } from "@/core/service";
import { currentImportAuthority } from "./authority";
import { isPrivateImportBatch } from "./batch-context";
import { lockReaderOwnershipBindings, projectReviewedReaderOwner, readerSourceIdentity } from "./reader-ownership";
import { readerOwnershipKey } from "./reader-ownership-key";
import { readerOwnershipReceipts } from "./reader-ownership-schema";

const originalId = z.string().regex(/^[1-9][0-9]{0,127}$/);
async function humanOwner(ctx: ServiceContext, fresh: boolean) {
  const actor = await currentImportAuthority(ctx);
  if (actor.kind !== "user" || actor.role !== "owner" || !actor.sessionId || actor.keyId || actor.keyScopes) throw new ServiceError("permission", "Sign in as the site owner to review original reader ownership.");
  if (!permits(actor, "scoped", fresh ? "imports.resolveReaderOwnership" : "imports.readerOwnershipReview", fresh ? "mutation" : "query") || !permits(actor, "scoped", "contacts.get", "query")) throw new ServiceError("permission", "Current source and contact permissions are required to review an original reader.");
  if (fresh && !actor.security?.stepUpValid) throw new ServiceError("step_up_required", "Confirm your identity before assigning an original reader.");
}
const sourcesFor = (id: string) => sql`(source.id=${id}::uuid or exists(select 1 from import_source_batches batch
  join import_source_graphs graph on graph.id=batch.graph_id where batch.child_run_id=source.id and graph.run_id=${id}::uuid))`;
const originalReaders = (id: string) => sql`
  select page->>'wpId' as post_id,reader from import_runs source
    cross join lateral jsonb_array_elements(case when jsonb_typeof(source.preview->'pages')='array' then source.preview->'pages' else '[]'::jsonb end) page
    cross join lateral jsonb_array_elements(case when jsonb_typeof(page->'readerComments')='array' then page->'readerComments' else '[]'::jsonb end) reader
    where ${sourcesFor(id)}
  union all
  select post->>'key' as post_id,reader from import_runs source
    cross join lateral jsonb_array_elements(case when jsonb_typeof(source.checkpoint->'pendingBlogPosts')='array' then source.checkpoint->'pendingBlogPosts' else '[]'::jsonb end) post
    cross join lateral jsonb_array_elements(case when jsonb_typeof(post->'comments')='array' then post->'comments' else '[]'::jsonb end) reader
    where ${sourcesFor(id)}`;

const reviewRow = z.object({ receiptId: z.uuid(), postId: originalId, commentId: originalId, name: z.string().max(200), email: z.string().max(320).nullable(), excerpt: z.string().max(500) });
export const readerOwnershipReview = defineService({
  name: "imports.readerOwnershipReview", summary: "Show a bounded original-reader review window to the signed-in owner.",
  kind: "query", permission: "scoped", agentCallable: false,
  input: z.object({ id: z.uuid(), after: z.string().max(260).default("") }),
  output: z.object({ rows: reviewRow.array().max(50), next: z.string().max(260).nullable() }),
  handler: async (input, ctx) => {
    await humanOwner(ctx, false); await lockContactIdentityForRead(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run || isPrivateImportBatch(run)) throw new ServiceError("not_found", "No such original source.");
    const raw = await ctx.tx.execute<{ postId: string; commentId: string; name: string; email: string | null; excerpt: string; cursor: string }>(sql`
      with original as (${originalReaders(input.id)}), pending as (
        select distinct on(post_id,reader->>'id') post_id,reader from original where reader->>'readerOwnershipReviewRequired'='true'
      ) select post_id as "postId",reader->>'id' as "commentId",left(coalesce(reader->>'name',''),200) as name,
        left(reader->>'email',320) as email,left(coalesce(reader->>'body',''),500) as excerpt,
        post_id||':'||(reader->>'id') as cursor from pending
      where post_id||':'||(reader->>'id')>${input.after} order by cursor limit 51`);
    if (!raw.length) return { rows: [], next: null };
    const key = await readerOwnershipKey(ctx.tx, { readOnly: true });
    const digests = raw.map(reader => key.digest("source", readerSourceIdentity(run, reader.postId, reader.commentId)));
    const receipts = await ctx.tx.select({ id: readerOwnershipReceipts.id, digest: readerOwnershipReceipts.sourceDigest }).from(readerOwnershipReceipts).where(and(inArray(readerOwnershipReceipts.sourceDigest, digests), eq(readerOwnershipReceipts.state, "review")));
    const byDigest = new Map(receipts.map(receipt => [receipt.digest, receipt.id]));
    const rows = raw.slice(0, 50).flatMap((reader, index) => {
      const receiptId = byDigest.get(digests[index]!);
      return receiptId ? [{ receiptId, postId: reader.postId, commentId: reader.commentId, name: reader.name, email: reader.email, excerpt: reader.excerpt }] : [];
    });
    return { rows, next: raw.length > 50 ? raw[49]!.cursor : null };
  },
});

export const resolveReaderOwnership = defineService({
  name: "imports.resolveReaderOwnership", summary: "Record the owner's verified assignment of an ambiguous original reader to an existing contact.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  auditInputFields: ["id", "receiptId", "postId", "commentId", "contactId"],
  input: z.object({ id: z.uuid(), receiptId: z.uuid(), postId: originalId, commentId: originalId, contactId: z.uuid(), confirmation: z.literal("ASSIGN ORIGINAL READER") }),
  output: z.object({ receiptId: z.uuid(), state: z.literal("bound") }),
  handler: async (input, ctx) => {
    await humanOwner(ctx, true); await lockContactIdentity(ctx.tx); await lockReaderOwnershipBindings(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run || isPrivateImportBatch(run) || !["discover", "mapped", "previewed", "committed", "reconciled", "failed"].includes(run.status)) throw new ServiceError("conflict", "This source is no longer waiting for original-reader review.");
    const key = await readerOwnershipKey(ctx.tx);
    const [receipt] = await ctx.tx.select().from(readerOwnershipReceipts).where(eq(readerOwnershipReceipts.id, input.receiptId)).limit(1).for("update");
    if (!receipt || receipt.sourceDigest !== key.digest("source", readerSourceIdentity(run, input.postId, input.commentId))) throw new ServiceError("conflict", "This review no longer matches the original source reader.");
    if (receipt.state === "erased" || receipt.contactId && receipt.contactId !== input.contactId) throw new ServiceError("conflict", "An erased or already-owned original reader cannot be reassigned.");
    const [original] = await ctx.tx.execute<{ present: boolean }>(sql`with original as (${originalReaders(input.id)})
      select exists(select 1 from original where post_id=${input.postId} and reader->>'id'=${input.commentId} and reader->>'readerOwnershipReviewRequired'='true') as present`);
    if (!original?.present) throw new ServiceError("conflict", "The original pending reader is no longer available for review.");
    const contact = await ctx.call(getContact, { id: input.contactId });
    if (contact.source === "privacy-erasure") throw new ServiceError("conflict", "That contact was erased and cannot receive another imported identity.");
    const [erasure] = await ctx.tx.select({ id: dataRequests.id }).from(dataRequests).where(and(eq(dataRequests.contactId, contact.id), eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["in_progress", "completed", "partially_completed"]))).limit(1);
    if (erasure) throw new ServiceError("conflict", "That person's erasure is active or acknowledged. Their retained record cannot authorize another import.");
    await ctx.tx.update(readerOwnershipReceipts).set({ contactId: contact.id, state: "bound", updatedAt: new Date() }).where(eq(readerOwnershipReceipts.id, receipt.id));
    await projectReviewedReaderOwner(ctx.tx, run, input.postId, input.commentId, contact.id);
    ctx.setSubject("contact", contact.id);
    return { receiptId: receipt.id, state: "bound" as const };
  },
});
export default [readerOwnershipReview, resolveReaderOwnership];
