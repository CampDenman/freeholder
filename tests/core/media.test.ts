// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The media pipeline (MASTER.md §4.5, §36, §18).
//
// §36 puts image optimization among the things Freeholder absorbs rather than
// leaves to a plugin, so "an owner uploads a camera JPEG and gets sensible
// renditions" is a promise with tests behind it.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { db } from "@/core/db";
import { GET as serveMedia } from "../../app/media/[...key]/route";
import { GET as downloadMedia } from "../../app/media/download/[id]/route";
import {
  assets,
  mediaAltTextSuggestions,
  mediaObjects,
  mediaUploads,
} from "@/core/media/schema";
import { validateMediaFile } from "@/core/media/validation";
import {
  buildRenditions,
  isRasterImage,
  kindFor,
  readImageFacts,
  toVariantSet,
} from "@/core/media/variants";
import {
  acceptAltTextSuggestion,
  altTextSuggestionState,
  assetUsage,
  beginUpload,
  cleanupOrphanedMedia,
  completeUpload,
  deleteAsset,
  dismissAltTextSuggestion,
  generateAltTextSuggestion,
  getAsset,
  listAssets,
  listAltTextSuggestionStates,
  purgeAsset,
  purgeExpiredAsset,
  rescanAsset,
  resolveAsset,
  resolveImage,
  restoreAsset,
  setAltText,
  setFocalPoint,
  signUploadParts,
  updateAssetDetails,
  uploadAsset,
  uploadStatus,
} from "@/core/media/service";
import {
  createPage,
  publishPage,
  resolvePage,
} from "@/modules/cms/service";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { resetMalwareScannerForTests } from "@/adapters/malware";
import {
  resetAltTextSuggesterForTests,
  setAltTextSuggesterForTests,
} from "@/adapters/alt-text";
import { resetEnvForTests } from "@/core/env";
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

const mp4 = () =>
  new Uint8Array(
    Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]),
  );
const mp3 = () => new Uint8Array(Buffer.from("ID3\u0004\u0000\u0000sample"));

describe("what a file is", () => {
  it("decides kind from the mime type", () => {
    expect(kindFor("image/jpeg")).toBe("image");
    expect(kindFor("video/mp4")).toBe("video");
    expect(kindFor("audio/mpeg")).toBe("audio");
    expect(kindFor("application/pdf")).toBe("doc");
  });

  it("classifies SVG separately from raster images before validation rejects it", () => {
    // The broad MIME classifier must not send SVG through Sharp. The stricter
    // upload validator below rejects it because it can carry executable code.
    expect(kindFor("image/svg+xml")).toBe("image");
    expect(isRasterImage("image/svg+xml")).toBe(false);
    expect(isRasterImage("image/png")).toBe(true);
  });

  it("trusts signatures rather than a browser MIME claim", () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n"));
    expect(() =>
      validateMediaFile({
        filename: "invoice.pdf",
        declaredMime: "image/png",
        bytes: pdf.byteLength,
        prefix: pdf,
      }),
    ).toThrow(/browser called this image\/png/i);
  });

  it("refuses executable SVG and mismatched extensions", () => {
    const svg = new Uint8Array(Buffer.from('<svg><script>alert(1)</script></svg>'));
    expect(() =>
      validateMediaFile({
        filename: "unsafe.svg",
        declaredMime: "image/svg+xml",
        bytes: svg.byteLength,
        prefix: svg,
      }),
    ).toThrow(/not accepted/i);
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n"));
    expect(() =>
      validateMediaFile({
        filename: "invoice.png",
        declaredMime: "application/octet-stream",
        bytes: pdf.byteLength,
        prefix: pdf,
      }),
    ).toThrow(/extension/i);
  });

  it("recognizes video, audio, and OpenXML documents by their bytes", () => {
    expect(
      validateMediaFile({
        filename: "clip.mp4",
        declaredMime: "video/mp4",
        bytes: mp4().byteLength,
        prefix: mp4(),
      }).kind,
    ).toBe("video");
    expect(
      validateMediaFile({
        filename: "voice.mp3",
        declaredMime: "audio/mpeg",
        bytes: mp3().byteLength,
        prefix: mp3(),
      }).kind,
    ).toBe("audio");
    const zip = new Uint8Array(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("[Content_Types].xml word/document.xml"),
      ]),
    );
    expect(
      validateMediaFile({
        filename: "brief.docx",
        declaredMime:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: zip.byteLength,
        prefix: zip,
      }).kind,
    ).toBe("doc");
    const genericZip = new Uint8Array(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("payload.bin"),
      ]),
    );
    expect(() =>
      validateMediaFile({
        filename: "fake.docx",
        declaredMime:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: genericZip.byteLength,
        prefix: genericZip,
      }),
    ).toThrow(/not supported/i);
  });
});

