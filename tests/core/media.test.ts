// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The media pipeline (MASTER.md §4.5, §36, §18).
//
// §36 puts image optimization among the things Freeholder absorbs rather than
// leaves to a plugin, so "an owner uploads a camera JPEG and gets sensible
// renditions" is a promise with tests behind it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  buildRenditions,
  isRasterImage,
  kindFor,
  readImageFacts,
  toVariantSet,
} from "@/core/media/variants";
import {
  deleteAsset,
  listAssets,
  resolveImage,
  setAltText,
  uploadAsset,
} from "@/core/media/service";
import { resetStorageForTests, storage } from "@/adapters/storage";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

async function png(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 140 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("what a file is", () => {
  it("decides kind from the mime type", () => {
    expect(kindFor("image/jpeg")).toBe("image");
    expect(kindFor("video/mp4")).toBe("video");
    expect(kindFor("audio/mpeg")).toBe("audio");
    expect(kindFor("application/pdf")).toBe("doc");
  });

  it("treats SVG as an image but never as a raster one", () => {
    // An SVG is a document that can carry script. It is stored as uploaded,
    // never fed to the resizer, and served as a download.
    expect(kindFor("image/svg+xml")).toBe("image");
    expect(isRasterImage("image/svg+xml")).toBe(false);
    expect(isRasterImage("image/png")).toBe(true);
  });
});

describe("renditions", () => {
  it("reads intrinsic dimensions so a page can reserve space", async () => {
    expect(await readImageFacts(await png(300, 200))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("returns nothing for a file that only claims to be an image", async () => {
    // The upload still succeeds — the owner gets their file — it simply has
    // no renditions.
    const notAnImage = new Uint8Array(Buffer.from("this is not a png"));
    expect(await readImageFacts(notAnImage)).toBeUndefined();
  });

  it("never upscales", async () => {
    const original = await png(500, 300);
    const built = await buildRenditions(
      original,
      { width: 500, height: 300 },
      (format, width) => `k.${width}.${format}`,
    );
    expect(built.length).toBeGreaterThan(0);
    for (const rendition of built) {
      expect(rendition.width).toBeLessThanOrEqual(500);
    }
  });

  it("builds a ladder for a large image", async () => {
    const built = await buildRenditions(
      await png(2000, 1200),
      { width: 2000, height: 1200 },
      (format, width) => `k.${width}.${format}`,
    );
    const widths = [...new Set(built.map((r) => r.width))].sort((a, b) => a - b);
    expect(widths).toEqual([400, 800, 1600]);
  });

  it("groups renditions by format, smallest first", async () => {
    const built = await buildRenditions(
      await png(2000, 1200),
      { width: 2000, height: 1200 },
      (format, width) => `k.${width}.${format}`,
    );
    const set = toVariantSet(built);
    // WebP is effectively universal; AVIF depends on the libvips build, so
    // asserting on it would make this test a property of the machine.
    expect(set.webp).toBeDefined();
    const widths = set.webp!.map((r) => r.width);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });
});

describe.runIf(hasDatabase)("the asset library", () => {
  beforeEach(async () => {
    await truncateSpine();
    resetStorageForTests();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stores the original and its renditions, and records the facts", async () => {
    const asset = await uploadAsset.call(
      {
        filename: "Coast Sunrise.PNG",
        contentType: "image/png",
        bytes: await png(1200, 800),
      },
      STAFF,
    );

    expect(asset.kind).toBe("image");
    expect(asset.width).toBe(1200);
    expect(asset.height).toBe(800);
    expect(asset.filename).toBe("Coast Sunrise.PNG");
    // The storage key is sanitised; the owner's filename is not.
    expect(asset.storageKey).toMatch(/^\d{4}\/\d{2}\/[a-f0-9]{8}-coast-sunrise\.png$/);

    const store = storage();
    expect(await store.get(asset.storageKey)).toBeDefined();

    const variants = asset.variants as Record<string, { key: string }[]>;
    expect(variants.webp?.length).toBeGreaterThan(0);
    for (const rendition of variants.webp ?? []) {
      // A variant key on the row must point at something that exists.
      expect(await store.get(rendition.key), rendition.key).toBeDefined();
    }
  });

  it("stores a non-image without pretending to resize it", async () => {
    const asset = await uploadAsset.call(
      {
        filename: "terms.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array(Buffer.from("%PDF-1.4 not really")),
      },
      STAFF,
    );
    expect(asset.kind).toBe("doc");
    expect(asset.width).toBeNull();
    expect(asset.variants).toEqual({});
  });

  it("refuses an empty file", async () => {
    const error = await failure(
      uploadAsset.call(
        { filename: "empty.png", contentType: "image/png", bytes: new Uint8Array(0) },
        STAFF,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("resolves an image into sources a page can render", async () => {
    const asset = await uploadAsset.call(
      {
        filename: "hero.png",
        contentType: "image/png",
        bytes: await png(1600, 900),
        altText: "The coast at first light",
      },
      STAFF,
    );

    // Public: this is what draws an image on a page a visitor is reading.
    const resolved = await resolveImage.call({ id: asset.id }, ANONYMOUS);
    expect(resolved).not.toBeNull();
    expect(resolved!.width).toBe(1600);
    expect(resolved!.altText).toBe("The coast at first light");
    expect(resolved!.src).toContain(asset.storageKey);

    const webp = resolved!.sources.find((s) => s.format === "webp");
    expect(webp).toBeDefined();
    expect(webp!.type).toBe("image/webp");
    // A srcset the browser can choose from: "url 400w, url 800w".
    expect(webp!.srcset).toMatch(/\s\d+w(,|$)/);
  });

  it("answers null for an asset that is gone, rather than throwing", async () => {
    // A block pointing at a deleted asset leaves a gap in a page; it must
    // never take the page down.
    const resolved = await resolveImage.call(
      { id: "00000000-0000-4000-8000-000000000000" },
      ANONYMOUS,
    );
    expect(resolved).toBeNull();
  });

  it("records alt text against the asset, so every use inherits it", async () => {
    const asset = await uploadAsset.call(
      { filename: "a.png", contentType: "image/png", bytes: await png(100, 100) },
      STAFF,
    );
    expect(asset.altText).toBeNull();

    await setAltText.call({ id: asset.id, altText: "A blue square" }, STAFF);
    const resolved = await resolveImage.call({ id: asset.id }, ANONYMOUS);
    expect(resolved!.altText).toBe("A blue square");
  });

  it("empties storage as well as the row on delete", async () => {
    const asset = await uploadAsset.call(
      { filename: "gone.png", contentType: "image/png", bytes: await png(900, 600) },
      STAFF,
    );
    const variants = asset.variants as Record<string, { key: string }[]>;
    const keys = [
      asset.storageKey,
      ...Object.values(variants).flatMap((list) => list.map((r) => r.key)),
    ];

    await deleteAsset.call({ id: asset.id }, OWNER);

    const store = storage();
    for (const key of keys) {
      expect(await store.get(key), `${key} still in storage`).toBeUndefined();
    }
    expect((await listAssets.call({}, STAFF)).total).toBe(0);
  });

  it("keeps deletion to the owner", async () => {
    const asset = await uploadAsset.call(
      { filename: "a.png", contentType: "image/png", bytes: await png(50, 50) },
      STAFF,
    );
    const error = await failure(deleteAsset.call({ id: asset.id }, STAFF));
    expect(error.code).toBe("permission");
  });
});
