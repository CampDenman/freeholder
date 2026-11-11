// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: an import file and its Asset are accepted in the same transaction.
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { importRuns } from "@/core/plugins/schema";
import { assets } from "@/core/media/schema";
import { defineService, permits, ServiceError, type ServiceContext } from "@/core/service";
import { archivePreviewDigest } from "./archive-plan";
import { assertNoPendingSourceUpload } from "./source-lifecycle";
import { currentImportBatch, lockImportBatchParent } from "./batch-context";
import { assertCurrentImportAuthority } from "./authority";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const importMediaReceiptSchema = z.object({ runId: z.uuid(), key: z.string().min(1).max(4_096), previewDigest: digest, token: z.uuid(), digest, bytes: z.number().int().positive().max(25 * 1024 * 1024) });
export type ImportMediaReceipt = z.infer<typeof importMediaReceiptSchema>;
const claimSchema = importMediaReceiptSchema.omit({ runId: true, digest: true, bytes: true }).extend({ digest: digest.optional(), bytes: z.number().int().positive().optional(), expiresAt: z.iso.datetime() });
const recordSchema = z.object({ key: z.string(), sourceUrl: z.string(), assetId: z.uuid().optional(), error: z.string().optional() });
const plannedSchema = z.object({ key: z.string(), sourceUrl: z.string(), filename: z.string(), digest: digest.optional(), bytes: z.number().int().nonnegative().optional() });
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const claims = (checkpoint: unknown) => z.array(claimSchema).max(500).parse(object(checkpoint).mediaClaims ?? []);
const records = (checkpoint: unknown) => z.array(recordSchema).max(500).parse(object(checkpoint).media ?? []);
type Run = typeof importRuns.$inferSelect;

function requireCommit(ctx: ServiceContext): void {
  // These cross-module completion wrappers are never external tools. They
  // explicitly use the same public verb decision as imports.commit; a media
  // grant or a readable claim token supplies no import mutation permission.
  if (!permits(ctx.actor, "scoped", "imports.commit", "mutation")) throw new ServiceError("permission", "This connection cannot commit imports.");
}
function snapshot(run: Run, witness: string): void {
  assertNoPendingSourceUpload(run);
  if (!["previewed", "committed", "reconciled", "published"].includes(run.status) || archivePreviewDigest(run.preview) !== witness) throw new ServiceError("conflict", "The import source changed. Reload its preview before retrying.");
  const preview = object(run.preview), checkpoint = object(run.checkpoint);
  if (preview.sourceFormat === "static-archive") {
    const bound = object(checkpoint.archiveSource), source = object(bound.source), retained = object(checkpoint.retainedSource);
    if (bound.previewDigest !== witness || source.runId !== run.id || (run.status === "previewed" && (retained.runId !== run.id || retained.uploadId !== source.uploadId || retained.revision !== source.revision))) throw new ServiceError("conflict", "The archive preview has no matching private source.");
  }
}
function planned(run: Run, key: string) {
  const preview = object(run.preview), source = object(preview.sourceFormat === "static-archive" ? preview.archive : preview.sourceFormat === "generic-site" ? preview.generic : preview.wordpress);
  const item = z.array(plannedSchema).max(500).parse(source.media ?? []).find(item => item.key === key);
  if (!item) throw new ServiceError("validation", "That file is not in this import preview.");
  return item;
}
export function importMediaNote(runId: string, witness: string, key: string): string {
  return `Freeholder import ${runId}/${witness}/${createHash("sha256").update(key).digest("hex")}`;
}
async function lockedRun(ctx: ServiceContext, runId: string): Promise<Run> {
  await lockImportBatchParent(ctx, runId);
  if (currentImportBatch()) await assertCurrentImportAuthority(ctx, "media.upload", "mutation", "public");
  const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1).for("update");
  if (!run) throw new ServiceError("not_found", "No such import run.");
  return run;
}

export const claimImportMedia = defineService({
  name: "imports.claimMedia", orchestratedBy: "imports.commit", summary: "Claim one preview-bound file before provider work.", kind: "mutation", permission: "scoped", external: false,
  input: z.object({ id: z.uuid(), key: z.string(), previewDigest: digest }),
  output: z.object({ token: z.uuid(), assetId: z.uuid().optional(), digest: digest.optional(), bytes: z.number().int().positive().optional(), note: z.string() }),
  handler: async (input, ctx) => {
    requireCommit(ctx);
    const run = await lockedRun(ctx, input.id); snapshot(run, input.previewDigest);
    if (run.status !== "previewed") throw new ServiceError("conflict", "This import is already committed.");
    const item = planned(run, input.key), existing = claims(run.checkpoint), current = existing.find(claim => claim.key === input.key && claim.previewDigest === input.previewDigest);
    const accepted = records(run.checkpoint).find(entry => entry.key === input.key && entry.assetId);
    if (accepted?.assetId) return { token: randomUUID(), assetId: accepted.assetId, note: importMediaNote(run.id, input.previewDigest, item.key) };
    if (current && Date.parse(current.expiresAt) > Date.now()) throw new ServiceError("conflict", "This import file is still being processed. Retry shortly.");
    const claim = { key: item.key, previewDigest: input.previewDigest, token: randomUUID(), digest: current?.digest ?? item.digest, bytes: current?.bytes ?? item.bytes, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(run.checkpoint), mediaClaims: [...existing.filter(entry => entry.key !== item.key), claim] } }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { token: claim.token, digest: claim.digest, bytes: claim.bytes, note: importMediaNote(run.id, input.previewDigest, item.key) };
  },
});

