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
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { assets } from "@/core/media/schema";
import {
  backfillWatermarks,
  registerStoredOriginal,
  rescanAsset,
} from "@/core/media/service";
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
import { closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

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

describe("polyglots are decided by their first bytes", () => {
  it("loads a real PNG with SVG appended as a PNG", async () => {
    const png = await raster("png");
    const polyglot = new Uint8Array(Buffer.concat([Buffer.from(png), Buffer.from(svg)]));
    expect(sniffRasterImage(polyglot)).toBe("image/png");
    expect(await readImageFacts(polyglot)).toEqual({ width: 640, height: 480 });
    // sharp picks its decoder from the same leading signature, so the
    // trailing XML is never parsed as SVG.
    expect((await sharp(Buffer.from(polyglot)).metadata()).format).toBe("png");
  });

  it("refuses an SVG with a PNG appended", async () => {
    const png = await raster("png");
    const polyglot = new Uint8Array(Buffer.concat([Buffer.from(svg), Buffer.from(png)]));
    sharpInputs.length = 0;
    expect(sniffRasterImage(polyglot)).toBeUndefined();
    expect(await readImageFacts(polyglot)).toBeUndefined();
    expect(sharpInputs).toHaveLength(0);
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

  it("skips a legacy SVG in the watermark backfill without calling sharp", async () => {
    await ready();
    await updateBusiness.call(
      { name: "Hearth & Pine", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" },
      OWNER,
    );
    const legacy = await stored(svg, "logo.png", "image/png");
    sharpInputs.length = 0;
    const result = await backfillWatermarks.call({ limit: 10 }, { kind: "system" });
    expect(result).toEqual({ marked: 0, skipped: 1 });
    expect(sharpInputs).toHaveLength(0);
    const [after] = await db().select().from(assets).where(eq(assets.id, legacy.id));
    expect((after!.variants as Record<string, unknown>).watermarked).toEqual({});
    expect(await storage().get(legacy.storageKey)).toEqual(svg);
  });

  it("refuses to register a stored SVG labelled PNG", async () => {
    const key = `staged/${randomUUID()}/logo.png`;
    await storage().put(key, svg, "image/png");
    sharpInputs.length = 0;
    const refused = await failure(
      registerStoredOriginal.call(
        { key, filename: "logo.png", contentType: "image/png", bytes: svg.byteLength, source: "import" },
        { kind: "system" },
      ),
    );
    expect(refused.code).toBe("validation");
    expect(sharpInputs).toHaveLength(0);
  });

  it("re-checks the stored bytes when they change after the signature check", async () => {
    // The prefix read for validation says PNG; the body read for derivation
    // is SVG — a swap between the two reads. The derivation step's own sniff
    // refuses it before sharp sees it.
    const png = await raster("png");
    const key = `staged/${randomUUID()}/swap.png`;
    await storage().put(key, svg, "image/png");
    const readRange = vi
      .spyOn(storage(), "readRange")
      .mockResolvedValue(png.slice(0, Math.min(png.byteLength, 65_536)));
    sharpInputs.length = 0;
    try {
      const refused = await failure(
        registerStoredOriginal.call(
          { key, filename: "swap.png", contentType: "image/png", bytes: svg.byteLength, source: "import" },
          { kind: "system" },
        ),
      );
      expect(refused.code).toBe("validation");
      expect(refused.message).toContain("not a JPEG, PNG, GIF, WebP or AVIF image");
      expect(sharpInputs).toHaveLength(0);
    } finally {
      readRange.mockRestore();
    }
  });

  it("registers a stored PNG with renditions", async () => {
    const png = await raster("png");
    const key = `staged/${randomUUID()}/photo.png`;
    await storage().put(key, png, "image/png");
    const asset = await registerStoredOriginal.call(
      { key, filename: "photo.png", contentType: "image/png", bytes: png.byteLength, source: "import" },
      { kind: "system" },
    );
    expect(asset).toMatchObject({ kind: "image", width: 640, height: 480 });
    expect((asset.variants as { webp?: unknown[] }).webp?.length).toBeGreaterThan(0);
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
