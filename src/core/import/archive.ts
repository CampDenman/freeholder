// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: bounded ZIP reading from private object storage. Never extract a path
// to the filesystem or treat a static export as a WordPress export.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { fromRandomAccessReaderPromise, RandomAccessReader, type Entry, type ZipFile } from "yauzl";
import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS } from "./contract";
import { parseSemanticHtml } from "./parsers";
import { toCmsSlug, type WordpressSeo } from "./wordpress";

export const ARCHIVE_LIMITS = {
  compressedBytes: 100 * 1024 * 1024,
  expandedBytes: 100 * 1024 * 1024,
  entries: 2_000,
  pages: DEFAULT_IMPORTER_LIMITS.maxPages,
  bodyBytes: DEFAULT_IMPORTER_LIMITS.maxBytes,
  pageBytes: 2 * 1024 * 1024,
  mediaFiles: 500,
  mediaBytes: 25 * 1024 * 1024,
  depth: 20,
  timeoutMs: 60_000,
} as const;

export interface ArchiveSource {
  bytes: number;
  /** End is exclusive. The implementation must return exactly this range. */
  readRange(start: number, end: number): Promise<Uint8Array>;
}
export type ArchivePage = {
  url: string;
  slug: string;
  title: string;
  body: string;
  kind: "page";
  status: "publish";
  sourcePath: string;
  redirectFrom?: string;
  seo: WordpressSeo;
};
export type ArchiveAsset = {
  path: string;
  key: string;
  sourceUrl: string;
  filename: string;
  digest: string;
  bytes: number;
  aliases: string[];
  referenced: boolean;
  altText?: string;
};
export type ArchiveResult = {
  pages: ArchivePage[];
  assets: ArchiveAsset[];
  site: { url: string; hosts: string[]; basePath: string };
  report: { entries: number; expandedBytes: number; ignored: string[]; unresolvedImages: string[]; root: string };
};

const HTML = /\.html?$/i;
const MEDIA = /\.(?:avif|gif|jpe?g|png|webp|svg|mp4|webm|mp3|wav|ogg|m4a|pdf)$/i;
const BIDI_OR_CONTROL = /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/;

function safePath(path: string): string {
  if (!path || path.length > 1_024 || path.includes("\\") || BIDI_OR_CONTROL.test(path) || /^(?:\/|[a-z]:)/i.test(path)) throw new Error("The ZIP contains an unsafe entry path.");
  const parts = path.replace(/\/$/, "").split("/");
  if (parts.length > ARCHIVE_LIMITS.depth || parts.some((part) => !part || part === "." || part === "..")) throw new Error("The ZIP contains an unsafe or excessively deep entry path.");
  return path.normalize("NFC");
}
function regularEntry(entry: Entry): void {
  const mode = entry.externalFileAttributes >>> 16;
  const kind = mode & 0xf000;
  if (kind && kind !== 0x8000 && kind !== 0x4000) throw new Error("The ZIP contains a symlink or special filesystem entry.");
  if ((entry.generalPurposeBitFlag & 0x41) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
  if (![0, 8].includes(entry.compressionMethod)) throw new Error("The ZIP uses an unsupported compression method.");
  for (const size of [entry.compressedSize, entry.uncompressedSize]) if (!Number.isSafeInteger(size) || size < 0) throw new Error("The ZIP contains an invalid entry size.");
}

class SourceReader extends RandomAccessReader {
  private readBytes = 0;
  private reads = 0;
  constructor(private readonly source: ArchiveSource, private readonly deadline: number) { super(); }
  override _readStreamForRange(start: number, end: number): Readable {
    const source = this.source;
    const checked = async (from: number, to: number) => {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > source.bytes) throw new Error("The ZIP refers to bytes outside the uploaded file.");
      this.readBytes += to - from;
      if (++this.reads > 20_000 || this.readBytes > source.bytes * 3 + 8 * 1024 * 1024 || Date.now() > this.deadline) throw new Error("The ZIP exceeds its bounded read budget.");
      const bytes = await source.readRange(from, to);
      if (bytes.byteLength !== to - from) throw new Error("Part of the uploaded ZIP is missing or changed.");
      return Buffer.from(bytes);
    };
    return Readable.from((async function* () {
      for (let offset = start; offset < end; offset += 64 * 1024) yield await checked(offset, Math.min(end, offset + 64 * 1024));
    })());
  }
}

