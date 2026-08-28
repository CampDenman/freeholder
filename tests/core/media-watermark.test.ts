// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Watermarked proof renditions (MASTER.md §4.5, C8.04).
//
// The rules:
//
//   1. A mark is actually drawn — a "watermarked" rendition that is pixel-wise
//      identical to the unmarked one is the failure this file exists to catch.
//   2. The brand logo is the mark when there is one; the business name is the
//      mark when there is not.
//   3. Marked renditions never reach a public `<picture>` source.
//   4. Purge takes the marks with it.
//   5. A mark that cannot be drawn yields no rendition rather than a broken
//      one, and never fails the upload.
//   6. Images that predate watermarking get marks, and unmarkable ones stop
//      being retried.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import {
  allRenditionKeys,
  publicRenditions,
  toVariantSet,
  watermarkedRenditions,
  withWatermarked,
  type BuiltRendition,
} from "@/core/media/variants";
import { buildWatermarked } from "@/core/media/watermark";
import { backfillWatermarks } from "@/core/media/service";
import { assets } from "@/core/media/schema";
import { storage } from "@/adapters/storage";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const FACTS = { width: 2000, height: 1200 };

async function flatImage(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: {
      width: FACTS.width,
      height: FACTS.height,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buffer);
}

async function redLogo(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: {
      width: 600,
      height: 200,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

const keyFor = (format: string, width: number) => `proof.wm.${width}.${format}`;

function rendition(over: Partial<BuiltRendition> = {}): BuiltRendition {
  return {
    format: "webp",
    width: 800,
    height: 480,
    bytes: 1,
    key: "k.800.webp",
    body: new Uint8Array(),
    contentType: "image/webp",
    ...over,
  };
}

describe("watermarked proof renditions", () => {
  it("draws a visible mark from the business name", async () => {
    const built = await buildWatermarked(
      await flatImage(),
      FACTS,
      { text: "Hearth & Pine" },
      keyFor,
    );
    expect(built.length).toBeGreaterThan(0);
    for (const marked of built) {
      // A flat grey field has no variance of its own, so any deviation is the
      // mark. A blank overlay would leave this at zero and pass every other
      // assertion in this file.
      const stats = await sharp(marked.body).stats();
      const spread = Math.max(...stats.channels.map((channel) => channel.stdev));
      expect(spread).toBeGreaterThan(1);
      expect(marked.contentType).toBe("image/webp");
      expect(marked.key).toContain(".wm.");
    }
  });

  it("escapes a business name that would otherwise end the SVG early", async () => {
    const built = await buildWatermarked(
      await flatImage(),
      FACTS,
      { text: '</text><script>alert(1)</script>' },
      keyFor,
    );
    // The point is that it still renders rather than throwing or producing
    // nothing: an unescaped name would break the document.
    expect(built.length).toBeGreaterThan(0);
  });

  it("prefers the brand logo over the name", async () => {
    const image = await flatImage();
    const withLogo = await buildWatermarked(
      image,
      FACTS,
      { logo: await redLogo(), text: "Hearth & Pine" },
      keyFor,
    );
    expect(withLogo.length).toBeGreaterThan(0);
    const stats = await sharp(withLogo[0]!.body).stats();
    const [red, green] = stats.channels;
    // The logo is red; the ground is neutral grey. If the name had been drawn
    // instead, the channels would stay level with each other.
    expect(red!.mean).toBeGreaterThan(green!.mean + 5);
  });

  it("never upscales past the source and keeps the ladder short", async () => {
    const small = new Uint8Array(
      await sharp({
        create: { width: 500, height: 500, channels: 3, background: { r: 10, g: 10, b: 10 } },
      })
        .jpeg()
        .toBuffer(),
    );
    const built = await buildWatermarked(
      small,
      { width: 500, height: 500 },
      { text: "Hearth & Pine" },
      keyFor,
    );
    expect(built.every((r) => r.width <= 500)).toBe(true);
  });

  it("keeps marked renditions out of public sources and inside purge", () => {
    const set = withWatermarked(
      toVariantSet([
        rendition({ format: "webp", width: 800, key: "clean.800.webp" }),
        rendition({ format: "avif", width: 800, key: "clean.800.avif" }),
      ]),
      [rendition({ format: "webp", width: 800, key: "proof.wm.800.webp" })],
    );

    // A `<picture>` on a public page reads through publicRenditions. If it
    // iterated the raw object instead, the proof would become a source.
    const publicKeys = publicRenditions(set).flatMap(([, list]) => list.map((r) => r.key));
    expect(publicKeys).toEqual(["clean.800.avif", "clean.800.webp"]);
    expect(publicKeys).not.toContain("proof.wm.800.webp");
    expect(publicRenditions(set).map(([format]) => format)).not.toContain("watermarked");

    expect(watermarkedRenditions(set).map((r) => r.key)).toEqual(["proof.wm.800.webp"]);

    // Purge is the opposite rule: it must take everything.
    expect(allRenditionKeys(set).sort()).toEqual(
      ["clean.800.avif", "clean.800.webp", "proof.wm.800.webp"].sort(),
    );
  });

  it("yields nothing rather than a broken rendition when the source is not an image", async () => {
    const built = await buildWatermarked(
      new Uint8Array([1, 2, 3, 4]),
      FACTS,
      { text: "Hearth & Pine" },
      keyFor,
    );
    expect(built).toEqual([]);
  });

  it("leaves the set untouched when nothing could be marked", () => {
    const clean = toVariantSet([rendition({ key: "clean.800.webp" })]);
    expect(withWatermarked(clean, [])).toBe(clean);
    expect(watermarkedRenditions(clean)).toEqual([]);
  });
});

describe.runIf(hasDatabase)("backfilling marks onto an existing library", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      { name: "Hearth & Pine", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function storedImage(filename: string, body: Uint8Array<ArrayBuffer>) {
    const key = `test/${crypto.randomUUID()}.jpg`;
    await storage().put(key, body, "image/jpeg");
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: key,
        filename,
        mime: "image/jpeg",
        legacyBytes: body.byteLength,
        bytes: body.byteLength,
        status: "ready",
      })
      .returning();
    return created!;
  }

  it("marks an image uploaded before watermarking existed", async () => {
    const asset = await storedImage("legacy.jpg", await flatImage());
    const result = await backfillWatermarks.call({ limit: 10 }, { kind: "system" });
    expect(result.marked).toBe(1);

    const [after] = await db().select().from(assets).where(eq(assets.id, asset.id));
    const marked = watermarkedRenditions(after!.variants as never);
    // Without this the first owner to tick "watermark" on last year's work
    // gets an empty grid, because serving refuses to fall back to the master.
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0]!.key).toContain(".wm.");
  });

  it("stops retrying an image it can never mark", async () => {
    const asset = await storedImage("broken.jpg", new Uint8Array([1, 2, 3, 4]));
    const first = await backfillWatermarks.call({ limit: 10 }, { kind: "system" });
    expect(first.skipped).toBe(1);

    const [after] = await db().select().from(assets).where(eq(assets.id, asset.id));
    // An empty marked set, not an absent one: the next batch has to move past
    // this file rather than picking it up forever and starving the queue.
    expect((after!.variants as Record<string, unknown>).watermarked).toEqual({});

    const second = await backfillWatermarks.call({ limit: 10 }, { kind: "system" });
    expect(second.marked + second.skipped).toBe(0);
  });
});
