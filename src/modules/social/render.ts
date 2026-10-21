// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-account renditions: sharp for stills, ffmpeg for motion (C9.26).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
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

/** Centre-weighted crop to the network's aspect, then a 1080-wide JPEG. */
export async function cropStill(
  bytes: Uint8Array,
  aspect: SocialAspect,
  filename: string,
): Promise<Rendition> {
  const ratio = RATIOS[aspect];
  const image = sharp(asBuffer(bytes), { failOn: "none" });
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
  const out = await sharp(asBuffer(bytes), { failOn: "none" })
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

/** Clip and scale a video when ffmpeg is on PATH. */
export async function clipVideo(
  bytes: Uint8Array,
  aspect: SocialAspect,
  maxDurationSeconds: number,
  filename: string,
): Promise<Rendition | null> {
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "fh-social-"));
  const input = join(dir, "in.bin");
  const output = join(dir, "out.mp4");
  try {
    await writeFile(input, asBuffer(bytes));
    const ratio = RATIOS[aspect];
    await exec(
      "ffmpeg",
      [
        "-y",
        "-i",
        input,
        "-t",
        String(maxDurationSeconds),
        "-vf",
        `crop=ih*${ratio.w}/${ratio.h}:ih,scale=1080:-2`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        output,
      ],
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