export const bindImportMediaBytes = defineService({
  name: "imports.bindMediaBytes", orchestratedBy: "imports.commit", summary: "Bind verified source bytes to one import file claim.", kind: "mutation", permission: "scoped", external: false,
  input: importMediaReceiptSchema,
  output: importMediaReceiptSchema,
  handler: async (input, ctx) => {
    requireCommit(ctx);
    const run = await lockedRun(ctx, input.runId); snapshot(run, input.previewDigest); planned(run, input.key);
    const all = claims(run.checkpoint), claim = all.find(entry => entry.key === input.key && entry.token === input.token && entry.previewDigest === input.previewDigest);
    if (run.status !== "previewed" || !claim || (claim.digest && claim.digest !== input.digest) || (claim.bytes !== undefined && claim.bytes !== input.bytes)) throw new ServiceError("conflict", "This import file claim changed or its source bytes differ.");
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(run.checkpoint), mediaClaims: all.map(entry => entry.key === input.key ? { ...entry, digest: input.digest, bytes: input.bytes } : entry) } }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return input;
  },
});

async function verify(ctx: ServiceContext, input: ImportMediaReceipt, checksum: string, bytes: number) {
  requireCommit(ctx);
  const run = await lockedRun(ctx, input.runId); snapshot(run, input.previewDigest);
  const item = planned(run, input.key);
  if (checksum !== input.digest || bytes !== input.bytes) throw new ServiceError("conflict", "The uploaded bytes differ from their import receipt.");
  const accepted = records(run.checkpoint).find(entry => entry.key === input.key && entry.assetId);
  if (accepted?.assetId) {
    const [asset] = await ctx.tx.select().from(assets).where(eq(assets.id, accepted.assetId)).limit(1);
    if (!asset || asset.checksumSha256 !== checksum || asset.bytes !== bytes || asset.status === "trashed") throw new ServiceError("conflict", "The accepted import file is no longer available.");
    return { run, item, assetId: asset.id };
  }
  const claim = claims(run.checkpoint).find(entry => entry.key === input.key && entry.token === input.token && entry.previewDigest === input.previewDigest);
  if (run.status !== "previewed" || !claim || claim.digest !== checksum || claim.bytes !== bytes) throw new ServiceError("conflict", "This import file claim was replaced.");
  return { run, item, assetId: undefined };
}

export const verifyPreparedImportMedia = defineService({
  name: "imports.verifyPreparedMedia", summary: "Fence a prepared asset against its exact source claim.", kind: "query", permission: "public", external: false,
  input: z.object({ receipt: importMediaReceiptSchema, checksum: digest, bytes: z.number().int().positive() }), output: z.object({ assetId: z.uuid().optional() }),
  handler: async (input, ctx) => ({ assetId: (await verify(ctx, input.receipt, input.checksum, input.bytes)).assetId }),
});

export const acceptPreparedImportMedia = defineService({
  name: "imports.acceptPreparedMedia", summary: "Record an import file atomically with the new Asset.", kind: "mutation", permission: "public", external: false,
  input: z.object({ receipt: importMediaReceiptSchema, assetId: z.uuid() }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx.select().from(assets).where(and(eq(assets.id, input.assetId), eq(assets.source, "import"))).limit(1);
    if (!asset || asset.provenance === null || object(asset.provenance).note !== importMediaNote(input.receipt.runId, input.receipt.previewDigest, input.receipt.key)) throw new ServiceError("conflict", "That asset does not carry this import's source receipt.");
    const { run, item, assetId } = await verify(ctx, input.receipt, asset.checksumSha256 ?? "", asset.bytes);
    if (assetId && assetId !== asset.id) throw new ServiceError("conflict", "This import file already accepted another asset.");
    const checkpoint = object(run.checkpoint);
    await ctx.tx.update(importRuns).set({ checkpoint: { ...checkpoint, media: [...records(checkpoint).filter(entry => entry.key !== item.key), { key: item.key, sourceUrl: item.sourceUrl, assetId: asset.id }], mediaClaims: claims(checkpoint).filter(entry => entry.key !== item.key) } }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { ok: true as const };
  },
});

export default [claimImportMedia, bindImportMediaBytes, verifyPreparedImportMedia, acceptPreparedImportMedia];