// ZIP CRC detects damaged source bytes; SHA-256 binds each retained private
// asset to its immutable manifest. CRC is not treated as authentication.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
async function readEntry(zip: ZipFile, entry: Entry, maxBytes: number, deadline: number): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) throw new Error("An archive entry exceeds its allowed size.");
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0, crc = 0xffffffff;
  try {
    for await (const value of stream) {
      const chunk = value as Buffer;
      size += chunk.byteLength;
      if (size > maxBytes || Date.now() > deadline) throw new Error("An archive entry exceeds its read budget.");
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
      chunks.push(chunk);
    }
  } finally { stream.destroy(); }
  if (size !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) throw new Error("An archive entry is truncated or has a damaged checksum.");
  return Buffer.concat(chunks, size);
}

function elements(document: DefaultTreeAdapterTypes.Node): DefaultTreeAdapterTypes.Element[] {
  const out: DefaultTreeAdapterTypes.Element[] = [], pending = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node) out.push(node);
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
  }
  return out;
}
function attr(node: DefaultTreeAdapterTypes.Element | undefined, name: string): string | undefined { return node?.attrs.find((attribute) => attribute.name === name)?.value; }
function setAttr(node: DefaultTreeAdapterTypes.Element, name: string, value: string): void {
  const attribute = node.attrs.find((attribute) => attribute.name === name);
  if (attribute) attribute.value = value;
}
function archiveUrl(path: string, base: URL): string {
  return new URL(path.split("/").map((part) => encodeURIComponent(part)).join("/"), base).href;
}

/**
 * Read all directory metadata before retaining any asset. Imported asset bytes
 * go only through the supplied private-storage sink, never archive filenames.
 */
