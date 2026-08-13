// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Server-side upload validation. Browser MIME and filename are hints; the
// signature in the bytes decides what an original actually is.
import { extname } from "node:path";

export type MediaKind = "image" | "video" | "doc" | "audio";

export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 25 * 1024 * 1024,
  doc: 100 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
  video: 5 * 1024 * 1024 * 1024,
};

/** The app proxy is deliberately bounded; larger files require direct S3. */
export const PROXY_UPLOAD_LIMIT = 25 * 1024 * 1024;
export const SIGNATURE_BYTES = 64 * 1024;

/** First and last signature windows; ZIP containers describe entries at both ends. */
export function mediaSignatureSample(
  first: Uint8Array<ArrayBuffer>,
  last: Uint8Array<ArrayBuffer> = new Uint8Array(),
): Uint8Array<ArrayBuffer> {
  if (last.byteLength === 0) return first;
  const sample = new Uint8Array(first.byteLength + last.byteLength);
  sample.set(first, 0);
  sample.set(last, first.byteLength);
  return sample;
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

interface FileType {
  mime: string;
  kind: MediaKind;
  extensions: readonly string[];
}

const TYPES: readonly FileType[] = [
  { mime: "image/jpeg", kind: "image", extensions: [".jpg", ".jpeg"] },
  { mime: "image/png", kind: "image", extensions: [".png"] },
  { mime: "image/gif", kind: "image", extensions: [".gif"] },
  { mime: "image/webp", kind: "image", extensions: [".webp"] },
  { mime: "image/avif", kind: "image", extensions: [".avif"] },
  { mime: "video/mp4", kind: "video", extensions: [".mp4", ".m4v"] },
  { mime: "video/quicktime", kind: "video", extensions: [".mov"] },
  { mime: "video/webm", kind: "video", extensions: [".webm"] },
  { mime: "audio/mpeg", kind: "audio", extensions: [".mp3"] },
  { mime: "audio/wav", kind: "audio", extensions: [".wav"] },
  { mime: "audio/ogg", kind: "audio", extensions: [".ogg", ".oga"] },
  { mime: "audio/flac", kind: "audio", extensions: [".flac"] },
  { mime: "audio/mp4", kind: "audio", extensions: [".m4a"] },
  { mime: "application/pdf", kind: "doc", extensions: [".pdf"] },
  { mime: "text/plain", kind: "doc", extensions: [".txt", ".md"] },
  { mime: "text/csv", kind: "doc", extensions: [".csv"] },
  { mime: "application/json", kind: "doc", extensions: [".json"] },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "doc",
    extensions: [".docx"],
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "doc",
    extensions: [".xlsx"],
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "doc",
    extensions: [".pptx"],
  },
] as const;

const TYPE_BY_MIME = new Map(TYPES.map((type) => [type.mime, type]));
const TYPE_BY_EXTENSION = new Map(
  TYPES.flatMap((type) => type.extensions.map((extension) => [extension, type] as const)),
);

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "application/x-pdf": "application/pdf",
  "text/x-markdown": "text/plain",
};

function canonicalMime(value: string): string {
  const mime = value.split(";", 1)[0]!.trim().toLowerCase();
  return MIME_ALIASES[mime] ?? mime;
}

