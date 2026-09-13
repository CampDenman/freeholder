// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Icons, splash and placeholder screenshots from branding (C10.15).
//
// A running demo is not required. Store screenshots captured from a simulator
// are better, but the command must still emit frames an owner can submit —
// branded placeholders rather than a missing-file failure.
import type { Branding, Rgb } from "./branding.js";
import { storeCopy } from "./branding.js";
import { decodePng, encodeRgba, fillRgba, type Rgba } from "./png.js";

export const ICON_SIZE = 1024;
export const SPLASH = { width: 1284, height: 2778 } as const;
export const SCREENSHOT = { width: 1290, height: 2796 } as const;

export interface GeneratedAssets {
  files: Record<string, Buffer | string>;
  notes: string[];
}

const SCREEN_LABELS = ["Home", "Catalog", "Bookings"] as const;

export function generateAssets(brand: Branding, logoBytes: Uint8Array | null): GeneratedAssets {
  const notes: string[] = [];
  const logo = logoBytes ? decodePng(logoBytes) : null;
  if (logoBytes && !logo) {
    notes.push("Logo was not a PNG this command can rasterise; icons use the brand colours instead.");
  } else if (logo) {
    notes.push("Icons and splash composite the instance logo onto the brand surface.");
  } else {
    notes.push("No logo in discovery; icons use a mark in the brand accent.");
  }

  const icon = canvas(ICON_SIZE, ICON_SIZE, brand.rgb.surface);
  paintMark(icon, ICON_SIZE, ICON_SIZE, brand, logo, 0.7);
  const adaptive = canvas(ICON_SIZE, ICON_SIZE, brand.rgb.surface);
  paintMark(adaptive, ICON_SIZE, ICON_SIZE, brand, logo, 0.42);
  const splash = canvas(SPLASH.width, SPLASH.height, brand.rgb.surface);
  paintMark(splash, SPLASH.width, SPLASH.height, brand, logo, 0.36);

  const files: Record<string, Buffer | string> = {
    "assets/icon.png": encodeRgba(ICON_SIZE, ICON_SIZE, icon),
    "assets/adaptive-icon.png": encodeRgba(ICON_SIZE, ICON_SIZE, adaptive),
    "assets/splash.png": encodeRgba(SPLASH.width, SPLASH.height, splash),
  };

  const copy = storeCopy(brand);
  SCREEN_LABELS.forEach((label, index) => {
    const rgba = screenshotFrame(brand, copy.name, label, index);
    const name = `store/screenshots/${String(index + 1).padStart(2, "0")}-${label.toLowerCase()}.png`;
    files[name] = encodeRgba(SCREENSHOT.width, SCREENSHOT.height, rgba);
  });

  const screenshotPaths = SCREEN_LABELS.map(
    (label, index) => `store/screenshots/${String(index + 1).padStart(2, "0")}-${label.toLowerCase()}.png`,
  );
  files["store/metadata.json"] = `${JSON.stringify(
    {
      source: brand.url,
      name: copy.name,
      tagline: brand.tagline,
      ios: {
        name: copy.name,
        subtitle: copy.subtitle,
        description: copy.description,
        keywords: copy.keywords,
      },
      android: {
        title: copy.name,
        shortDescription: copy.shortDescription,
        fullDescription: copy.description,
      },
      privacyPolicyUrl: `${brand.url}/privacy`,
      screenshots: screenshotPaths,
    },
    null,
    2,
  )}\n`;
  files["store/ios/name.txt"] = `${copy.name}\n`;
  files["store/ios/subtitle.txt"] = `${copy.subtitle}\n`;
  files["store/ios/description.txt"] = `${copy.description}\n`;
  files["store/ios/keywords.txt"] = `${copy.keywords}\n`;
  files["store/android/title.txt"] = `${copy.name}\n`;
  files["store/android/short-description.txt"] = `${copy.shortDescription}\n`;
  files["store/android/full-description.txt"] = `${copy.description}\n`;
  return { files, notes };
}

function canvas(width: number, height: number, rgb: Rgb): Uint8Array {
  return fillRgba(width, height, [...rgb, 255] as Rgba);
}

