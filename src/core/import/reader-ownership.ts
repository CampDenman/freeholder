// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: retain proved source ownership; never infer it from an old email.
import { and, eq, inArray, sql } from "drizzle-orm";
import { withoutPrivacyHold } from "@/core/retention/holds";
import { importRuns } from "@/core/plugins/schema";
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

/** A documented hold protects its original even before erasure verification. */
export async function readerOriginalsHeld(tx: Tx, contactIds: string[]) {
  if (!contactIds.length) return false;
  const [result] = await tx.execute<{ held: boolean }>(sql`select exists(
    select 1 from unnest(array[${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`,`)}]) subject(contact_id)
    where not ${withoutPrivacyHold(sql`subject.contact_id`, "cms.readerComments")}
      or not ${withoutPrivacyHold(sql`subject.contact_id`, "imports.readerSources")}
  ) as held`);
  return result?.held === true;
}

const deferredProjections = new WeakMap<Tx, { site: string; owners: Map<string, string> }>();

/** One atomic mutation may collect explicit choices, then rewrite each cache
 * once. Nothing in this buffer survives or authorizes a later transaction. */
export async function withReaderOwnerProjectionBatch<T>(tx: Tx, source: ReaderSource, work: () => Promise<T>): Promise<T> {
  if (deferredProjections.has(tx)) throw new ServiceError("conflict", "Nested original-reader choice batches are not supported.");
  const pending = { site: canonicalReaderSite(source), owners: new Map<string, string>() };
  deferredProjections.set(tx, pending);
  try {
    const result = await work();
    await projectReviewedReaderOwners(tx, source, pending.owners);
    return result;
  } finally { deferredProjections.delete(tx); }
}

/** A proved identity updates every still-cached copy of the same original.
 * Canonicalize URL metadata, including legacy trailing slashes and host case,
 * before comparing instances; paths keep their case and separate instances. */