export async function readStaticArchive(source: ArchiveSource, origin: string, retain: (asset: ArchiveAsset, bytes: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<ArchiveResult> {
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 22 || source.bytes > ARCHIVE_LIMITS.compressedBytes) throw new Error("The ZIP is empty or exceeds the 100 MB upload limit.");
  const base = assertPublicHttpUrl(origin);
  if (base.search || base.hash) throw new Error("An archive source must be a public site URL without a query or fragment.");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const deadline = Date.now() + ARCHIVE_LIMITS.timeoutMs;
  const zip = await fromRandomAccessReaderPromise(new SourceReader(source, deadline), source.bytes, { autoClose: false, lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true });
  try {
    const entries: Array<{ entry: Entry; path: string }> = [];
    const paths = new Set<string>();
    let expandedBytes = 0, count = 0;
    for await (const entry of zip.eachEntry()) {
      if (++count > ARCHIVE_LIMITS.entries || Date.now() > deadline) throw new Error("The ZIP exceeds the entry or time limit.");
      regularEntry(entry);
      const path = safePath(entry.fileName);
      const folded = path.toLocaleLowerCase("en");
      if (paths.has(folded)) throw new Error("The ZIP contains duplicate or ambiguous entry paths.");
      paths.add(folded);
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > ARCHIVE_LIMITS.expandedBytes) throw new Error("The ZIP expands beyond the 100 MB read limit.");
      if (!path.endsWith("/")) entries.push({ entry, path });
    }
    const html = entries.filter(({ path }) => HTML.test(path));
    if (!html.length) throw new Error("The ZIP contains no static HTML pages.");
    if (html.length > ARCHIVE_LIMITS.pages) throw new Error("This ZIP exceeds the current 500-page import batch. No pages were staged.");
    const useful = entries.filter(({ path }) => HTML.test(path) || MEDIA.test(path));
    const first = useful[0]!.path.split("/")[0]!;
    const root = useful.every(({ path }) => path.includes("/") && path.startsWith(`${first}/`)) && useful.some(({ path }) => /^index\.html?$/i.test(path.slice(first.length + 1))) ? `${first}/` : "";
    const assetEntries = entries.filter(({ path }) => MEDIA.test(path));
    if (assetEntries.length > ARCHIVE_LIMITS.mediaFiles) throw new Error("This ZIP exceeds the current 500-file media batch. No pages were staged.");
    const assetByUrl = new Map<string, ArchiveAsset>();
    for (const { path, entry } of assetEntries) {
      const relative = path.slice(root.length);
      const sourceUrl = archiveUrl(relative, base);
      const key = new URL(sourceUrl).host.toLowerCase() + new URL(sourceUrl).pathname;
      assetByUrl.set(key, { path, key, sourceUrl, filename: relative.split("/").at(-1)!, digest: "", bytes: entry.uncompressedSize, aliases: [key], referenced: false });
    }
    const pages: ArchivePage[] = [], used = new Set<string>(), unresolvedImages = new Set<string>();
    let bodyBytes = 0;
    for (const { path, entry } of html) {
      const bytes = await readEntry(zip, entry, ARCHIVE_LIMITS.pageBytes, deadline);
      bodyBytes += bytes.byteLength;
      if (bodyBytes > ARCHIVE_LIMITS.bodyBytes) throw new Error("This ZIP exceeds the current 20 MB HTML batch. No pages were staged.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const url = archiveUrl(path.slice(root.length), base);
      const document = parse(text), nodes = elements(document);
      const declaredBase = nodes.find((node) => node.tagName === "base");
      const relativeBase = attr(declaredBase, "href");
      const documentBase = relativeBase ? new URL(relativeBase, url) : new URL(url);
      if (documentBase.origin !== base.origin || documentBase.username || documentBase.password) throw new Error("An archive page declares a base outside the approved source origin.");
      const meta = (name: string) => nodes.find((node) => node.tagName === "meta" && [attr(node, "name")?.toLowerCase(), attr(node, "property")?.toLowerCase()].includes(name));
      for (const node of nodes) {
        for (const name of node.tagName === "a" ? ["href"] : node.tagName === "img" || node.tagName === "source" ? ["src"] : []) {
          const value = attr(node, name);
          if (!value) continue;
          let resolved: URL;
          try { resolved = new URL(value, documentBase); } catch { continue; }
          if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) continue;
          setAttr(node, name, resolved.href);
          if (name === "src") {
            const asset = resolved.origin === base.origin ? assetByUrl.get(resolved.host.toLowerCase() + resolved.pathname) : undefined;
            if (asset) { asset.referenced = true; asset.altText ??= attr(node, "alt")?.slice(0, 500); }
            else if (unresolvedImages.size < 100) unresolvedImages.add(resolved.href);
          }
        }
      }
      const parsed = parseSemanticHtml(serialize(document), url);
      // The shared semantic preview sanitizer drops images. Keep the inert
      // source tree for the typed CMS converter, which owns final sanitizing.
      const content = nodes.find((node) => node.tagName === "article") ?? nodes.find((node) => node.tagName === "main") ?? nodes.find((node) => node.tagName === "body") ?? document;
      const sourcePath = new URL(url).pathname;
      let slug = toCmsSlug(sourcePath.replace(/(?:^|\/)index\.html?$/i, "").replace(/\.html?$/i, ""));
      const originalSlug = slug;
      for (let n = 2; used.has(slug); n++) slug = `${originalSlug || "home"}-${n}`;
      used.add(slug);
      const robots = attr(meta("robots"), "content") ?? "";
      const description = meta("description");
      pages.push({ url, slug, sourcePath, title: parsed.title, body: serialize(content), kind: "page", status: "publish", ...(sourcePath !== `/${slug}` ? { redirectFrom: sourcePath.slice(1) } : {}), seo: { title: parsed.title.slice(0, 1_000), preserveTitle: true, ...(description ? { description: (attr(description, "content") ?? "").slice(0, 1_000), preserveDescription: true } : {}), ...(parsed.canonical ? { canonical: parsed.canonical } : {}), noindex: /(?:^|[\s,])noindex(?:[\s,]|$)/i.test(robots), nofollow: /(?:^|[\s,])nofollow(?:[\s,]|$)/i.test(robots) } });
    }
    // Every retained byte is validated and hashed before entering the manifest.
    for (const { path, entry } of assetEntries) {
      const url = new URL(archiveUrl(path.slice(root.length), base));
      const asset = assetByUrl.get(url.host.toLowerCase() + url.pathname)!;
      const bytes = await readEntry(zip, entry, ARCHIVE_LIMITS.mediaBytes, deadline);
      asset.digest = createHash("sha256").update(bytes).digest("hex");
      await retain(asset, new Uint8Array(bytes));
    }
    return { pages, assets: [...assetByUrl.values()], site: { url: base.href, hosts: [base.host.toLowerCase()], basePath: "" }, report: { entries: count, expandedBytes, ignored: entries.filter(({ path }) => !HTML.test(path) && !MEDIA.test(path)).slice(0, 100).map(({ path }) => path), unresolvedImages: [...unresolvedImages], root } };
  } finally { zip.close(); }
}
