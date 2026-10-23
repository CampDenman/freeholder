// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stored assets reach sharp only as allow-listed raster bytes (C11.10).
//
// SVG uploads have been refused since #70, but a library can still hold SVG
// stored before then under an image kind and a raster mime type. Every path
// that hands a stored asset to sharp sniffs the bytes first, so that XML
// never reaches librsvg. sharp is wrapped here so each test can prove it was
// never called, not merely that the call failed.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type SharpModule from "sharp";
import { db } from "@/core/db";
import { assets } from "@/core/media/schema";
import { rescanAsset } from "@/core/media/service";
import {
  NOT_RASTER_IMAGE_REASON,
  NotRasterImageError,
  sniffRasterImage,
} from "@/core/media/validation";
import { buildRenditions, readImageFacts } from "@/core/media/variants";
import { buildWatermarked } from "@/core/media/watermark";
import { cropStill, stillThumbnail } from "@/modules/social/render";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { resetMalwareScannerForTests } from "@/adapters/malware";
import { closeDb, hasDatabase, STAFF, truncateSpine } from "../helpers/spine";

const sharpInputs = vi.hoisted(() => [] as unknown[]);

vi.mock("sharp", async (importOriginal) => {
  const actual = (await importOriginal<{ default: typeof SharpModule }>()).default;
  const wrapped = Object.assign(
    (...args: Parameters<typeof actual>) => {
      sharpInputs.push(args[0]);
      return actual(...args);
    },
    actual,
  );
  return { default: wrapped };
});

const sharp = (await import("sharp")).default;

async function raster(format: "png" | "jpeg"): Promise<Uint8Array<ArrayBuffer>> {
  const pipeline = sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 90, b: 60 } },
  });
  const buffer = await (format === "png" ? pipeline.png() : pipeline.jpeg()).toBuffer();
  return new Uint8Array(buffer);
}

/** An SVG a pre-#70 library could hold; its mime row says image/png. */
const svg = new Uint8Array(
  Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">' +
      '<image href="file:///etc/passwd"/><rect width="640" height="480"/></svg>',
  ),
);

beforeEach(() => {
  sharpInputs.length = 0;
});

describe("sniffing stored bytes", () => {
  it("accepts the upload allow-list and nothing else, whatever the label says", async () => {
    expect(sniffRasterImage(await raster("png"))).toBe("image/png");
    expect(sniffRasterImage(await raster("jpeg"))).toBe("image/jpeg");
    expect(sniffRasterImage(svg)).toBeUndefined();
    // A BOM or leading whitespace does not turn XML into a raster.
    expect(sniffRasterImage(Buffer.from(`﻿  ${Buffer.from(svg).toString()}`))).toBeUndefined();
    expect(sniffRasterImage(new Uint8Array(Buffer.from("%PDF-1.7")))).toBeUndefined();
    expect(sniffRasterImage(new Uint8Array())).toBeUndefined();
  });
});

describe("renditions refuse non-raster originals", () => {
  it("reads no facts from SVG and never calls sharp", async () => {
    expect(await readImageFacts(svg)).toBeUndefined();
    expect(sharpInputs).toHaveLength(0);
  });

  it("refuses to build variants from SVG bytes even with facts supplied", async () => {
    await expect(
      buildRenditions(svg, { width: 640, height: 480 }, (f, w) => `k.${w}.${f}`),
    ).rejects.toBeInstanceOf(NotRasterImageError);
    expect(sharpInputs).toHaveLength(0);
  });

  it("makes no watermarked rendition from SVG and ignores an SVG logo", async () => {
    expect(
      await buildWatermarked(
        svg,
        { width: 640, height: 480 },
        { text: "Studio" },
        (f, w) => `k.wm.${w}.${f}`,
      ),
    ).toEqual([]);
    expect(sharpInputs).toHaveLength(0);

    // A legacy SVG logo falls back to the escaped text mark; the logo bytes
    // themselves are never handed to sharp.
    const photo = await raster("png");
    sharpInputs.length = 0;
    await buildWatermarked(
      photo,
      { width: 640, height: 480 },
      { text: "Studio", logo: svg },
      (f, w) => `k.wm.${w}.${f}`,
    );
    expect(sharpInputs.some((input) => input === svg)).toBe(false);
  });

  it("still builds variants for JPEG and PNG", async () => {
    for (const format of ["png", "jpeg"] as const) {
      const bytes = await raster(format);
      sharpInputs.length = 0;
      const facts = await readImageFacts(bytes);
      // The wrapper does see real calls, so the zero counts above mean something.
      expect(sharpInputs).toContain(bytes);
      expect(facts).toEqual({ width: 640, height: 480 });
      const built = await buildRenditions(bytes, facts!, (f, w) => `k.${w}.${f}`);
      expect(built.some((rendition) => rendition.format === "webp")).toBe(true);
    }
  });
});

describe("social renditions refuse non-raster originals", () => {
  it("refuses to crop or thumbnail SVG bytes and never calls sharp", async () => {
    await expect(cropStill(svg, "1:1", "logo.png")).rejects.toBeInstanceOf(
      NotRasterImageError,
    );
    await expect(stillThumbnail(svg, "logo.png")).rejects.toBeInstanceOf(
      NotRasterImageError,
    );
    expect(sharpInputs).toHaveLength(0);
  });

  it("still crops JPEG and PNG", async () => {
    for (const format of ["png", "jpeg"] as const) {
      const crop = await cropStill(await raster(format), "1:1", `photo.${format}`);
      expect(crop.mime).toBe("image/jpeg");
      expect(sniffRasterImage(crop.bytes)).toBe("image/jpeg");
    }
  });
});

describe.runIf(hasDatabase)("rescanning a legacy library", () => {
  beforeEach(async () => {
    await truncateSpine();
    resetStorageForTests();
    resetMalwareScannerForTests();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function stored(bytes: Uint8Array<ArrayBuffer>, filename: string, mime: string) {
    const key = `legacy/${randomUUID()}/${filename}`;
    await storage().put(key, bytes, mime);
    const [asset] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: key,
        filename,
        mime,
        legacyBytes: bytes.byteLength,
        bytes: bytes.byteLength,
        variants: {},
        status: "ready",
        scanStatus: "pending",
        source: "migration",
      })
      .returning();
    return asset!;
  }

  it("skips an SVG labelled image/png with a reason and never calls sharp", async () => {
    const asset = await stored(svg, "logo.png", "image/png");
    sharpInputs.length = 0;

    const rescanned = await rescanAsset.call({ id: asset.id }, STAFF);

    expect(sharpInputs).toHaveLength(0);
    expect(rescanned.renditionsSkipped).toBe(NOT_RASTER_IMAGE_REASON);
    expect(rescanned).toMatchObject({
      id: asset.id,
      status: "ready",
      mime: "image/png",
      filename: "logo.png",
      width: null,
      height: null,
      variants: {},
    });
    // Neither altered nor deleted.
    expect(await storage().get(asset.storageKey)).toEqual(svg);
  });

  it("still builds renditions for stored JPEG and PNG originals", async () => {
    for (const [format, mime] of [
      ["png", "image/png"],
      ["jpeg", "image/jpeg"],
    ] as const) {
      const asset = await stored(await raster(format), `photo.${format}`, mime);
      const rescanned = await rescanAsset.call({ id: asset.id }, STAFF);
      expect(rescanned.renditionsSkipped).toBeNull();
      expect(rescanned).toMatchObject({ status: "ready", width: 640, height: 480 });
      const variants = rescanned.variants as { webp?: unknown[] };
      expect(variants.webp?.length).toBeGreaterThan(0);
    }
  });
});