async function projectReviewedReaderOwners(tx: Tx, source: ReaderSource, owners: Map<string, string>) {
  if (!owners.size) return;
  const site = canonicalReaderSite(source), encoded = JSON.stringify(Object.fromEntries(owners));
  let after: string | null = null;
  for (;;) {
    const candidates: Array<{ id: string; kind: string; origin: string | null; site: string | null }> = await tx.execute<{ id: string; kind: string; origin: string | null; site: string | null }>(sql`
      select id,kind,origin,coalesce(nullif(preview->>'readerSourceSite',''),nullif(checkpoint->>'readerSourceSite',''),nullif(preview#>>'{wordpress,site,url}',''),origin) as site
      from import_runs where kind in ('wordpress-wxr','wordpress-rest')
        and (${after}::uuid is null or id>${after}::uuid)
        and (jsonb_path_exists(preview,'$.pages[*].readerComments[*]') or jsonb_path_exists(checkpoint,'$.pendingBlogPosts[*].comments[*]')
          or exists(select 1 from blog_reader_comments comment where comment.source='import:'||import_runs.id::text))
      order by id limit 500`);
    if (!candidates.length) break;
    const ids = candidates.flatMap(candidate => {
      try { return canonicalReaderSite({ ...candidate, site: candidate.site ?? undefined }) === site ? [candidate.id] : []; }
      catch { return []; } // An unrelated malformed legacy URL is not this proved instance.
    });
    if (ids.length) {
      // A retained original is evidence for its actual erasure request, never
      // authority to move that evidence to a newly selected person.
      const [blocked] = await tx.execute<{ blocked: boolean }>(sql`select exists(
        select 1 from blog_reader_comments comment
        where comment.source in (${sql.join(ids.map(id => sql`'import:'||${id}::text`), sql`,`)})
          and ${encoded}::jsonb ? comment.external_id
          and (exists(select 1 from data_requests request where request.contact_id=comment.contact_id
            and request.kind='erasure' and request.status in ('in_progress','completed','partially_completed'))
            or not ${withoutPrivacyHold(sql`comment.contact_id`, "cms.readerComments")}
            or not ${withoutPrivacyHold(sql`comment.contact_id`, "imports.readerSources")})
      ) as blocked`);
      if (blocked?.blocked) throw new ServiceError("conflict", "A retained original reader is covered by an erasure or legal hold and cannot be reassigned.");
      await tx.execute(sql`update blog_reader_comments comment set contact_id=(decision.owners->>comment.external_id)::uuid,updated_at=clock_timestamp()
        from (select ${encoded}::jsonb as owners) decision
        where comment.source in (${sql.join(ids.map(id => sql`'import:'||${id}::text`), sql`,`)})
          and decision.owners ? comment.external_id and comment.contact_id is distinct from (decision.owners->>comment.external_id)::uuid`);
      await tx.execute(sql`with decision as (select ${encoded}::jsonb as owners)
      update import_runs source set
        preview=case when jsonb_typeof(source.preview->'pages')='array' then jsonb_set(source.preview,'{pages}',
          coalesce((select jsonb_agg(case when jsonb_typeof(page->'readerComments')='array'
            then jsonb_set(page,'{readerComments}',coalesce((select jsonb_agg(case when decision.owners ? ((page->>'wpId')||':'||(reader->>'id'))
              then (reader-'readerOwnershipReviewRequired')||jsonb_build_object('contactId',decision.owners->>((page->>'wpId')||':'||(reader->>'id'))) else reader end order by readers.n)
              from jsonb_array_elements(page->'readerComments') with ordinality as readers(reader,n)),'[]'::jsonb))
            else page end order by pages.n) from jsonb_array_elements(source.preview->'pages') with ordinality as pages(page,n)),'[]'::jsonb))
          else source.preview end,
        checkpoint=case when jsonb_typeof(source.checkpoint->'pendingBlogPosts')='array' then jsonb_set(source.checkpoint,'{pendingBlogPosts}',
          coalesce((select jsonb_agg(case when jsonb_typeof(post->'comments')='array'
            then jsonb_set(post,'{comments}',coalesce((select jsonb_agg(case when decision.owners ? ((post->>'key')||':'||(reader->>'id'))
              then (reader-'readerOwnershipReviewRequired')||jsonb_build_object('contactId',decision.owners->>((post->>'key')||':'||(reader->>'id'))) else reader end order by readers.n)
              from jsonb_array_elements(post->'comments') with ordinality as readers(reader,n)),'[]'::jsonb))
            else post end order by posts.n) from jsonb_array_elements(source.checkpoint->'pendingBlogPosts') with ordinality as posts(post,n)),'[]'::jsonb))
          else source.checkpoint end,updated_at=clock_timestamp()
      from decision where source.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
        and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(source.preview->'pages')='array' then source.preview->'pages' else '[]'::jsonb end) page
          cross join lateral jsonb_array_elements(case when jsonb_typeof(page->'readerComments')='array' then page->'readerComments' else '[]'::jsonb end) reader
          where decision.owners ? ((page->>'wpId')||':'||(reader->>'id')))
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(source.checkpoint->'pendingBlogPosts')='array' then source.checkpoint->'pendingBlogPosts' else '[]'::jsonb end) post
          cross join lateral jsonb_array_elements(case when jsonb_typeof(post->'comments')='array' then post->'comments' else '[]'::jsonb end) reader
          where decision.owners ? ((post->>'key')||':'||(reader->>'id'))))`);
    }
    after = candidates.at(-1)!.id;
    if (candidates.length < 500) break;
  }
}
export async function projectReviewedReaderOwner(tx: Tx, source: ReaderSource, post: string, comment: string, contactId: string) {
  const key = `${post}:${comment}`, pending = deferredProjections.get(tx);
  if (pending) {
    if (pending.site !== canonicalReaderSite(source) || pending.owners.has(key) && pending.owners.get(key) !== contactId) throw new ServiceError("conflict", "The explicit reader choices do not identify one unchanged original source.");
    pending.owners.set(key, contactId);
  } else await projectReviewedReaderOwners(tx, source, new Map([[key, contactId]]));
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
  const recorded = new Map<string, typeof readerOwnershipReceipts.$inferSelect>();
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = await tx.select().from(readerOwnershipReceipts).where(inArray(readerOwnershipReceipts.sourceDigest, rows.slice(offset, offset + BATCH).map(row => row.sourceDigest))).for("update");
    for (const receipt of batch) recorded.set(receipt.sourceDigest, receipt);
  }
  const ownerIds = [...new Set([...recorded.values()].flatMap(receipt => receipt.contactId ? [receipt.contactId] : []))];
  const retired = new Set<string>();
  for (let offset = 0; offset < ownerIds.length; offset += BATCH) {
    const requests = await tx.selectDistinct({ contactId: dataRequests.contactId }).from(dataRequests).where(and(inArray(dataRequests.contactId, ownerIds.slice(offset, offset + BATCH)), eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["in_progress", "completed", "partially_completed"])));
    for (const request of requests) retired.add(request.contactId);
  }
  for (const row of rows) {
    delete row.comment.contactId;
    delete row.comment.readerOwnershipReviewRequired;
    const receipt = recorded.get(row.sourceDigest);
    if (receipt?.state === "erased" || receipt?.contactId && retired.has(receipt.contactId)) throw new ReaderOwnershipErasedError();
    if (receipt?.contactId) { row.comment.contactId = receipt.contactId; continue; }
    if (receipt?.state === "review" || row.addressDigest || receipt?.addressDigest) {
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
  if (receipt.state === "review" || receipt.state === "unbound" && receipt.addressDigest) throw new ServiceError("conflict", "An owner must review this original reader before importing their comment.");
  if (receipt.contactId && (await tx.select({ id: dataRequests.id }).from(dataRequests).where(and(eq(dataRequests.contactId, receipt.contactId), eq(dataRequests.kind, "erasure"), inArray(dataRequests.status, ["in_progress", "completed", "partially_completed"]))).limit(1)).length) throw new ReaderOwnershipErasedError();
  return receipt;
}
export async function acceptReaderOwnership(tx: Tx, source: ReaderSource, post: string, comment: string, contactId: string | null) {
  const receipt = await readerOwnershipForComment(tx, source, post, comment);
  if (receipt.contactId !== contactId) throw new ServiceError("conflict", "The comment no longer matches its original reader owner.");
}



/** A legacy contact pointer or current mailbox cannot disclose imported
 * history. Only the original-coordinate receipt authorizes its owner. */
export async function ownedReaderComments<T extends { source: string; externalId: string | null; contactId: string | null }>(tx: Tx, rows: T[], contactId: string): Promise<T[]> {
  const imported = rows.filter(row => row.source.startsWith("import:"));
  if (!imported.length) return rows;
  const [sealed] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from import_reader_ownership_keys) as present`);
  if (!sealed?.present) {
    const [receipts] = await tx.select({ id: readerOwnershipReceipts.id }).from(readerOwnershipReceipts).limit(1);
    if (receipts) throw new ServiceError("conflict", "The original reader receipt key is missing. Restore its matching backup.");
    return rows.filter(row => !row.source.startsWith("import:"));
  }
  const key = await readerOwnershipKey(tx, { readOnly: true });
  const runIds = [...new Set(imported.map(row => row.source.slice(7)).filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const sources = new Map<string, typeof importRuns.$inferSelect>();
  for (let offset = 0; offset < runIds.length; offset += BATCH) {
    for (const source of await tx.select().from(importRuns).where(inArray(importRuns.id, runIds.slice(offset, offset + BATCH)))) sources.set(source.id, source);
  }
  const digests = new Map<T, string>();
  for (const row of imported) {
    const source = sources.get(row.source.slice(7)), coordinates = row.externalId?.split(":");
    if (!source || coordinates?.length !== 2) continue;
    try { digests.set(row, key.digest("source", readerSourceIdentity(source, coordinates[0]!, coordinates[1]!))); }
    catch (error) { if (!(error instanceof ServiceError)) throw error; }
  }
  const values = [...new Set(digests.values())], owned = new Set<string>();
  for (let offset = 0; offset < values.length; offset += BATCH) {
    const receipts = await tx.select({ digest: readerOwnershipReceipts.sourceDigest }).from(readerOwnershipReceipts).where(and(inArray(readerOwnershipReceipts.sourceDigest, values.slice(offset, offset + BATCH)), eq(readerOwnershipReceipts.contactId, contactId), inArray(readerOwnershipReceipts.state, ["bound", "erased"])));
    for (const receipt of receipts) owned.add(receipt.digest);
  }
  return rows.filter(row => !row.source.startsWith("import:") || owned.has(digests.get(row) ?? ""));
}