function starts(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.some((byte) => byte === 0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Return the canonical supported MIME encoded by the prefix. */
export function detectMediaMime(
  prefix: Uint8Array,
  filename: string,
  declaredMime: string,
): string | undefined {
  if (starts(prefix, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (ascii(prefix, 0, 6) === "GIF87a" || ascii(prefix, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(prefix, 0, 4) === "RIFF" && ascii(prefix, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (ascii(prefix, 0, 4) === "RIFF" && ascii(prefix, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  if (ascii(prefix, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(prefix, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(prefix, 0, 3) === "ID3" || (prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (ascii(prefix, 0, 5) === "%PDF-") return "application/pdf";
  if (starts(prefix, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";

  if (ascii(prefix, 4, 4) === "ftyp") {
    const brand = ascii(prefix, 8, 4);
    const brands = ascii(prefix, 8, Math.min(48, prefix.byteLength - 8));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
    if (brand === "qt  ") return "video/quicktime";
    if (brands.includes("M4A ") || brands.includes("M4B ")) return "audio/mp4";
    return "video/mp4";
  }

  // OpenXML containers share ZIP's signature; the extension and exact
  // allow-listed declaration disambiguate them. A generic ZIP is not media.
  if (
    starts(prefix, [0x50, 0x4b, 0x03, 0x04]) ||
    starts(prefix, [0x50, 0x4b, 0x05, 0x06])
  ) {
    const extensionType = TYPE_BY_EXTENSION.get(extname(filename).toLowerCase());
    if (extensionType?.mime.includes("openxmlformats")) {
      const inventory = Buffer.from(prefix).toString("latin1");
      const root = extensionType.mime.includes("wordprocessingml")
        ? "word/document.xml"
        : extensionType.mime.includes("spreadsheetml")
          ? "xl/workbook.xml"
          : "ppt/presentation.xml";
      if (inventory.includes("[Content_Types].xml") && inventory.includes(root)) {
        return extensionType.mime;
      }
    }
  }

  const declared = canonicalMime(declaredMime);
  const extension = extname(filename).toLowerCase();
  if (
    ["text/plain", "text/csv", "application/json"].includes(declared) &&
    TYPE_BY_EXTENSION.get(extension)?.mime === declared &&
    looksLikeText(prefix)
  ) {
    return declared;
  }
  return undefined;
}

export interface ValidatedMedia {
  mime: string;
  kind: MediaKind;
  maxBytes: number;
}

export function validateMediaFile(input: {
  filename: string;
  declaredMime: string;
  bytes: number;
  prefix: Uint8Array;
}): ValidatedMedia {
  if (!input.filename.trim() || /[\u0000-\u001f/\\]/.test(input.filename)) {
    throw new MediaValidationError("The filename contains unsafe characters.");
  }
  if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) {
    throw new MediaValidationError("That file is empty or has an invalid size.");
  }
  if (input.prefix.byteLength === 0) {
    throw new MediaValidationError("That file is empty.");
  }

  const extension = extname(input.filename).toLowerCase();
  if (extension === ".svg" || canonicalMime(input.declaredMime) === "image/svg+xml") {
    throw new MediaValidationError(
      "SVG uploads are not accepted because they can contain executable content. Use PNG, WebP or AVIF.",
    );
  }

  const mime = detectMediaMime(input.prefix, input.filename, input.declaredMime);
  const type = mime ? TYPE_BY_MIME.get(mime) : undefined;
  if (!type) {
    throw new MediaValidationError(
      "That file type is not supported or its contents do not match a safe media format.",
    );
  }
  if (!type.extensions.includes(extension)) {
    throw new MediaValidationError(
      `The ${extension || "missing"} filename extension does not match ${mime}.`,
    );
  }

  const declared = canonicalMime(input.declaredMime);
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== mime &&
    // Some browsers call every MP4-family file video/mp4.
    !(declared === "video/mp4" && mime === "audio/mp4")
  ) {
    throw new MediaValidationError(
      `The browser called this ${declared}, but its contents are ${mime}.`,
    );
  }
  if (input.bytes > MEDIA_LIMITS[type.kind]) {
    throw new MediaValidationError(
      `That ${type.kind} file is larger than ${Math.floor(MEDIA_LIMITS[type.kind] / 1024 / 1024)} MB.`,
    );
  }
  return { mime: type.mime, kind: type.kind, maxBytes: MEDIA_LIMITS[type.kind] };
}

export function expectedKind(filename: string, declaredMime: string): MediaKind {
  const declared = TYPE_BY_MIME.get(canonicalMime(declaredMime));
  const extension = TYPE_BY_EXTENSION.get(extname(filename).toLowerCase());
  const type = declared ?? extension;
  if (!type) {
    throw new MediaValidationError("Choose a supported image, video, audio or document.");
  }
  if (type.mime === "image/svg+xml" || extname(filename).toLowerCase() === ".svg") {
    throw new MediaValidationError("SVG uploads are not accepted.");
  }
  return type.kind;
}
