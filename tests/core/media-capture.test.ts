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
  getCaptureSession,
  grantCapturePermission,
  reviewCapture,
  startCapture,
  stopCapture,
} from "@/core/media/capture";
import { getAsset } from "@/core/media/service";
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
    expect(attached.asset.source).toBe("capture");
    await reviewCapture.call(
      { id: session.id, caption: "The studio desk", trimStartMs: 0, trimEndMs: 1_000 },
      OWNER,
    );
    const confirmed = await confirmCapture.call({ id: session.id }, OWNER);
    expect(confirmed.status).toBe("confirmed");
    const asset = await getAsset.call({ id: attached.asset.id }, OWNER);
    expect(asset.altText).toBe("The studio desk");
    expect(asset.source).toBe("capture");
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
    await discardCapture.call({ id: session.id }, OWNER);
    const asset = await getAsset.call({ id: attached.asset.id }, OWNER);
    expect(asset.status).toBe("trashed");
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
    const confirmed = await confirmCapture.call({ token: link.token }, ANONYMOUS);
    expect(confirmed.status).toBe("confirmed");
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
    expect(assembled.asset.bytes).toBe(original.byteLength);
  });

  it("binds a resumable upload started with a capture token", async () => {
    const link = await createUploadLink.call({ source: "upload_link" }, OWNER);
    const attached = await attachCaptureUpload.call(
      {
        token: link.token,
        filename: "phone.png",
        contentType: "image/png",
        bytes: await png(),
      },
      ANONYMOUS,
    );
    const { bindCaptureAsset } = await import("@/core/media/capture");
    const bound = await bindCaptureAsset.call(
      { token: link.token, assetId: attached.asset.id },
      ANONYMOUS,
    );
    expect(bound.assetId).toBe(attached.asset.id);
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
});
