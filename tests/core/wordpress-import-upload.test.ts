// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-size WordPress exports: streamed WXR reading and the chunked upload
// (C3.22). The large export is generated here from fictional content.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { DEFAULT_JSON_BODY_LIMIT } from "@/core/http/body";
import {
  parseWordpressExport,
  wordpressExportBuilder,
  WxrStreamReader,
} from "@/core/import/wordpress";
import { startImport } from "@/core/import/service";
import {
  beginSourceUpload,
  IMPORT_SOURCE_CHUNK_BYTES,
  IMPORT_SOURCE_MAX_BYTES,
  previewFromUpload,
  sourceLooksRight,
  uploadSourceChunk,
} from "@/core/import/source-upload";
import { POST as postChunk } from "../../app/api/imports/source/chunk/route";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const FIXTURE = readFileSync(
  fileURLToPath(new URL("../fixtures/wordpress/sample-export.xml", import.meta.url)),
  "utf8",
);

const WORDS = ["clay", "kiln", "glaze", "wheel", "slip", "bisque", "ash", "flame", "cone", "shelf", "wedge", "trim"];

/** A fictional export of `posts` posts, each with a long body and comments. */
function largeExport(posts: number): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8" ?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">\n<channel>\n<title><![CDATA[Fernwood Kiln Archive]]></title>\n<link>https://old.example.org</link>\n<wp:base_site_url>https://old.example.org</wp:base_site_url>\n<wp:base_blog_url>https://old.example.org</wp:base_blog_url>\n`,
  ];
  for (let n = 0; n < posts; n += 1) {
    const paragraphs = Array.from({ length: 16 }, (_, p) =>
      `<p>${Array.from({ length: 90 }, (_, w) => WORDS[(n + p + w) % WORDS.length]).join(" ")} ${"é"} <!-- not an </item> --></p>`,
    ).join("\n");
    const comments = Array.from({ length: 4 }, (_, c) =>
      `<wp:comment><wp:comment_id>${n * 10 + c}</wp:comment_id><wp:comment_content><![CDATA[${"A thoughtful note about the firing. ".repeat(30)}]]></wp:comment_content><wp:comment_approved><![CDATA[1]]></wp:comment_approved></wp:comment>`,
    ).join("\n");
    parts.push(
      `<item><title><![CDATA[Firing log ${n}]]></title><link>https://old.example.org/${2020 + (n % 5)}/0${1 + (n % 9)}/firing-log-${n}/</link><dc:creator><![CDATA[maple]]></dc:creator><content:encoded><![CDATA[<!-- wp:paragraph -->\n${paragraphs}\n<!-- /wp:paragraph --> This CDATA says </item> and <item> on purpose.]]></content:encoded><wp:post_id>${1000 + n}</wp:post_id><wp:post_date_gmt><![CDATA[2024-0${1 + (n % 9)}-1${n % 10} 08:00:00]]></wp:post_date_gmt><wp:post_name><![CDATA[firing-log-${n}]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_type><![CDATA[post]]></wp:post_type><wp:post_password><![CDATA[]]></wp:post_password>${comments}</item>\n`,
    );
  }
  parts.push("</channel>\n</rss>\n");
  return parts.join("");
}

function streamed(xml: string, sizes: number[]) {
  const builder = wordpressExportBuilder();
  const reader = builder.reader();
  let at = 0;
  let turn = 0;
  while (at < xml.length) {
    const size = sizes[turn % sizes.length]!;
    reader.push(xml.slice(at, at + size));
    at += size;
    turn += 1;
  }
  reader.end();
  return builder.finish();
}

const LARGE = largeExport(450);
const LARGE_BYTES = new TextEncoder().encode(LARGE);

