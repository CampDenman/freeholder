// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-account renditions: sharp for stills, ffmpeg for motion (C9.26).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  NotAllowedVideoError,
  NotRasterImageError,
  sniffRasterImage,
  sniffVideo,
} from "@/core/media/validation";
import type { SocialAspect } from "./contract";

const exec = promisify(execFile);

const RATIOS: Record<SocialAspect, { w: number; h: number }> = {
  "1:1": { w: 1, h: 1 },
  "4:5": { w: 4, h: 5 },
  "9:16": { w: 9, h: 16 },
  "16:9": { w: 16, h: 9 },
};

export interface Rendition {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  filename: string;
  generated: boolean;
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

/**
 * A stored still as a Buffer for sharp, but only when its bytes are an
 * allow-listed raster. Stored mime types and extensions are not trusted: an
 * SVG stored before SVG uploads were refused must not reach librsvg (C11.10).
 */
function rasterBuffer(bytes: Uint8Array): Buffer {
  if (!sniffRasterImage(bytes)) throw new NotRasterImageError();
  return asBuffer(bytes);
}

/** Centre-weighted crop to the network's aspect, then a 1080-wide JPEG. */
export async function cropStill(
  bytes: Uint8Array,
  aspect: SocialAspect,
  filename: string,
): Promise<Rendition> {
  const ratio = RATIOS[aspect];
  const image = sharp(rasterBuffer(bytes), { failOn: "none" });
  const meta = await image.metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  const target = width / height;
  const wanted = ratio.w / ratio.h;
  let cropW = width;
  let cropH = height;
  if (target > wanted) {
    cropW = Math.round(height * wanted);
  } else if (target < wanted) {
    cropH = Math.round(width / wanted);
  }
  const left = Math.max(0, Math.floor((width - cropW) / 2));
  const top = Math.max(0, Math.floor((height - cropH) / 2));
  const out = await image
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const generated = cropW !== width || cropH !== height;
  return {
    bytes: new Uint8Array(out),
    mime: "image/jpeg",
    filename: filename.replace(/\.[^.]+$/, "") + `-${aspect.replace(":", "x")}.jpg`,
    generated,
  };
}

export async function stillThumbnail(bytes: Uint8Array, filename: string): Promise<Rendition> {
  const out = await sharp(rasterBuffer(bytes), { failOn: "none" })
    .resize({ width: 320, withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return {
    bytes: new Uint8Array(out),
    mime: "image/jpeg",
    filename: filename.replace(/\.[^.]+$/, "") + "-thumb.jpg",
    generated: true,
  };
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await exec("ffmpeg", ["-version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The one demuxer each allow-listed container is read with. ffmpeg's `mov`
 * demuxer covers MP4 and QuickTime; `matroska` covers WebM.
 */
const VIDEO_DEMUXERS: Record<string, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
};

/**
 * The demuxer for stored bytes, or a refusal. The stored kind, mime type and
 * filename are labels; a playlist (HLS, concat, ffconcat) or anything else
 * outside the upload allow-list never reaches ffmpeg (C11.10).
 */
export function videoDemuxerFor(bytes: Uint8Array): string {
  const mime = sniffVideo(bytes);
  const demuxer = mime ? VIDEO_DEMUXERS[mime] : undefined;
  if (!demuxer) throw new NotAllowedVideoError();
  return demuxer;
}

/**
 * ffmpeg's argv for one clip. Every input option precedes `-i`:
 *
 * - `-f` names the demuxer, so content probing can never select a playlist
 *   or concat demuxer that opens further inputs;
 * - `-protocol_whitelist file` refuses network, pipe, data and every other
 *   protocol, so even a nested reference cannot fetch a URL;
 * - `-enable_drefs 0` (the mov default, stated rather than assumed) keeps
 *   MP4/QuickTime data references from opening sibling files.
 */
export function clipVideoArgs(input: {
  source: string;
  output: string;
  demuxer: string;
  aspect: SocialAspect;
  maxDurationSeconds: number;
}): string[] {
  const ratio = RATIOS[input.aspect];
  return [
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file",
    ...(input.demuxer === "mov" ? ["-enable_drefs", "0"] : []),
    "-f",
    input.demuxer,
    "-i",
    input.source,
    "-t",
    String(input.maxDurationSeconds),
    "-vf",
    `crop=ih*${ratio.w}/${ratio.h}:ih,scale=1080:-2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    input.output,
  ];
}

/**
 * Clip and scale a video when ffmpeg is on PATH. Bytes that are not an
 * allow-listed video container are refused before ffmpeg is consulted.
 */
export async function clipVideo(
  bytes: Uint8Array,
  aspect: SocialAspect,
  maxDurationSeconds: number,
  filename: string,
): Promise<Rendition | null> {
  const demuxer = videoDemuxerFor(bytes);
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "fh-social-"));
  const input = join(dir, "in.bin");
  const output = join(dir, "out.mp4");
  try {
    await writeFile(input, asBuffer(bytes));
    await exec(
      "ffmpeg",
      clipVideoArgs({ source: input, output, demuxer, aspect, maxDurationSeconds }),
      { timeout: 60_000 },
    );
    const out = await readFile(output);
    return {
      bytes: new Uint8Array(out),
      mime: "video/mp4",
      filename: filename.replace(/\.[^.]+$/, "") + `-${aspect.replace(":", "x")}.mp4`,
      generated: true,
    };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