function paintMark(
  dest: Uint8Array,
  width: number,
  height: number,
  brand: Branding,
  logo: { width: number; height: number; rgba: Uint8Array } | null,
  fraction: number,
): void {
  const box = Math.round(Math.min(width, height) * fraction);
  const dx = Math.round((width - box) / 2);
  const dy = Math.round((height - box) / 2);
  if (logo) {
    const scale = Math.min(box / logo.width, box / logo.height);
    const dw = Math.max(1, Math.round(logo.width * scale));
    const dh = Math.max(1, Math.round(logo.height * scale));
    const resized = resize(logo.rgba, logo.width, logo.height, dw, dh);
    blit(dest, width, height, resized, dw, dh, dx + Math.round((box - dw) / 2), dy + Math.round((box - dh) / 2));
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  const outer = box / 2;
  const inner = outer * 0.62;
  fillCircle(dest, width, height, cx, cy, outer, [...brand.rgb.accent, 255] as Rgba);
  fillCircle(dest, width, height, cx, cy, inner, [...brand.rgb.onAccent, 255] as Rgba);
}

function fillCircle(
  dest: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgba,
): void {
  const r2 = radius * radius;
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) put(dest, width, x, y, color);
    }
  }
}

function screenshotFrame(brand: Branding, name: string, label: string, index: number): Uint8Array {
  const { width, height } = SCREENSHOT;
  const dest = canvas(width, height, brand.rgb.surface);
  const header = Math.round(height * 0.14);
  fillRect(dest, width, 0, 0, width, header, [...brand.rgb.accent, 255] as Rgba);
  const scale = 8;
  blitText(dest, width, height, name, Math.round(width * 0.08), Math.round(header * 0.38), scale, brand.rgb.onAccent);
  blitText(dest, width, height, label, Math.round(width * 0.08), header + Math.round(height * 0.04), 6, brand.rgb.ink);
  const cardTop = header + Math.round(height * 0.12);
  const cardH = Math.round(height * 0.16);
  const gap = Math.round(height * 0.03);
  const inset = Math.round(width * 0.08);
  for (let i = 0; i < 3; i++) {
    const y = cardTop + i * (cardH + gap);
    fillRect(dest, width, inset, y, width - inset * 2, cardH, i === index ? [...brand.rgb.accent, 255] as Rgba : [...brand.rgb.ink, 28] as Rgba);
  }
  const tab = Math.round(height * 0.08);
  fillRect(dest, width, 0, height - tab, width, tab, [...brand.rgb.ink, 255] as Rgba);
  fillRect(dest, width, Math.round(width * 0.12) + index * Math.round(width * 0.28), height - tab, Math.round(width * 0.2), tab, [...brand.rgb.accent, 255] as Rgba);
  return dest;
}

function fillRect(
  dest: Uint8Array,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Rgba,
): void {
  const height = dest.length / 4 / width;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.min(height, Math.ceil(y + h));
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) put(dest, width, col, row, color);
  }
}

function put(dest: Uint8Array, width: number, x: number, y: number, color: Rgba): void {
  const i = (y * width + x) * 4;
  dest[i] = color[0];
  dest[i + 1] = color[1];
  dest[i + 2] = color[2];
  dest[i + 3] = color[3];
}

function resize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return out;
}

function blit(
  dest: Uint8Array,
  dw: number,
  dh: number,
  src: Uint8Array,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < sh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dw) continue;
      const si = (y * sw + x) * 4;
      const a = src[si + 3]! / 255;
      if (a <= 0) continue;
      const di = (ty * dw + tx) * 4;
      if (a >= 1) {
        dest[di] = src[si]!;
        dest[di + 1] = src[si + 1]!;
        dest[di + 2] = src[si + 2]!;
        dest[di + 3] = 255;
        continue;
      }
      dest[di] = Math.round(src[si]! * a + dest[di]! * (1 - a));
      dest[di + 1] = Math.round(src[si + 1]! * a + dest[di + 1]! * (1 - a));
      dest[di + 2] = Math.round(src[si + 2]! * a + dest[di + 2]! * (1 - a));
      dest[di + 3] = 255;
    }
  }
}

const GLYPHS: Record<string, readonly number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 0b00100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00001, 0b00001, 0b00001, 0b10001, 0b10001, 0b01110],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
};

function blitText(
  dest: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: Rgb,
): void {
  const color: Rgba = [...rgb, 255];
  let cursor = x;
  const max = Math.min(text.length, 24);
  for (let i = 0; i < max; i++) {
    const glyph = GLYPHS[text[i]!.toUpperCase()] ?? GLYPHS["."]!;
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < 5; col++) {
        if (((bits >> (4 - col)) & 1) === 0) continue;
        fillRect(dest, width, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
    if (cursor > width - 6 * scale) break;
  }
  void height;
}