describe("streamed WXR reading (C3.22)", () => {
  it("reads the same export whatever the chunk boundaries", () => {
    const whole = parseWordpressExport(FIXTURE);
    for (const sizes of [[1], [7], [13, 2, 61], [64], [1024]]) {
      expect(streamed(FIXTURE, sizes)).toEqual(whole);
    }
  });

  it("reads a multi-megabyte export in pieces, items quoting </item> intact", () => {
    expect(LARGE_BYTES.byteLength).toBeGreaterThan(4 * DEFAULT_JSON_BODY_LIMIT);
    const exported = streamed(LARGE, [65_536, 4_099]);
    expect(exported.items).toHaveLength(450);
    expect(exported.items[449]).toMatchObject({ slug: "firing-log-449", comments: { total: 4, approved: 4 } });
    expect(exported.items[0]!.body).toContain("says </item> and <item> on purpose");
    expect(exported).toEqual(parseWordpressExport(LARGE));
  });

  it("holds one item at a time, not the export", () => {
    let largest = 0;
    let items = 0;
    const reader = new WxrStreamReader(
      () => undefined,
      (xml) => {
        largest = Math.max(largest, xml.length);
        items += 1;
      },
    );
    const buffered: number[] = [];
    for (let at = 0; at < LARGE.length; at += 65_536) {
      reader.push(LARGE.slice(at, at + 65_536));
      buffered.push((reader as unknown as { buffer: string }).buffer.length);
    }
    reader.end();
    expect(items).toBe(450);
    expect(Math.max(...buffered)).toBeLessThan(largest + 65_536 + 16);
  });

  it("refuses an export cut off mid-item", () => {
    const reader = wordpressExportBuilder().reader();
    reader.push(FIXTURE.slice(0, FIXTURE.indexOf("</item>") - 5));
    expect(() => reader.end()).toThrow(/middle of an item/);
  });

  it("sniffs the first bytes against the run's source kind", () => {
    expect(sourceLooksRight("wordpress-wxr", FIXTURE.slice(0, 4096))).toBe(true);
    expect(sourceLooksRight("wordpress-wxr", "﻿  <?xml version='1.0'?><rss version='2.0'>")).toBe(true);
    expect(sourceLooksRight("wordpress-wxr", "<html><body>hi</body></html>")).toBe(false);
    expect(sourceLooksRight("wordpress-wxr", "\u0089PNG\r\n\u001a\n\u0000\u0000")).toBe(false);
    expect(sourceLooksRight("wordpress-rest", '[{"id":1}]')).toBe(true);
    expect(sourceLooksRight("html", "<!doctype html>")).toBe(true);
  });
});

describe("the chunk route (C3.22)", () => {
  it("bounds a chunk at its own size without changing the JSON limit", async () => {
    expect(IMPORT_SOURCE_CHUNK_BYTES).toBeLessThan(10 * 1024 * 1024);
    expect(DEFAULT_JSON_BODY_LIMIT).toBe(1024 * 1024);
    const tooBig = await postChunk(
      new Request("https://site.example/api/imports/source/chunk?id=00000000-0000-4000-8000-000000000001&uploadId=00000000-0000-4000-8000-000000000002&index=0", {
        method: "POST",
        headers: { "content-length": String(IMPORT_SOURCE_CHUNK_BYTES + 1) },
        body: new Uint8Array(IMPORT_SOURCE_CHUNK_BYTES + 1),
      }),
    );
    expect(tooBig.status).toBe(413);
    const anonymous = await postChunk(
      new Request("https://site.example/api/imports/source/chunk?id=00000000-0000-4000-8000-000000000001&uploadId=00000000-0000-4000-8000-000000000002&index=0", {
        method: "POST",
        body: new TextEncoder().encode("<rss>"),
      }),
    );
    expect([401, 403]).toContain(anonymous.status);
  });
});

