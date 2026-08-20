// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Capture and phone ingest (MASTER.md §4.5, C1.28, C1.29).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  attachCaptureUpload,
  confirmCapture,
  createCaptureSession,
  createUploadLink,
  discardCapture,
  expireCaptureSessions,
  getCaptureSession,
  grantCapturePermission,
  reviewCapture,
  startCapture,
  stopCapture,
} from "@/core/media/capture";
import { getAsset, listAssets } from "@/core/media/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

async function png(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe.runIf(hasDatabase)("media capture sessions", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("refuses to record without an explicit permission grant", async () => {
    const session = await createCaptureSession.call({ source: "screen" }, OWNER);
    const blocked = await failure(startCapture.call({ id: session.id }, OWNER));
    expect(blocked.code).toBe("validation");
    expect(blocked.message).toContain("permission");
  });

  it("records, reviews, confirms and keeps provenance on a normal Asset", async () => {
    const session = await createCaptureSession.call({ source: "camera" }, OWNER);
    await grantCapturePermission.call({ id: session.id, displaySurface: "browser" }, OWNER);
    await startCapture.call({ id: session.id }, OWNER);
    await stopCapture.call({ id: session.id }, OWNER);
    const attached = await attachCaptureUpload.call(
      {
        id: session.id,
        filename: "desk.png",
        contentType: "image/png",
        bytes: await png(),
      },
      OWNER,
    );
    expect(attached.session.status).toBe("preview");
    expect(attached.session.staged).toBe(true);
    expect(attached.asset).toBeNull();
    expect((await listAssets.call({}, OWNER)).total).toBe(0);
    await reviewCapture.call(
      {
        id: session.id,
        caption: "The studio desk",
        trimStartMs: 0,
        trimEndMs: 1_000,
        focalX: 2_500,
        focalY: 7_500,
      },
      OWNER,
    );
    const confirmed = await confirmCapture.call({ id: session.id }, OWNER);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.assetId).toBeTruthy();
    const asset = await getAsset.call({ id: confirmed.assetId! }, OWNER);
    expect(asset.altText).toBe("The studio desk");
    expect(asset.source).toBe("capture");
    expect(asset.focalX).toBe(2_500);
    expect(asset.focalY).toBe(7_500);
    expect(asset.metadata).toMatchObject({ trimStartMs: 0, trimEndMs: 1_000 });
    expect(asset.provenance).toMatchObject({ captureSessionId: session.id });
  });

  it("discards a preview so the staged file does not stay in the library", async () => {
    const session = await createCaptureSession.call({ source: "microphone" }, OWNER);
    await grantCapturePermission.call({ id: session.id }, OWNER);
    const attached = await attachCaptureUpload.call(
      {
        id: session.id,
        filename: "clip.png",
        contentType: "image/png",
        bytes: await png(),
      },
      OWNER,
    );
    expect(attached.asset).toBeNull();
    expect(attached.session.staged).toBe(true);
    await discardCapture.call({ id: session.id }, OWNER);
    expect((await listAssets.call({ includeTrashed: true }, OWNER)).total).toBe(0);
    const gone = await getCaptureSession.call({ id: session.id }, OWNER);
    expect(gone?.status).toBe("discarded");
    expect(gone?.staged).toBe(false);
  });

  it("lets a phone finish an expiring upload link without a staff session", async () => {
    const link = await createUploadLink.call({ source: "upload_link" }, OWNER);
    expect(link.captureUrl).toContain("/capture/");
    expect(link.qrSvg).toContain("<svg");
    const attached = await attachCaptureUpload.call(
      {
        token: link.token,
        filename: "phone.png",
        contentType: "image/png",
        bytes: await png(),
      },
      ANONYMOUS,
    );
    expect(attached.session.status).toBe("preview");
    expect(attached.session.staged).toBe(true);
    expect((await listAssets.call({}, OWNER)).total).toBe(0);
    const confirmed = await confirmCapture.call({ token: link.token }, ANONYMOUS);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.assetId).toBeTruthy();
    expect(await getCaptureSession.call({ token: link.token }, ANONYMOUS)).toMatchObject({
      status: "confirmed",
      uploadCount: 1,
    });
  });

  it("persists recording chunks and assembles them after an interruption", async () => {
    const session = await createCaptureSession.call({ source: "screen" }, OWNER);
    await grantCapturePermission.call({ id: session.id }, OWNER);
    const original = await png();
    const split = Math.max(1, Math.floor(original.byteLength / 2));
    const { appendCaptureChunk, assembleCapture } = await import("@/core/media/capture");
    await appendCaptureChunk.call(
      { id: session.id, sequence: 0, contentType: "image/png", bytes: original.subarray(0, split) },
      OWNER,
    );
    await appendCaptureChunk.call(
      { id: session.id, sequence: 1, contentType: "image/png", bytes: original.subarray(split) },
      OWNER,
    );
    const assembled = await assembleCapture.call(
      { id: session.id, filename: "assembled.png" },
      OWNER,
    );
    expect(assembled.session.status).toBe("preview");
    expect(assembled.session.staged).toBe(true);
    expect(assembled.asset).toBeNull();
    const confirmed = await confirmCapture.call({ id: session.id }, OWNER);
    const asset = await getAsset.call({ id: confirmed.assetId! }, OWNER);
    expect(asset.bytes).toBe(original.byteLength);
  });

  it("refuses to assemble a recording with a missing chunk", async () => {
    // Local playback on the recording device always looks whole, so the
    // server is the only place a dropped upload can be caught before the
    // owner believes the recording is safe.
    const session = await createCaptureSession.call({ source: "screen" }, OWNER);
    await grantCapturePermission.call({ id: session.id }, OWNER);
    const original = await png();
    const split = Math.max(1, Math.floor(original.byteLength / 2));
    const { appendCaptureChunk, assembleCapture } = await import("@/core/media/capture");
    await appendCaptureChunk.call(
      { id: session.id, sequence: 0, contentType: "image/png", bytes: original.subarray(0, split) },
      OWNER,
    );
    await appendCaptureChunk.call(
      { id: session.id, sequence: 2, contentType: "image/png", bytes: original.subarray(split) },
      OWNER,
    );
    const gap = await failure(
      assembleCapture.call({ id: session.id, filename: "holes.png" }, OWNER),
    );
    expect(gap.code).toBe("conflict");
    // A lost *tail* is contiguous, so only the recorder's count can catch it.
    await appendCaptureChunk.call(
      { id: session.id, sequence: 1, contentType: "image/png", bytes: original.subarray(0, split) },
      OWNER,
    );
    const short = await failure(
      assembleCapture.call(
        { id: session.id, filename: "short.png", expectedChunks: 4 },
        OWNER,
      ),
    );
    expect(short.code).toBe("conflict");
    const assembled = await assembleCapture.call(
      { id: session.id, filename: "whole.png", expectedChunks: 3 },
      OWNER,
    );
    expect(assembled.session.staged).toBe(true);
  });

  it("binds a resumable upload started with a capture token", async () => {
    const link = await createUploadLink.call({ source: "upload_link" }, OWNER);
    const { uploadAsset } = await import("@/core/media/service");
    const uploaded = await uploadAsset.call(
      {
        filename: "phone.png",
        contentType: "image/png",
        bytes: await png(),
        source: "capture",
        provenance: { captureToken: link.token, captureSessionId: link.id },
      },
      ANONYMOUS,
    );
    const { bindCaptureAsset } = await import("@/core/media/capture");
    const bound = await bindCaptureAsset.call(
      { token: link.token, assetId: uploaded.id },
      ANONYMOUS,
    );
    expect(bound.assetId).toBe(uploaded.id);
    expect(bound.status).toBe("preview");
  });

  it("does not let an anonymous caller attach by id alone", async () => {
    const session = await createCaptureSession.call({ source: "camera" }, OWNER);
    const blocked = await failure(
      attachCaptureUpload.call(
        {
          id: session.id,
          filename: "nope.png",
          contentType: "image/png",
          bytes: await png(),
        },
        ANONYMOUS,
      ),
    );
    expect(blocked.code).toBe("permission");
  });

  it("expires an unconfirmed session and forgets the staged recording", async () => {
    const session = await createCaptureSession.call({ source: "screen" }, OWNER);
    await attachCaptureUpload.call(
      {
        id: session.id,
        filename: "desk.png",
        contentType: "image/png",
        bytes: await png(),
      },
      OWNER,
    );
    const { mediaCaptureSessions } = await import("@/core/media/schema");
    const { db } = await import("@/core/db");
    const { eq } = await import("drizzle-orm");
    await db()
      .update(mediaCaptureSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(mediaCaptureSessions.id, session.id));
    const swept = await expireCaptureSessions.call({}, OWNER);
    expect(swept.expired).toContain(session.id);
    expect((await listAssets.call({ includeTrashed: true }, OWNER)).total).toBe(0);
    expect(await getCaptureSession.call({ id: session.id }, OWNER)).toMatchObject({
      status: "expired",
      staged: false,
    });
  });

  it("stages a phone batch and only creates library assets on confirm", async () => {
    const link = await createUploadLink.call({ source: "camera_roll" }, OWNER);
    await attachCaptureUpload.call(
      {
        token: link.token,
        filename: "one.png",
        contentType: "image/png",
        bytes: await png(),
      },
      ANONYMOUS,
    );
    const second = await attachCaptureUpload.call(
      {
        token: link.token,
        filename: "two.png",
        contentType: "image/png",
        bytes: await png(),
      },
      ANONYMOUS,
    );
    expect(second.session.items).toHaveLength(2);
    expect((await listAssets.call({}, OWNER)).total).toBe(0);
    const confirmed = await confirmCapture.call({ token: link.token }, ANONYMOUS);
    expect(confirmed.status).toBe("confirmed");
    expect((await listAssets.call({}, OWNER)).total).toBe(2);
  });

  it("confirms a phone batch onto a product media target", async () => {
    const { createProduct } = await import("@/modules/catalog/service");
    const { createTaxCategory } = await import("@/modules/invoicing/tax-service");
    const { listProductMedia } = await import("@/modules/catalog/merchandising");
    const { updateBusiness } = await import("@/core/settings/service");
    await updateBusiness.call(
      { name: "Studio", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" },
      OWNER,
    );
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const product = await createProduct.call(
      { name: "Print set", slug: "print-set", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    const link = await createUploadLink.call(
      { source: "upload_link", targetType: "product", targetId: product.id },
      OWNER,
    );
    await attachCaptureUpload.call(
      {
        token: link.token,
        filename: "hero.png",
        contentType: "image/png",
        bytes: await png(),
      },
      ANONYMOUS,
    );
    await confirmCapture.call({ token: link.token }, ANONYMOUS);
    const media = await listProductMedia.call({ productId: product.id }, OWNER);
    expect(media).toHaveLength(1);
    expect(media[0]?.asset.source).toBe("capture");
  });
});
