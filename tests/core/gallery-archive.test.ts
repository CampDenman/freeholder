// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Packaged gallery delivery (MASTER.md §4.5, C8.07).
//
// The rules:
//
//   1. The ZIP this writes is a ZIP: it round-trips, entry for entry.
//   2. Two photographs with one filename stay two files.
//   3. The archive obeys the download policy — packaging is not a way around
//      the checks every single-file download makes.
//   4. A view-only gallery packages nothing.
//   5. A missing object fails loudly rather than shipping a short archive.
//   6. Asking twice while one is building is the same request.
//   7. The client is told when it is ready.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { inflateSync } from "node:zlib";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { storage } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addGalleryItem,
  buildGalleryArchive,
  createGallery,
  downloadGalleryArchive,
  requestGalleryArchive,
  unlockGallery,
} from "@/modules/galleries/service";
import { galleryArchives } from "@/modules/galleries/schema";
import { buildZip, uniqueNames, zipCeilingExceeded } from "@/modules/galleries/archive";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

/**
 * A deliberately independent reader: walks the end-of-central-directory record
 * back to each local header. Asserting with the same code that wrote the bytes
 * would prove only that it is self-consistent.
 */
function readZip(body: Uint8Array): { name: string; content: string }[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let eocd = body.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: { name: string; content: string }[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central header");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(body.subarray(at + 46, at + 46 + nameLength));

    if (view.getUint32(localAt, true) !== 0x04034b50) throw new Error("bad local header");
    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;
    const raw = body.subarray(dataAt, dataAt + size);
    out.push({
      name,
      content: decoder.decode(method === 0 ? raw : inflateSync(raw)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const enc = new TextEncoder();
const bytes = (text: string) => enc.encode(text);

describe("the gallery archive container", () => {
  it("round-trips through an independent reader", () => {
    const zip = buildZip([
      { name: "one.jpg", body: bytes("FIRST"), modifiedAt: new Date("2026-05-01T10:30:00Z") },
      { name: "two.jpg", body: bytes("SECOND"), modifiedAt: new Date("2026-05-01T10:31:00Z") },
    ]);
    expect(zip.entries).toBe(2);
    expect(readZip(zip.body)).toEqual([
      { name: "one.jpg", content: "FIRST" },
      { name: "two.jpg", content: "SECOND" },
    ]);
  });

  it("keeps two photographs with one filename as two files", () => {
    // A ZIP holding one path twice extracts as one file, quietly delivering
    // fewer images than the client chose.
    const names = uniqueNames(["beach.jpg", "beach.jpg", "beach.jpg"]);
    expect(names).toEqual(["beach.jpg", "beach (1).jpg", "beach (2).jpg"]);
    const zip = buildZip(
      names.map((name, i) => ({
        name,
        body: bytes(`BODY-${i}`),
        modifiedAt: new Date("2026-05-01T10:30:00Z"),
      })),
    );
    expect(readZip(zip.body).map((e) => e.name)).toEqual(names);
  });

  it("strips path separators out of entry names", () => {
    // A name carrying a slash is a directory traversal in someone's unzip.
    expect(uniqueNames(["../../etc/passwd"])).toEqual([".._.._etc_passwd"]);
    expect(uniqueNames([String.raw`a\b.jpg`])).toEqual(["a_b.jpg"]);
  });

  it("clamps a pre-1980 timestamp instead of writing a negative year", () => {
    const zip = buildZip([
      { name: "old.jpg", body: bytes("OLD"), modifiedAt: new Date("1970-01-01T00:00:00Z") },
    ]);
    expect(readZip(zip.body)).toEqual([{ name: "old.jpg", content: "OLD" }]);
  });

  it("refuses a set the classic format cannot hold", () => {
    expect(zipCeilingExceeded([])).toBe(false);
    const many = Array.from({ length: 70_000 }, (_, i) => ({
      name: `${i}.jpg`,
      body: bytes("x"),
      modifiedAt: new Date(),
    }));
    expect(zipCeilingExceeded(many)).toBe(true);
  });
});

describe.runIf(hasDatabase)("packaging a gallery", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function storedImage(filename: string, body: string) {
    const key = `test/${crypto.randomUUID()}.jpg`;
    await storage().put(key, bytes(body), "image/jpeg");
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: key,
        filename,
        mime: "image/jpeg",
        legacyBytes: body.length,
        bytes: body.length,
        status: "ready",
      })
      .returning();
    return created!;
  }

  async function gallery(downloadPolicy: "none" | "full_res" = "full_res") {
    const client = await createContact.call(
      { name: "Rae Lane", email: "client@example.test" },
      OWNER,
    );
    const made = await createGallery.call(
      {
        contactId: client.id,
        title: "Delivery",
        access: "pin",
        secret: "2468",
        downloadPolicy,
      },
      OWNER,
    );
    return { client, gallery: made };
  }

  it("packages the deliverable files and serves them through the session", async () => {
    const { gallery: made } = await gallery();
    const one = await storedImage("one.jpg", "FIRST-IMAGE");
    const two = await storedImage("two.jpg", "SECOND-IMAGE");
    await addGalleryItem.call({ galleryId: made.id, assetId: one.id }, OWNER);
    await addGalleryItem.call({ galleryId: made.id, assetId: two.id }, OWNER);

    const opened = await unlockGallery.call({ slug: made.slug, secret: "2468" }, ANONYMOUS);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("expected the gallery to open");

    const queued = await requestGalleryArchive.call(
      { sessionToken: opened.sessionToken },
      ANONYMOUS,
    );
    expect(queued.state).toBe("building");
    // Asking twice while one is building is the same request, not a queue.
    expect(
      (await requestGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS)).state,
    ).toBe("building");

    const built = await buildGalleryArchive.call({ galleryId: made.id }, { kind: "system" });
    expect(built).toMatchObject({ state: "ready", fileCount: 2 });

    const handed = await downloadGalleryArchive.call(
      { sessionToken: opened.sessionToken },
      ANONYMOUS,
    );
    expect(handed?.filename).toBe(`${made.slug}.zip`);
    const body = await storage().get(handed!.storageKey);
    expect(readZip(body!).map((e) => e.content).sort()).toEqual([
      "FIRST-IMAGE",
      "SECOND-IMAGE",
    ]);
  });

  it("packages nothing for a view-only gallery", async () => {
    const { gallery: made } = await gallery("none");
    const one = await storedImage("one.jpg", "FIRST-IMAGE");
    await addGalleryItem.call({ galleryId: made.id, assetId: one.id }, OWNER);
    const opened = await unlockGallery.call({ slug: made.slug, secret: "2468" }, ANONYMOUS);
    if (!opened.ok) throw new Error("expected the gallery to open");
    // Packaging must not become the way around every per-file check.
    expect(
      (await failure(requestGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS)))
        .message,
    ).toContain("view-only");
  });

  it("fails loudly when a file is missing rather than shipping a short archive", async () => {
    const { gallery: made } = await gallery();
    const one = await storedImage("one.jpg", "FIRST-IMAGE");
    await addGalleryItem.call({ galleryId: made.id, assetId: one.id }, OWNER);
    await storage().delete(one.storageKey);

    await db().insert(galleryArchives).values({ galleryId: made.id, state: "building" });
    const built = await buildGalleryArchive.call({ galleryId: made.id }, { kind: "system" });
    expect(built.state).toBe("failed");
    expect(built.error).toContain("missing");

    const [stored] = await db()
      .select()
      .from(galleryArchives)
      .where(eq(galleryArchives.galleryId, made.id));
    expect(stored!.storageKey).toBeNull();
  });

  it("refuses to package for anyone but the platform", async () => {
    const { gallery: made } = await gallery();
    // Refused at the permission layer before the handler is reached, which is
    // why the wording is the framework's rather than this service's. What
    // matters is that an anonymous caller cannot read every file in a gallery.
    const refusal = await failure(
      buildGalleryArchive.call({ galleryId: made.id }, ANONYMOUS),
    );
    expect(refusal.code).toBe("permission");
  });
});
