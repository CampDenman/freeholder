// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real Asset+receipt transactions survive lost replies and late workers.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { auditLog } from "@/core/events/schema";
import { importRuns } from "@/core/plugins/schema";
import { resolveContact } from "@/core/contacts/service";
import { uploadAsset } from "@/core/media/service";
import { createPage, ensureDefaults, publishPage } from "@/modules/cms/service";
import { commitImport, previewFromSource, reviewImportConflicts, startImport } from "@/core/import/service";
import { archivePreviewDigest } from "@/core/import/archive-plan";
import { bindImportMediaBytes, claimImportMedia, type ImportMediaReceipt } from "@/core/import/media-receipts";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const getPinnedBytes = vi.hoisted(() => vi.fn());
vi.mock("@/core/http/pinned-download", () => ({ getPinnedBytes, PinnedDownloadError: class PinnedDownloadError extends Error { readonly code = "network"; } }));
const XML = readFileSync("tests/fixtures/wordpress/sample-export.xml", "utf8");
type Checkpoint = { media?: Array<{ assetId?: string }>; mediaClaims?: Array<{ key: string; token: string; expiresAt: string }> };
async function staged() {
  const run = await startImport.call({ kind: "wordpress-wxr", origin: "https://old.example.org" }, OWNER);
  return previewFromSource.call({ id: run.id, payload: XML }, OWNER);
}
async function current(id: string) { return (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]!; }
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
};

