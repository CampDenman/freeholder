// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: retain proved source ownership; never infer it from an old email.
import { and, eq, inArray, sql } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { dataRequests } from "@/core/privacy/schema";
import { actorString, ServiceError, type Actor, type Tx } from "@/core/service";
import { readerOwnershipKey } from "./reader-ownership-key";
import { readerOwnershipReceipts } from "./reader-ownership-schema";
import "./reader-ownership-registry";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const items = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const MAX_PHASE_READERS = 10_000;
const BATCH = 500;
export type ReaderSource = { kind: string | null; origin: string | null; site?: string; preview?: unknown; checkpoint?: unknown };
export type ReaderSourceContext = ReaderSource & { id: string };
export async function lockReaderOwnershipBindings(tx: Tx) {
  const [result] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('import-reader-ownership-bind-v1')) as locked`);
  if (!result?.locked) throw new ServiceError("conflict", "Another source reader review is in progress. Retry when it finishes.");
}
export class ReaderOwnershipErasedError extends ServiceError {
  constructor() { super("conflict", "This original source includes an erased reader. Remove their original reader data and review the source before importing comments."); }
}
export function canonicalReaderSite(source: ReaderSource): string {
  const preview = object(source.preview), checkpoint = object(source.checkpoint);
  const selected = [source.site, preview.readerSourceSite, checkpoint.readerSourceSite, object(object(preview.wordpress).site).url, source.origin].find(value => typeof value === "string" && value.length > 0);
  if (typeof selected !== "string") throw new ServiceError("conflict", "The original WordPress instance needs owner review.");
  let site: URL;
  try { site = new URL(selected); }
  catch { throw new ServiceError("validation", "The original WordPress instance URL is invalid."); }
  if (!["http:", "https:"].includes(site.protocol) || site.username || site.password) throw new ServiceError("validation", "The original WordPress instance URL is invalid.");
  site.hash = ""; site.search = ""; site.pathname = site.pathname.replace(/\/+$/, "") || "/";
  return site.href;
}
export function readerSourceIdentity(source: ReaderSource, post: string, comment: string) {
  if (!["wordpress-wxr", "wordpress-rest"].includes(source.kind ?? "") || !/^[1-9][0-9]{0,127}$/.test(post) || !/^[1-9][0-9]{0,127}$/.test(comment)) throw new ServiceError("conflict", "Original WordPress post and comment IDs are required; positional identities cannot establish reader ownership.");
  return JSON.stringify(["wordpress", canonicalReaderSite(source), post, comment]);
}
export function assertOriginalReaderPayload(run: { preview: unknown; checkpoint: unknown }, post: string, comment: string, input: { name: string; email: string | null; body: string }) {
  const preview = items(object(run.preview).pages).filter(page => page.wpId === post).flatMap(page => items(page.readerComments));
  const pending = items(object(run.checkpoint).pendingBlogPosts).filter(page => page.key === post).flatMap(page => items(page.comments));
  const original = [...preview, ...pending].find(reader => reader.id === comment);
  if (!original || original.name !== input.name || email(original.email) !== email(input.email) || original.body !== input.body) throw new ServiceError("conflict", "This comment no longer matches its staged original reader. Review the source before importing it.");
}

/** Project the proved owner into every still-cached copy of this exact source
 * identity. Privacy must not fall back to a later holder of the old address.
 * Reader bodies and the original import executor remain untouched.
 */
export async function projectReviewedReaderOwner(tx: Tx, source: ReaderSource, post: string, comment: string, contactId: string) {
  const site = canonicalReaderSite(source);
  await tx.execute(sql`update import_runs source set
    preview=case when jsonb_typeof(source.preview->'pages')='array' then jsonb_set(source.preview,'{pages}',
      coalesce((select jsonb_agg(case when page->>'wpId'=${post} and jsonb_typeof(page->'readerComments')='array'
        then jsonb_set(page,'{readerComments}',coalesce((select jsonb_agg(case when reader->>'id'=${comment}
          then (reader-'readerOwnershipReviewRequired')||jsonb_build_object('contactId',${contactId}::text) else reader end order by readers.n)
          from jsonb_array_elements(page->'readerComments') with ordinality as readers(reader,n)),'[]'::jsonb))
        else page end order by pages.n) from jsonb_array_elements(source.preview->'pages') with ordinality as pages(page,n)),'[]'::jsonb))
      else source.preview end,
    checkpoint=case when jsonb_typeof(source.checkpoint->'pendingBlogPosts')='array' then jsonb_set(source.checkpoint,'{pendingBlogPosts}',
      coalesce((select jsonb_agg(case when post->>'key'=${post} and jsonb_typeof(post->'comments')='array'
        then jsonb_set(post,'{comments}',coalesce((select jsonb_agg(case when reader->>'id'=${comment}
          then (reader-'readerOwnershipReviewRequired')||jsonb_build_object('contactId',${contactId}::text) else reader end order by readers.n)
          from jsonb_array_elements(post->'comments') with ordinality as readers(reader,n)),'[]'::jsonb))
        else post end order by posts.n) from jsonb_array_elements(source.checkpoint->'pendingBlogPosts') with ordinality as posts(post,n)),'[]'::jsonb))
      else source.checkpoint end,
    updated_at=clock_timestamp()
    where source.kind in ('wordpress-wxr','wordpress-rest')
      and coalesce(nullif(source.preview->>'readerSourceSite',''),nullif(source.checkpoint->>'readerSourceSite',''),nullif(source.preview#>>'{wordpress,site,url}',''),source.origin) in (${site},${site.replace(/\/$/, "")})
      and (jsonb_path_exists(source.preview,'$.pages[*] ? (@.wpId == $post).readerComments[*] ? (@.id == $comment)',jsonb_build_object('post',${post}::text,'comment',${comment}::text),true)
        or jsonb_path_exists(source.checkpoint,'$.pendingBlogPosts[*] ? (@.key == $post).comments[*] ? (@.id == $comment)',jsonb_build_object('post',${post}::text,'comment',${comment}::text),true))`);
}

/** This helper receives the already-cloned preview under the identity lock. */
export async function bindOwnedReaderSources(tx: Tx, preview: Json, source: ReaderSourceContext, actor: Actor): Promise<Json> {
  const entries = items(preview.pages).flatMap(page => items(page.readerComments).map(comment => ({ post: typeof page.wpId === "string" ? page.wpId : "", comment })));
  if (!entries.length) return preview;
  if (entries.length > MAX_PHASE_READERS) throw new ServiceError("validation", "This import phase exceeds its 10,000-reader ownership budget. Split the source into bounded phases before importing readers.");
  await lockReaderOwnershipBindings(tx);
  const key = await readerOwnershipKey(tx);
  const rows = entries.map(entry => ({ ...entry, sourceDigest: key.digest("source", readerSourceIdentity(source, entry.post, typeof entry.comment.id === "string" ? entry.comment.id : "")), addressDigest: email(entry.comment.email) ? key.digest("address", email(entry.comment.email)) : null }));
  if (new Set(rows.map(row => row.sourceDigest)).size !== rows.length) throw new ServiceError("validation", "The source repeats an original post/comment reader identity.");
  const known = new Map<string, string>();
  const addresses = [...new Set(rows.map(row => email(row.comment.email)).filter(Boolean))];
  for (let offset = 0; offset < addresses.length; offset += BATCH) {
    const batch = await tx.select({ id: contacts.id, email: contacts.email }).from(contacts).where(inArray(contacts.email, addresses.slice(offset, offset + BATCH))).for("key share");
    for (const contact of batch) known.set(email(contact.email), contact.id);
  }
  const recorded = new Map<string, typeof readerOwnershipReceipts.$inferSelect>();
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = await tx.select().from(readerOwnershipReceipts).where(inArray(readerOwnershipReceipts.sourceDigest, rows.slice(offset, offset + BATCH).map(row => row.sourceDigest))).for("update");
    for (const receipt of batch) recorded.set(receipt.sourceDigest, receipt);
  }
  const ownerIds = [...new Set([...known.values(), ...[...recorded.values()].flatMap(receipt => receipt.contactId ? [receipt.contactId] : [])])];
  const retired = new Set<string>();
  for (let offset = 0; offset < ownerIds.length; offset += BATCH) {
    const requests = await tx.selectDistinct({ contactId: dataRequests.contactId }).from(dataRequests).where(and(inArray(dataRequests.contactId, ownerIds.slice(offset, offset + BATCH)), eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["in_progress", "completed", "partially_completed"])));
    for (const request of requests) retired.add(request.contactId);
  }
  const checks = [...new Map(rows.filter(row => row.addressDigest).map(row => [row.addressDigest, { digest: row.addressDigest, email: email(row.comment.email), candidate: known.get(email(row.comment.email)) ?? null }])).values()];
  const ambiguous = new Set<string>();
  for (let offset = 0; offset < checks.length; offset += BATCH) {
    // Return only an opaque ambiguity marker. Historical addresses never
    // become a guessed contact binding or a list of private CRM candidates.
    const found = await tx.execute<{ digest: string }>(sql`
      select requested.digest from jsonb_to_recordset(${JSON.stringify(checks.slice(offset, offset + BATCH))}::jsonb)
        requested(digest text,email text,candidate uuid)
      where exists(select 1 from import_reader_ownership_receipts prior
          where prior.address_digest=requested.digest
            and (prior.state='erased' or (prior.contact_id is not null and prior.contact_id is distinct from requested.candidate)))
        or exists(select 1 from audit_log history join contacts person on person.id::text=history.subject_id
          where history.subject_type='contact' and history.action in ('contacts.create','contacts.resolve','contacts.update')
            and lower(history.diff->>'email')=requested.email and person.id is distinct from requested.candidate)
    `);
    for (const item of found) ambiguous.add(item.digest);
  }
  for (const row of rows) {
    delete row.comment.contactId;
    delete row.comment.readerOwnershipReviewRequired;
    const receipt = recorded.get(row.sourceDigest);
    if (receipt?.state === "erased" || receipt?.contactId && retired.has(receipt.contactId)) throw new ReaderOwnershipErasedError();
    if (receipt?.contactId) { row.comment.contactId = receipt.contactId; continue; }
    const candidate = known.get(email(row.comment.email));
    if (receipt?.state === "review" || candidate || row.addressDigest && ambiguous.has(row.addressDigest)) {
      row.comment.readerOwnershipReviewRequired = true;
      if (receipt?.state === "unbound") await tx.update(readerOwnershipReceipts).set({ state: "review", updatedAt: new Date() }).where(eq(readerOwnershipReceipts.id, receipt.id));
      continue;
    }
  }
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const missing = rows.slice(offset, offset + BATCH).filter(row => !recorded.has(row.sourceDigest));
    if (missing.length) await tx.insert(readerOwnershipReceipts).values(missing.map(row => ({ sourceDigest: row.sourceDigest, addressDigest: row.addressDigest, firstRunId: source.id, createdBy: actorString(actor), createdByKeyId: actor.kind === "user" || actor.kind === "agent" ? actor.keyId ?? null : null, contactId: typeof row.comment.contactId === "string" ? row.comment.contactId : null, state: row.comment.readerOwnershipReviewRequired === true ? "review" as const : typeof row.comment.contactId === "string" ? "bound" as const : "unbound" as const }))).onConflictDoNothing();
  }
  return preview;
}

export async function readerOwnershipForComment(tx: Tx, source: ReaderSource, post: string, comment: string) {
  const key = await readerOwnershipKey(tx);
  const sourceDigest = key.digest("source", readerSourceIdentity(source, post, comment));
  const [receipt] = await tx.select().from(readerOwnershipReceipts).where(eq(readerOwnershipReceipts.sourceDigest, sourceDigest)).limit(1).for("update");
  if (!receipt) throw new ServiceError("conflict", "Stage and review the original reader source before committing this comment.");
  if (receipt.state === "erased") throw new ReaderOwnershipErasedError();
  if (receipt.state === "review") throw new ServiceError("conflict", "An owner must review this original reader before importing their comment.");
  if (receipt.contactId && (await tx.select({ id: dataRequests.id }).from(dataRequests).where(and(eq(dataRequests.contactId, receipt.contactId), eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["in_progress", "completed", "partially_completed"]))).limit(1)).length) throw new ReaderOwnershipErasedError();
  return receipt;
}
export async function acceptReaderOwnership(tx: Tx, source: ReaderSource, post: string, comment: string, contactId: string | null) {
  const receipt = await readerOwnershipForComment(tx, source, post, comment);
  if (receipt.contactId && receipt.contactId !== contactId) throw new ServiceError("conflict", "The comment no longer matches its original reader owner.");
  if (!receipt.contactId && contactId) await tx.update(readerOwnershipReceipts).set({ contactId, state: "bound", updatedAt: new Date() }).where(eq(readerOwnershipReceipts.id, receipt.id));
}

