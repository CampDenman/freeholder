// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Native offline batches vs app-free /capture/[token] (C10.18).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  bindCaptureAsset,
  confirmCapture,
  createCaptureSession,
  createUploadLink,
  getCaptureSession,
  grantCapturePermission,
} from "@/core/media/capture";
import {
  beginUpload,
  completeUpload,
  getAsset,
  signUploadParts,
  uploadAsset,
} from "@/core/media/service";
import { captureBatchOwner, createCaptureBatchStore, type CaptureTransport } from "../../packages/mobile-app/src/index";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

async function png(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function memoryCache() {
  const data = new Map<string, string>();
  return {
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
}

function ownerTransport(log: string[]): CaptureTransport {
  const services: Record<string, { call: (input: unknown, actor: typeof OWNER) => Promise<unknown> }> = {
    "media.createCaptureSession": createCaptureSession,
    "media.createUploadLink": createUploadLink,
    "media.grantCapturePermission": grantCapturePermission,
    "media.beginUpload": beginUpload,
    "media.signUploadParts": signUploadParts,
    "media.completeUpload": completeUpload,
    "media.bindCaptureAsset": bindCaptureAsset,
    "media.confirmCapture": confirmCapture,
    "media.getCaptureSession": getCaptureSession,
  };
  return {
    async call<T>(service: string, body: unknown) {
      log.push(service);
      const target = services[service];
      if (!target) throw new Error(service);
      return (await target.call(body, OWNER)) as T;
    },
    async putProxy(input) {
      log.push("media.upload");
      if (!input.bytes) throw new Error("Nothing to upload.");
      return uploadAsset.call(
        {
          filename: input.filename,
          contentType: input.contentType,
          bytes: input.bytes,
          uploadId: input.uploadId,
          source: "capture",
        },
        OWNER,
      );
    },
    async putPart() {
      throw new Error("This test uses the proxy strategy.");
    },
  };
}

describe.runIf(hasDatabase)("native capture batches match /capture/[token] (C10.18)", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("creates equivalent Assets through the same pipeline services", async () => {
    const bytes = await png();
    const file = { filename: "phone.png", contentType: "image/png", bytes, byteLength: bytes.byteLength };
    const phoneServices: string[] = [];

    const link = await createUploadLink.call({ source: "upload_link" }, OWNER);
    phoneServices.push("media.createUploadLink");
    const reservation = await beginUpload.call(
      {
        filename: file.filename,
        contentType: file.contentType,
        bytes: file.byteLength,
        source: "capture",
        provenance: { captureToken: link.token, captureSessionId: link.id, capturedAt: new Date().toISOString() },
      },
      ANONYMOUS,
    );
    phoneServices.push("media.beginUpload");
    const uploaded = await uploadAsset.call(
      {
        filename: file.filename,
        contentType: file.contentType,
        bytes,
        uploadId: reservation.id,
        source: "capture",
      },
      ANONYMOUS,
    );
    phoneServices.push("media.upload");
    await bindCaptureAsset.call({ token: link.token, assetId: uploaded.id }, ANONYMOUS);
    phoneServices.push("media.bindCaptureAsset");
    const phoneSession = await confirmCapture.call({ token: link.token }, ANONYMOUS);
    phoneServices.push("media.confirmCapture");
    const phoneAsset = await getAsset.call({ id: phoneSession.assetId! }, OWNER);

    const nativeServices: string[] = [];
    const owner = await captureBatchOwner({ instanceUrl: "https://studio.test", token: "session-a" });
    const store = createCaptureBatchStore(memoryCache());
    await store.bind(owner);
    const queued = await store.enqueue({
      source: "camera_roll",
      files: [file],
      destination: { kind: "library" },
      consent: { grantedAt: new Date().toISOString(), notice: "This app will use the camera or photos you choose." },
      owner,
    });
    expect(nativeServices).toEqual([]);
    const flushed = await store.flush({ online: true, transport: ownerTransport(nativeServices), owner });
    expect(flushed.confirmed).toEqual([queued.id]);
    const native = await store.get(queued.id);
    const nativeAsset = await getAsset.call({ id: native.items[0]!.assetId! }, OWNER);

    expect(nativeServices).toEqual([
      "media.createUploadLink",
      "media.beginUpload",
      "media.upload",
      "media.bindCaptureAsset",
      "media.confirmCapture",
    ]);
    expect(phoneServices).toEqual(nativeServices);
    expect(nativeAsset.source).toBe("capture");
    expect(phoneAsset.source).toBe("capture");
    expect(nativeAsset.kind).toBe(phoneAsset.kind);
    expect(nativeAsset.mime).toBe(phoneAsset.mime);
    expect(nativeAsset.filename).toBe(phoneAsset.filename);
    expect(nativeAsset.bytes).toBe(phoneAsset.bytes);
    expect(nativeAsset.status).toBe(phoneAsset.status);
    expect((nativeAsset.provenance as { captureSessionId?: string }).captureSessionId).toBeTruthy();
    expect((phoneAsset.provenance as { captureSessionId?: string }).captureSessionId).toBeTruthy();
    expect(nativeAsset.id).not.toBe(phoneAsset.id);
  });

  it("lands a native batch on the same product destination as a phone link", async () => {
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
    const bytes = await png();
    const file = { filename: "hero.png", contentType: "image/png", bytes, byteLength: bytes.byteLength };

    const link = await createUploadLink.call(
      { source: "upload_link", targetType: "product", targetId: product.id },
      OWNER,
    );
    const reservation = await beginUpload.call(
      {
        filename: file.filename,
        contentType: file.contentType,
        bytes: file.byteLength,
        source: "capture",
        provenance: { captureToken: link.token, captureSessionId: link.id, capturedAt: new Date().toISOString() },
      },
      ANONYMOUS,
    );
    const uploaded = await uploadAsset.call(
      {
        filename: file.filename,
        contentType: file.contentType,
        bytes,
        uploadId: reservation.id,
        source: "capture",
      },
      ANONYMOUS,
    );
    await bindCaptureAsset.call({ token: link.token, assetId: uploaded.id }, ANONYMOUS);
    await confirmCapture.call({ token: link.token }, ANONYMOUS);

    const owner = await captureBatchOwner({ instanceUrl: "https://studio.test", token: "session-a" });
    const store = createCaptureBatchStore(memoryCache());
    await store.bind(owner);
    await store.enqueue({
      source: "camera_roll",
      files: [{ ...file, filename: "native-hero.png" }],
      destination: { kind: "product", targetId: product.id, label: product.name },
      consent: { grantedAt: new Date().toISOString(), notice: "This app will use the camera or photos you choose." },
      owner,
    });
    await store.flush({ online: true, transport: ownerTransport([]), owner });
    const media = await listProductMedia.call({ productId: product.id }, OWNER);
    expect(media).toHaveLength(2);
    expect(media.map((row) => row.asset.source)).toEqual(["capture", "capture"]);
    expect(new Set(media.map((row) => row.asset.filename))).toEqual(new Set(["hero.png", "native-hero.png"]));
  });
});