describe.runIf(hasDatabase)("chunked export upload", { timeout: 120_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    resetStorageForTests();
  });
  afterAll(closeDb);

  async function upload(bytes: Uint8Array) {
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    const reserved = await beginSourceUpload.call({ id: run.id, filename: "export.xml", bytes: bytes.byteLength }, OWNER);
    return { run, reserved };
  }

  it("stages a multi-megabyte export sent in chunks, then deletes the chunks", async () => {
    const { run, reserved } = await upload(LARGE_BYTES);
    expect(reserved.chunkCount).toBe(Math.ceil(LARGE_BYTES.byteLength / IMPORT_SOURCE_CHUNK_BYTES));
    expect(reserved.chunkCount).toBeGreaterThan(1);
    // Out of order on purpose: the reader puts them back in sequence.
    for (const index of [...Array(reserved.chunkCount).keys()].reverse()) {
      const part = LARGE_BYTES.subarray(index * reserved.chunkBytes, (index + 1) * reserved.chunkBytes);
      await uploadSourceChunk.call({ id: run.id, uploadId: reserved.uploadId, index, bytes: part }, OWNER);
    }
    const key = `imports/${run.id}/${reserved.uploadId}/00000.part`;
    expect(await storage().get(key)).toBeDefined();
    const staged = await previewFromUpload.call({ id: run.id, uploadId: reserved.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "previewed", counts: { pages: 450, posts: 450, commentsSkipped: 1800 } });
    expect(await storage().get(key)).toBeUndefined();
  });

  it("refuses an oversized file, a wrong-sized chunk, the wrong kind of file and an early finish", async () => {
    const run = await startImport.call({ origin: "https://old.example.org", kind: "wordpress-wxr" }, OWNER);
    await expect(
      failure(beginSourceUpload.call({ id: run.id, filename: "huge.xml", bytes: IMPORT_SOURCE_MAX_BYTES + 1 }, OWNER)),
    ).resolves.toMatchObject({ code: "validation" });

    const { run: second, reserved } = await upload(LARGE_BYTES);
    await expect(
      failure(uploadSourceChunk.call({ id: second.id, uploadId: reserved.uploadId, index: 0, bytes: LARGE_BYTES.subarray(0, 10) }, OWNER)),
    ).resolves.toMatchObject({ code: "validation" });
    const image = new Uint8Array(IMPORT_SOURCE_CHUNK_BYTES);
    image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      failure(uploadSourceChunk.call({ id: second.id, uploadId: reserved.uploadId, index: 0, bytes: image }, OWNER)),
    ).resolves.toMatchObject({ code: "validation", message: expect.stringMatching(/WordPress export/) as unknown });
    await uploadSourceChunk.call(
      { id: second.id, uploadId: reserved.uploadId, index: 0, bytes: LARGE_BYTES.subarray(0, reserved.chunkBytes) },
      OWNER,
    );
    await expect(
      failure(previewFromUpload.call({ id: second.id, uploadId: reserved.uploadId }, OWNER)),
    ).resolves.toMatchObject({ code: "conflict" });
  });

  it("keeps an upload to the person who started it", async () => {
    const { run, reserved } = await upload(LARGE_BYTES);
    const part = LARGE_BYTES.subarray(0, reserved.chunkBytes);
    await expect(
      failure(uploadSourceChunk.call({ id: run.id, uploadId: reserved.uploadId, index: 0, bytes: part }, ANONYMOUS)),
    ).resolves.toMatchObject({ code: "permission" });
    const other = await failure(uploadSourceChunk.call({ id: run.id, uploadId: reserved.uploadId, index: 0, bytes: part }, STAFF));
    expect(["not_found", "permission"]).toContain(other.code);
  });

  it("records a file that is not a readable export as a failed run", async () => {
    const broken = new TextEncoder().encode(`${LARGE.slice(0, 200_000)}`);
    const { run, reserved } = await upload(broken);
    await uploadSourceChunk.call({ id: run.id, uploadId: reserved.uploadId, index: 0, bytes: broken }, OWNER);
    const staged = await previewFromUpload.call({ id: run.id, uploadId: reserved.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "failed", error: expect.stringMatching(/middle of an item/) as unknown });
  });
});
