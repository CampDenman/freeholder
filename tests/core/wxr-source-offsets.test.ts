// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { WxrStreamReader, type WxrSourceRange } from "@/core/import/wordpress";

function read(bytes: Uint8Array, size: number, onHead: (xml: string, range: WxrSourceRange) => void, onItem: (xml: string, range: WxrSourceRange) => void, resume?: { offset: number; headerRead: boolean }) {
  const reader = new WxrStreamReader(onHead, onItem, resume), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let index = 0; index < bytes.length; index += size) reader.push(decoder.decode(bytes.slice(index, index + size), { stream: true }));
  reader.push(decoder.decode()); reader.end();
}

describe("original WXR byte offsets (C3.47)", () => {
  const items = ['<item><title>Crème 😀</title><content><![CDATA[<p>Fake </item> marker</p>]]></content></item>', '<item><!-- fake <item> --><title>العربية</title></item>'];
  const raw = `\uFEFF<rss><channel><title>Source café</title>${items[0]}\r\n😀😀😀😀😀😀😀😀😀${items[1]}</channel></rss>`, bytes = new TextEncoder().encode(raw);
  it.each([1, 2, 7, 19, 4_096])("indexes exact original spans across %i-byte chunks", size => {
    const found: Array<{ xml: string; range: WxrSourceRange }> = [];
    let head = "";
    read(bytes, size, (xml, range) => { head = xml; expect(new TextDecoder().decode(bytes.slice(range.start, range.end))).toBe(xml.replace(/^\uFEFF/, "")); }, (xml, range) => found.push({ xml, range }));
    expect(head).toContain("Source café"); expect(found.map(row => row.xml)).toEqual(items);
    for (const row of found) expect(new TextDecoder().decode(bytes.slice(row.range.start, row.range.end))).toBe(row.xml);
  });
  it("resumes from a verified entry boundary without replaying the header or previous item", () => {
    const ranges: WxrSourceRange[] = [];
    read(bytes, 11, () => undefined, (_xml, range) => ranges.push(range));
    const found: string[] = [], offset = ranges[0]!.end;
    read(bytes.slice(offset), 3, () => { throw new Error("The immutable header must not be reread as another header."); }, (xml, range) => {
      found.push(xml); expect(new TextDecoder().decode(bytes.slice(range.start, range.end))).toBe(xml);
    }, { offset, headerRead: true });
    expect(found).toEqual([items[1]]);
  });
  it("refuses an unfinished item and invalid source cursors", () => {
    const reader = new WxrStreamReader(() => undefined, () => undefined);
    reader.push("<rss><channel><item>unfinished"); expect(() => reader.end()).toThrow(/middle/);
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => new WxrStreamReader(() => undefined, () => undefined, { offset, headerRead: true })).toThrow(/cursor/);
  });
});