describe("the additive media lifecycle migration", () => {
  it("widens large-file accounting and backfills the exact object inventory", () => {
    const migration = readFileSync(
      "db/migrations/0029_closed_rockslide.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "media_uploads"');
    expect(migration).toContain('CREATE TABLE "media_objects"');
    expect(migration).toContain(
      'ALTER TABLE "assets" ADD COLUMN "byte_size" bigint DEFAULT 0 NOT NULL',
    );
    expect(migration).toContain("freeholder_sync_asset_byte_size");
    expect(migration).toContain("freeholder_inventory_legacy_asset");
    expect(migration).toContain("CROSS JOIN LATERAL jsonb_each");
    expect(migration).toContain("'original', 'attached'");
    expect(migration).toContain("'variant',");
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
  });

  it("adds a normalized human-review ledger without destructive schema work", () => {
    const migration = readFileSync(
      "db/migrations/0030_tired_northstar.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "media_alt_text_suggestions"');
    expect(migration).toContain('"authored_alt_text_at_request" text');
    expect(migration).toContain(
      'WHERE "media_alt_text_suggestions"."status" = \'ready\'',
    );
    expect(migration).toContain('CONSTRAINT "media_alt_text_status_valid"');
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
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
    resetAltTextSuggesterForTests();
  });

  afterEach(() => {
    resetAltTextSuggesterForTests();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("keeps release N-1 asset inserts accurate after the additive migration", async () => {
    const id = "00000000-0000-4000-8000-000000000099";
    await db().execute(sql`
      insert into assets (
        id, kind, storage_key, filename, mime, bytes, variants
      ) values (
        ${id}::uuid, 'doc', 'legacy/manual.pdf', 'manual.pdf',
        'application/pdf', 321, '{}'::jsonb
      )
    `);
    const legacy = await getAsset.call({ id }, STAFF);
    expect(legacy).toMatchObject({ bytes: 321, legacyBytes: 321 });
    const [object] = await db()
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.assetId, id));
    expect(object).toMatchObject({
      key: "legacy/manual.pdf",
      role: "original",
      state: "attached",
      bytes: 321,
    });
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
    expect(asset.status).toBe("ready");
    expect(asset.scanStatus).toBe("not_configured");
    expect(asset.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.uploadedBy).toBe(`user:${STAFF.userId}`);
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
    const resolved = await resolveAsset.call({ id: asset.id }, ANONYMOUS);
    expect(resolved).toMatchObject({
      kind: "doc",
      filename: "terms.pdf",
      mime: "application/pdf",
      src: `/media/download/${asset.id}`,
    });
    const downloaded = await downloadMedia(
      new Request(`http://localhost/media/download/${asset.id}`),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(downloaded.headers.get("content-disposition")).toContain(
      "terms.pdf",
    );
    expect(Buffer.from(await downloaded.arrayBuffer()).toString()).toContain(
      "%PDF-1.4",
    );
    const delivered = await serveMedia(
      new Request(`http://localhost/media/${asset.storageKey}`),
      { params: Promise.resolve({ key: asset.storageKey.split("/") }) },
    );
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(delivered.headers.get("content-disposition")).toContain(
      "terms.pdf",
    );

    await deleteAsset.call({ id: asset.id }, OWNER);
    const revoked = await downloadMedia(
      new Request(`http://localhost/media/download/${asset.id}`),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(revoked.status).toBe(404);
  });

  it("quarantines a scanner hit and revokes every delivery path", async () => {
    const previous = { ...process.env };
    let scannerReply = "stream: Eicar-Test-Signature FOUND";
    const server = createServer((socket) => {
      let received = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        received = Buffer.concat([
          received,
          typeof chunk === "string" ? Buffer.from(chunk) : chunk,
        ]);
        if (
          received.length >= 4 &&
          received.subarray(-4).every((byte) => byte === 0)
        ) {
          socket.end(`${scannerReply}\0`);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      Object.assign(process.env, {
        MALWARE_SCANNER: "clamav",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: String((server.address() as AddressInfo).port),
      });
      resetEnvForTests();
      resetMalwareScannerForTests();
      const asset = await uploadAsset.call(
        {
          filename: "caught.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array(Buffer.from("%PDF-1.7 test")),
        },
        STAFF,
      );
      expect(asset).toMatchObject({
        status: "quarantined",
        scanStatus: "infected",
        scanEngine: "clamav",
      });
      await expect(resolveAsset.call({ id: asset.id }, ANONYMOUS)).resolves.toBeNull();
      const revoked = await serveMedia(
        new Request(`http://localhost/media/${asset.storageKey}`),
        { params: Promise.resolve({ key: asset.storageKey.split("/") }) },
      );
      expect(revoked.status).toBe(404);

      scannerReply = "stream: OK";
      const rescanned = await rescanAsset.call({ id: asset.id }, STAFF);
      expect(rescanned).toMatchObject({
        status: "ready",
        scanStatus: "clean",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env = previous;
      resetEnvForTests();
      resetMalwareScannerForTests();
    }
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

  it("registers playable video and audio with duration metadata", async () => {
    const video = await uploadAsset.call(
      {
        filename: "clip.mp4",
        contentType: "video/mp4",
        bytes: mp4(),
        metadata: { width: 1920, height: 1080, durationSeconds: 42 },
      },
      STAFF,
    );
    const audio = await uploadAsset.call(
      {
        filename: "voice.mp3",
        contentType: "audio/mpeg",
        bytes: mp3(),
        metadata: { durationSeconds: 17 },
      },
      STAFF,
    );
    expect(video).toMatchObject({
      kind: "video",
      width: 1920,
      height: 1080,
      durationSeconds: 42,
    });
    expect(audio).toMatchObject({ kind: "audio", durationSeconds: 17 });
    await expect(resolveAsset.call({ id: video.id }, ANONYMOUS)).resolves.toMatchObject({
      kind: "video",
      mime: "video/mp4",
    });
    await expect(resolveAsset.call({ id: audio.id }, ANONYMOUS)).resolves.toMatchObject({
      kind: "audio",
      mime: "audio/mpeg",
    });
  });

  it("refuses a damaged file that only claims to be an image", async () => {
    const error = await failure(
      uploadAsset.call(
        {
          filename: "fake.png",
          contentType: "image/png",
          bytes: new Uint8Array(Buffer.from("not a png")),
        },
        STAFF,
      ),
    );
    expect(error.code).toBe("validation");
    expect((await listAssets.call({}, STAFF)).total).toBe(0);
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

  it("keeps a generated suggestion separate until a person accepts it", async () => {
    let preview: { bytes: number; contentType: string } | undefined;
    setAltTextSuggesterForTests({
      id: "test-vision",
      model: "deterministic-v1",
      available: true,
      async suggest(input) {
        preview = {
          bytes: input.image.byteLength,
          contentType: input.contentType,
        };
        return {
          text: "A blue square on a plain background",
          provider: "test-vision",
          model: "deterministic-v1",
        };
      },
    });
    const asset = await uploadAsset.call(
      { filename: "suggest.png", contentType: "image/png", bytes: await png(1200, 800) },
      STAFF,
    );

    const suggested = await generateAltTextSuggestion.call({ id: asset.id }, STAFF);
    expect(suggested).toMatchObject({
      status: "ready",
      suggestion: "A blue square on a plain background",
      requestedBy: `user:${STAFF.userId}`,
    });
    expect(preview?.contentType).toBe("image/webp");
    expect(preview!.bytes).toBeLessThan(asset.bytes);
    expect((await getAsset.call({ id: asset.id }, STAFF)).altText).toBeNull();
    expect(
      (await altTextSuggestionState.call({ id: asset.id }, STAFF)).suggestion,
    ).toMatchObject({ id: suggested.id, status: "ready" });
    expect(
      (await listAltTextSuggestionStates.call({ ids: [asset.id] }, STAFF))
        .suggestions,
    ).toEqual([expect.objectContaining({ id: suggested.id })]);

    await acceptAltTextSuggestion.call(
      {
        id: asset.id,
        suggestionId: suggested.id,
        altText: "A blue square against a plain background",
      },
      STAFF,
    );
    expect((await getAsset.call({ id: asset.id }, STAFF)).altText).toBe(
      "A blue square against a plain background",
    );
    const [reviewed] = await db()
      .select()
      .from(mediaAltTextSuggestions)
      .where(eq(mediaAltTextSuggestions.id, suggested.id));
    expect(reviewed).toMatchObject({
      status: "accepted",
      reviewedBy: `user:${STAFF.userId}`,
    });
    expect(reviewed!.reviewedAt).toBeInstanceOf(Date);
  });

  it("never lets a pending suggestion overwrite newer authored alt text", async () => {
    setAltTextSuggesterForTests({
      id: "test-vision",
      model: "deterministic-v1",
      available: true,
      async suggest() {
        return {
          text: "Generated words",
          provider: "test-vision",
          model: "deterministic-v1",
        };
      },
    });
    const asset = await uploadAsset.call(
      { filename: "authored.png", contentType: "image/png", bytes: await png(100, 100) },
      STAFF,
    );
    const suggested = await generateAltTextSuggestion.call({ id: asset.id }, STAFF);
    await setAltText.call({ id: asset.id, altText: "Written by a person" }, STAFF);

    const error = await failure(
      acceptAltTextSuggestion.call(
        { id: asset.id, suggestionId: suggested.id, altText: suggested.suggestion },
        STAFF,
      ),
    );
    expect(error.code).toBe("conflict");
    expect((await getAsset.call({ id: asset.id }, STAFF)).altText).toBe(
      "Written by a person",
    );
  });

  it("refuses acceptance after the image leaves the verified ready state", async () => {
    setAltTextSuggesterForTests({
      id: "test-vision",
      model: "deterministic-v1",
      available: true,
      async suggest() {
        return {
          text: "Generated words",
          provider: "test-vision",
          model: "deterministic-v1",
        };
      },
    });
    const asset = await uploadAsset.call(
      {
        filename: "trashed-review.png",
        contentType: "image/png",
        bytes: await png(100, 100),
      },
      STAFF,
    );
    const suggested = await generateAltTextSuggestion.call({ id: asset.id }, STAFF);
    await deleteAsset.call({ id: asset.id }, OWNER);

    const error = await failure(
      acceptAltTextSuggestion.call(
        { id: asset.id, suggestionId: suggested.id, altText: suggested.suggestion },
        STAFF,
      ),
    );
    expect(error.code).toBe("conflict");
    expect((await getAsset.call({ id: asset.id }, STAFF)).altText).toBeNull();
  });

  it("dismisses a proposal without changing authored alt text", async () => {
    setAltTextSuggesterForTests({
      id: "test-vision",
      model: "deterministic-v1",
      available: true,
      async suggest() {
        return {
          text: "Not useful",
          provider: "test-vision",
          model: "deterministic-v1",
        };
      },
    });
    const asset = await uploadAsset.call(
      {
        filename: "dismiss.png",
        contentType: "image/png",
        bytes: await png(100, 100),
        altText: "Existing authored description",
      },
      STAFF,
    );
    const suggested = await generateAltTextSuggestion.call({ id: asset.id }, STAFF);
    await dismissAltTextSuggestion.call(
      { id: asset.id, suggestionId: suggested.id },
      STAFF,
    );
    expect((await getAsset.call({ id: asset.id }, STAFF)).altText).toBe(
      "Existing authored description",
    );
    expect(
      (await altTextSuggestionState.call({ id: asset.id }, STAFF)).suggestion,
    ).toBeNull();
  });

  it("keeps generation and review human-only", async () => {
    setAltTextSuggesterForTests({
      id: "test-vision",
      model: "deterministic-v1",
      available: true,
      async suggest() {
        return { text: "Words", provider: "test-vision", model: "deterministic-v1" };
      },
    });
    const asset = await uploadAsset.call(
      { filename: "human.png", contentType: "image/png", bytes: await png(50, 50) },
      STAFF,
    );
    const error = await failure(
      generateAltTextSuggestion.call(
        { id: asset.id },
        { kind: "agent", keyName: "robot", scopes: ["media.*"] },
      ),
    );
    expect(error.code).toBe("permission");
  });

  it("trashes reversibly, restores, then purges every stored object", async () => {
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

    const revoked = await serveMedia(
      new Request(`http://localhost/media/${asset.storageKey}`),
      { params: Promise.resolve({ key: asset.storageKey.split("/") }) },
    );
    expect(revoked.status).toBe(404);

    const store = storage();
    for (const key of keys) {
      expect(await store.get(key), `${key} was deleted before purge`).toBeDefined();
    }
    expect((await listAssets.call({}, STAFF)).total).toBe(0);
    const trashed = await getAsset.call({ id: asset.id }, STAFF);
    expect(trashed.status).toBe("trashed");
    expect(trashed.purgeAfter!.getTime() - trashed.deletedAt!.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );

    await restoreAsset.call({ id: asset.id }, OWNER);
    expect((await listAssets.call({}, STAFF)).total).toBe(1);
    await deleteAsset.call({ id: asset.id }, OWNER);
    await purgeAsset.call(
      { id: asset.id, confirmation: asset.filename },
      OWNER,
    );
    for (const key of keys) {
      expect(await store.get(key), `${key} still in storage`).toBeUndefined();
    }
    expect(
      (await listAssets.call({ status: "trashed" }, STAFF)).total,
    ).toBe(0);
  });

  it("requires media manage for deletion", async () => {
    const asset = await uploadAsset.call(
      { filename: "a.png", contentType: "image/png", bytes: await png(50, 50) },
      STAFF,
    );
    const error = await failure(
      deleteAsset.call(
        { id: asset.id },
        {
          ...STAFF,
          grants: [{ module: "media", access: "view" }],
        },
      ),
    );
    expect(error.code).toBe("permission");
  });

  it("keeps permanent purge owner-only and exact", async () => {
    const asset = await uploadAsset.call(
      { filename: "owned.png", contentType: "image/png", bytes: await png(50, 50) },
      STAFF,
    );
    await deleteAsset.call({ id: asset.id }, OWNER);
    expect(
      (
        await failure(
          purgeAsset.call(
            { id: asset.id, confirmation: "wrong.png" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
    expect(
      (
        await failure(
          purgeAsset.call(
            { id: asset.id, confirmation: asset.filename },
            STAFF,
          ),
        )
      ).code,
    ).toBe("permission");
  });

  it("allows only lifecycle maintenance to purge expired trash", async () => {
    const asset = await uploadAsset.call(
      { filename: "expired.png", contentType: "image/png", bytes: await png(50, 50) },
      STAFF,
    );
    await deleteAsset.call({ id: asset.id }, OWNER);
    await db()
      .update(assets)
      .set({ purgeAfter: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(assets.id, asset.id));
    expect(
      (
        await failure(
          purgeExpiredAsset.call(
            { id: asset.id, asOf: "2020-01-02T00:00:00.000Z" },
            STAFF,
          ),
        )
      ).code,
    ).toBe("permission");
    await expect(
      purgeExpiredAsset.call(
        { id: asset.id, asOf: "2020-01-02T00:00:00.000Z" },
        { kind: "system" },
      ),
    ).resolves.toMatchObject({ assetId: asset.id });
    expect((await listAssets.call({ status: "trashed" }, STAFF)).total).toBe(0);
  });

  it("stores focal point, metadata, and provenance edits", async () => {
    const asset = await uploadAsset.call(
      { filename: "crop.png", contentType: "image/png", bytes: await png(80, 60) },
      STAFF,
    );
    const focal = await setFocalPoint.call(
      { id: asset.id, x: 2400, y: 8100 },
      STAFF,
    );
    expect([focal.focalX, focal.focalY]).toEqual([2400, 8100]);
    const detailed = await updateAssetDetails.call(
      {
        id: asset.id,
        metadata: { codec: "png" },
        provenance: { sourceUrl: "https://example.test/original" },
      },
      STAFF,
    );
    expect(detailed.metadata).toMatchObject({ codec: "png" });
    expect(detailed.provenance).toMatchObject({
      sourceUrl: "https://example.test/original",
      lastEditedBy: `user:${STAFF.userId}`,
    });
  });

  it("reserves a truthful proxy fallback when direct multipart is unavailable", async () => {
    const reservation = await beginUpload.call(
      {
        filename: "voice.mp3",
        contentType: "audio/mpeg",
        bytes: 1024,
      },
      STAFF,
    );
    expect(reservation.strategy).toBe("proxy");
    const [row] = await db()
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, reservation.id));
    expect(row).toMatchObject({ state: "created", expectedBytes: 1024 });
  });

  it("returns the same asset when a proxy completion is retried", async () => {
    const body = mp3();
    const reservation = await beginUpload.call(
      {
        filename: "retry.mp3",
        contentType: "audio/mpeg",
        bytes: body.byteLength,
      },
      STAFF,
    );
    const first = await uploadAsset.call(
      {
        filename: "retry.mp3",
        contentType: "audio/mpeg",
        bytes: body,
        uploadId: reservation.id,
      },
      STAFF,
    );
    const retried = await uploadAsset.call(
      {
        filename: "retry.mp3",
        contentType: "audio/mpeg",
        bytes: body,
        uploadId: reservation.id,
      },
      STAFF,
    );
    expect(retried.id).toBe(first.id);
    expect((await listAssets.call({}, STAFF)).total).toBe(1);
  });

  it("completes the private-S3 resumable path through validation and registration", async () => {
    const previous = { ...process.env };
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n"));
    let assembled = false;
    try {
      Object.assign(process.env, {
        FREEHOLDER_STORAGE: "s3",
        S3_ENDPOINT: "https://s3.example.test",
        S3_REGION: "test-1",
        S3_BUCKET: "media",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
        S3_PUBLIC: "false",
        MALWARE_SCANNER: "none",
      });
      resetEnvForTests();
      resetStorageForTests();
      resetMalwareScannerForTests();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "POST" && url.searchParams.has("uploads")) {
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
          );
        }
        if (request.method === "POST" && url.searchParams.get("uploadId")) {
          assembled = true;
          return new Response("<CompleteMultipartUploadResult />");
        }
        if (request.method === "HEAD") {
          if (!assembled) return new Response(null, { status: 404 });
          return new Response(null, {
            headers: {
              "content-length": String(pdf.byteLength),
              "content-type": "application/pdf",
            },
          });
        }
        if (request.method === "GET") {
          return new Response(pdf, {
            status: request.headers.has("range") ? 206 : 200,
            headers: { "content-type": "application/pdf" },
          });
        }
        return new Response(null, { status: 500 });
      });

      const reservation = await beginUpload.call(
        {
          filename: "large.pdf",
          contentType: "application/pdf",
          bytes: pdf.byteLength,
        },
        STAFF,
      );
      expect(reservation.strategy).toBe("direct_multipart");
      const signed = await signUploadParts.call(
        { id: reservation.id, partNumbers: [1] },
        STAFF,
      );
      expect(signed.parts[0]?.url).toContain("X-Amz-Signature");
      await expect(
        uploadStatus.call({ id: reservation.id }, STAFF),
      ).resolves.toMatchObject({ partCount: 1, partSize: 8 * 1024 * 1024 });
      const completed = await completeUpload.call(
        {
          id: reservation.id,
          parts: [{ partNumber: 1, etag: '"part-etag"' }],
        },
        STAFF,
      );
      expect(completed.ok).toBe(true);
      if (completed.ok) {
        expect(completed.asset).toMatchObject({
          kind: "doc",
          mime: "application/pdf",
          status: "ready",
        });
      }
      const retried = await completeUpload.call(
        {
          id: reservation.id,
          parts: [{ partNumber: 1, etag: '"part-etag"' }],
        },
        STAFF,
      );
      expect(retried).toMatchObject({
        ok: true,
        asset: { id: completed.ok ? completed.asset.id : "unreachable" },
      });
      const [session] = await db()
        .select()
        .from(mediaUploads)
        .where(eq(mediaUploads.id, reservation.id));
      expect(session).toMatchObject({ state: "complete" });
      const [object] = await db()
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.uploadId, reservation.id));
      expect(object).toMatchObject({ role: "original", state: "attached" });
    } finally {
      vi.restoreAllMocks();
      process.env = previous;
      resetEnvForTests();
      resetStorageForTests();
      resetMalwareScannerForTests();
    }
  });

  it("sweeps expired upload reservations and their staged object ledger", async () => {
    const reservation = await beginUpload.call(
      {
        filename: "stale.pdf",
        contentType: "application/pdf",
        bytes: 12,
      },
      STAFF,
    );
    const old = new Date("2020-01-01T00:00:00.000Z");
    await db()
      .update(mediaUploads)
      .set({ expiresAt: old })
      .where(eq(mediaUploads.id, reservation.id));
    await db()
      .update(mediaObjects)
      .set({ createdAt: old })
      .where(eq(mediaObjects.uploadId, reservation.id));
    const result = await cleanupOrphanedMedia(
      new Date("2020-01-03T00:00:00.000Z"),
    );
    expect(result.expiredUploads).toBe(1);
    expect((await db().select().from(mediaObjects)).length).toBe(0);
  });
});

describe.runIf(hasDatabase)("knowing what a file is still used by", () => {
  beforeEach(async () => {
    await truncateSpine();
    resetStorageForTests();
  });

  it("finds a reference nested anywhere in a block tree", async () => {
    const asset = await uploadAsset.call(
      { filename: "used.png", contentType: "image/png", bytes: await png(200, 200) },
      STAFF,
    );

    // Deliberately nested: an image inside a columns block must be found as
    // readily as one at the top level, which is what `$.**` buys.
    await createPage.call(
      {
        slug: "nested",
        title: "Nested",
        blocks: [
          {
            id: "row",
            type: "columns",
            props: {},
            children: [
              { id: "img", type: "image", props: { assetId: asset.id } },
            ],
          },
        ],
      },
      STAFF,
    );

    expect(await assetUsage.call({ id: asset.id }, STAFF)).toEqual({
      pages: 1,
      sections: 0,
    });
  });

  it("reports nothing for a file no page mentions", async () => {
    const asset = await uploadAsset.call(
      { filename: "loose.png", contentType: "image/png", bytes: await png(120, 120) },
      STAFF,
    );
    await createPage.call({ slug: "other", title: "Other" }, STAFF);

    expect(await assetUsage.call({ id: asset.id }, STAFF)).toEqual({
      pages: 0,
      sections: 0,
    });
  });

  it("leaves a gap rather than breaking the page when a used file is deleted", async () => {
    // The whole reason usage is a warning and not a refusal: an owner may well
    // want the file gone, and the site must survive the decision.
    const asset = await uploadAsset.call(
      { filename: "doomed.png", contentType: "image/png", bytes: await png(300, 200) },
      STAFF,
    );
    const page = await createPage.call(
      {
        slug: "shows-it",
        title: "Shows it",
        blocks: [{ id: "img", type: "image", props: { assetId: asset.id } }],
      },
      STAFF,
    );
    await publishPage.call({ id: page.id, published: true }, STAFF);

    await deleteAsset.call({ id: asset.id }, OWNER);

    // The page is still there and still served; the image simply resolves to
    // nothing.
    expect(await resolvePage.call({ slug: "shows-it" }, ANONYMOUS)).not.toBeNull();
    expect(await resolveImage.call({ id: asset.id }, ANONYMOUS)).toBeNull();
  });
});