describe.runIf(hasDatabase)("atomic import media receipts (C3.22)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER);
    const picture = sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 70, b: 120 } } });
    const jpeg = new Uint8Array(await picture.clone().jpeg().toBuffer()), png = new Uint8Array(await picture.clone().png().toBuffer());
    getPinnedBytes.mockReset();
    getPinnedBytes.mockImplementation((url: string) => Promise.resolve({ status: 200, bytes: url.endsWith(".png") ? png : jpeg }));
  });
  afterAll(() => { vi.restoreAllMocks(); return closeDb(); });

  it("recovers an Asset accepted before the commit caller loses its reply", async () => {
    const run = await staged(), original = uploadAsset.call.bind(uploadAsset);
    let loseReply = true;
    const spy = vi.spyOn(uploadAsset, "call").mockImplementation(async (input, actor) => {
      const result = await original(input, actor);
      if (loseReply) { loseReply = false; throw new Error("Synthetic post-commit reply loss"); }
      return result;
    });
    await expect(commitImport.call({ id: run.id }, OWNER)).rejects.toThrow("Synthetic post-commit reply loss");
    expect(await db().select().from(assets)).toHaveLength(1);
    const accepted = (await current(run.id)).checkpoint as Checkpoint;
    expect(accepted.media).toHaveLength(1);
    expect(typeof accepted.media?.[0]?.assetId).toBe("string");
    spy.mockRestore();
    expect(await commitImport.call({ id: run.id }, OWNER)).toMatchObject({ status: "committed", counts: { media: 2 } });
    expect(await db().select().from(assets)).toHaveLength(2);
    expect(getPinnedBytes.mock.calls).toHaveLength(2);
  });

  it("refuses a concurrent file claimant while the first caller is outside its transaction", async () => {
    const run = await staged(), original = uploadAsset.call.bind(uploadAsset), entered = gate(), resume = gate();
    let first = true;
    const spy = vi.spyOn(uploadAsset, "call").mockImplementation(async (input, actor) => {
      if (first) { first = false; entered.open(); await resume.promise; }
      return original(input, actor);
    });
    const pending = commitImport.call({ id: run.id }, OWNER);
    try {
      await entered.promise;
      expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    } finally { resume.open(); }
    expect(await pending).toMatchObject({ status: "committed" }); spy.mockRestore();
    expect(await db().select().from(assets)).toHaveLength(2);
    expect(getPinnedBytes.mock.calls).toHaveLength(2);
  });

  it("fences a late old worker inside the Asset transaction after its claim is replaced", async () => {
    const run = await staged(), original = uploadAsset.call.bind(uploadAsset), entered = gate(), resume = gate();
    let first = true;
    const spy = vi.spyOn(uploadAsset, "call").mockImplementation(async (input, actor) => {
      if (first) { first = false; entered.open(); await resume.promise; }
      return original(input, actor);
    });
    const pending = commitImport.call({ id: run.id }, OWNER);
    await entered.promise;
    const before = await current(run.id), checkpoint = before.checkpoint as Checkpoint;
    const prior = checkpoint.mediaClaims![0]!;
    await db().update(importRuns).set({ checkpoint: { ...checkpoint, mediaClaims: checkpoint.mediaClaims!.map(claim => ({ ...claim, expiresAt: new Date(0).toISOString() })) } }).where(eq(importRuns.id, run.id));
    const replacement = await claimImportMedia.call({ id: run.id, key: prior.key, previewDigest: archivePreviewDigest(run.preview) }, OWNER);
    expect(replacement.token).not.toBe(prior.token);
    resume.open();
    expect((await failure(pending)).code).toBe("conflict"); spy.mockRestore();
    expect(await db().select().from(assets)).toHaveLength(0);
    expect(((await current(run.id)).checkpoint as Checkpoint).mediaClaims?.[0]?.token).toBe(replacement.token);
  });

  it("retains real exact-key actors and refuses a media-only actor carrying a copied receipt", async () => {
    const run = await staged();
    const preview = run.preview as { wordpress: { media: Array<{ key: string; filename: string; sourceUrl: string }> } };
    const item = preview.wordpress.media[0]!;
    const claim = await claimImportMedia.call({ id: run.id, key: item.key, previewDigest: archivePreviewDigest(run.preview) }, OWNER);
    const downloaded = await getPinnedBytes(item.sourceUrl) as { bytes: Uint8Array<ArrayBuffer> };
    const receipt: ImportMediaReceipt = await bindImportMediaBytes.call({ runId: run.id, key: item.key, token: claim.token, previewDigest: archivePreviewDigest(run.preview), digest: createHash("sha256").update(downloaded.bytes).digest("hex"), bytes: downloaded.bytes.byteLength }, OWNER);
    expect((await failure(uploadAsset.call({ filename: item.filename, contentType: "application/octet-stream", bytes: downloaded.bytes, importReceipt: receipt, source: "import", provenance: {}, metadata: {} }, { kind: "agent", keyName: "media-only", scopes: ["media.upload"] }))).code).toBe("permission");
    expect(await db().select().from(assets)).toHaveLength(0);
    const actor = { kind: "agent" as const, keyName: "exact-import-receipt", scopes: ["imports.commit", "cms.*", "seo.*"] };
    await uploadAsset.call({ filename: item.filename, contentType: "application/octet-stream", bytes: downloaded.bytes, importReceipt: receipt, source: "import", provenance: {}, metadata: {} }, actor);
    const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.acceptPreparedMedia"));
    expect(entry?.actor).toBe("agent:exact-import-receipt");
    expect(actor.scopes).toEqual(["imports.commit", "cms.*", "seo.*"]);
    expect((await commitImport.call({ id: run.id }, actor)).status).toBe("committed");
    expect(await db().select().from(assets)).toHaveLength(2);
  });

  it("keeps CRM identifiers private on the new idempotent commit response", async () => {
    const run = await staged();
    const preview = z.object({ pages: z.array(z.object({ slug: z.string(), readerComments: z.array(z.object({ email: z.string().nullable() })).optional() })) }).parse(run.preview);
    const target = preview.pages.find(page => page.readerComments?.some(comment => comment.email));
    const address = target?.readerComments?.find(comment => comment.email)?.email;
    if (!target || !address) throw new Error("The synthetic WordPress source needs a reader-bearing post.");
    const reader = await resolveContact.call({ email: address }, OWNER);
    await previewFromSource.call({ id: run.id, payload: XML }, OWNER);
    const existing = await createPage.call({ title: "Existing source article", slug: target.slug, blocks: [{ id: "existing-heading", type: "heading", props: { text: "Existing source article", level: 1 } }] }, OWNER);
    await publishPage.call({ id: existing.id, published: true }, OWNER);
    await reviewImportConflicts.call({ id: run.id, conflicts: [{ slug: target.slug, resolution: "replace" }] }, OWNER);
    const actor = { kind: "agent" as const, keyName: "exact-replay-reader", scopes: ["imports.commit", "cms.*", "seo.*"] };
    const first = await commitImport.call({ id: run.id }, actor);
    const replay = await commitImport.call({ id: run.id }, actor);
    expect(JSON.stringify(first)).not.toContain(reader.contact.id);
    expect(JSON.stringify(replay)).not.toContain(reader.contact.id);
    expect(JSON.stringify((await current(run.id)).checkpoint)).toContain(reader.contact.id);
    expect(replay.status).toBe("committed");
  });
});
