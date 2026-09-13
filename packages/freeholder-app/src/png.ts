// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Minimal PNG codec so init can mint icons without a native image library.
//
// Store assets are solid colour plus a composited logo. Sharp would pull a
// native toolchain into a published CLI that otherwise has no dependencies;
// zlib and a CRC table are already on the Node we require.
import { deflateSync, inflateSync } from "node:zlib";

export type Rgba = readonly [number, number, number, number];

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crcInput = Buffer.concat([header.subarray(4, 8), data]);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([header, data, footer]);
}

/** Fast fill: copy-doubling a 4-byte pixel rather than a JS loop per pixel. */
export function fillRgba(width: number, height: number, color: Rgba): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  if (data.length === 0) return data;
  data[0] = color[0];
  data[1] = color[1];
  data[2] = color[2];
  data[3] = color[3];
  let filled = 4;
  while (filled < data.length) {
    data.copyWithin(filled, 0, Math.min(filled, data.length - filled));
    filled *= 2;
  }
  return data;
}

export function encodeRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error("PNG payload length does not match width×height.");
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    raw[dst++] = 0;
    raw.set(rgba.subarray(src, src + width * 4), dst);
    src += width * 4;
    dst += width * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      rgba[i++] = r;
      rgba[i++] = g;
      rgba[i++] = b;
      rgba[i++] = a;
    }
  }
  return encodeRgba(width, height, rgba);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Decode 8-bit RGB/RGBA non-interlaced PNG. Anything else (JPEG, SVG, indexed,
 * 16-bit) returns null so the caller can fall back to a branded mark rather
 * than pretend it rasterised a format it cannot read.
 */
export function decodePng(bytes: Uint8Array): DecodedPng | null {
  if (bytes.length < 8 || !SIGNATURE.equals(Buffer.from(bytes.subarray(0, 8)))) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (data.length !== 13) return null;
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || width < 1 || height < 1) {
    return null;
  }
  if (width > 4096 || height > 4096) return null;
  const bpp = colorType === 6 ? 4 : 3;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const row = width * bpp;
  if (inflated.length !== (row + 1) * height) return null;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(row);
  const curr = new Uint8Array(row);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (row + 1)]!;
    const src = inflated.subarray(y * (row + 1) + 1, y * (row + 1) + 1 + row);
    for (let i = 0; i < row; i++) {
      const raw = src[i]!;
      const a = i >= bpp ? curr[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let recon: number;
      if (filter === 0) recon = raw;
      else if (filter === 1) recon = (raw + a) & 255;
      else if (filter === 2) recon = (raw + b) & 255;
      else if (filter === 3) recon = (raw + ((a + b) >> 1)) & 255;
      else if (filter === 4) recon = (raw + paeth(a, b, c)) & 255;
      else return null;
      curr[i] = recon;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      rgba[di] = curr[si]!;
      rgba[di + 1] = curr[si + 1]!;
      rgba[di + 2] = curr[si + 2]!;
      rgba[di + 3] = bpp === 4 ? curr[si + 3]! : 255;
    }
    prev.set(curr);
  }
  return { width, height, rgba };
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !SIGNATURE.equals(Buffer.from(bytes.subarray(0, 8)))) return null;
  return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
}
