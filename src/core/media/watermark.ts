// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Watermarked proof renditions (MASTER.md §4.5, C8.04).
//
// A proof is shown so the client can choose, not so the work can be used
// before it is paid for. The mark is therefore centred and large rather than
// tucked into a corner: a corner mark is a crop away from gone, and a proof
// that can be cropped into a usable file is not a proof.
//
// The owner's logo is the mark when the brand has one (`design.logoAssetId`),
// and the business name is the mark when it does not. Neither needs a new
// setting, so a first-boot install and seed/demo mode both produce a real
// watermark without anybody configuring one.
import sharp from "sharp";
import type { BuiltRendition, ImageFacts, VariantFormat } from "./variants";

/**
 * WebP only, and only at viewing sizes. A watermarked rendition exists to be
 * looked at in a gallery; nobody needs a 2400px proof, and this build's
 * libvips may not encode AVIF at all (`buildRenditions` already treats that
 * as normal). Keeping the ladder short also keeps the storage cost of
 * watermarking every uploaded image honest.
 */
const WIDTHS = [800, 1600] as const;
const FORMAT: VariantFormat = "webp";

/** Where the mark comes from: the brand's logo, or its name. */
export interface WatermarkMark {
  /** The bytes of `design.logoAssetId`, when the brand has a logo. */
  logo?: Uint8Array<ArrayBuffer>;
  /** The business name — the fallback, and never empty in practice. */
  text: string;
}

/** `&`, `<` and `>` in a business name must not end the SVG early. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The name as an image, sized to the rendition it will sit on.
 *
 * Rendering text needs a font, and a font needs fontconfig in the host's
 * libvips build. That is usually present and occasionally is not, so a
 * failure here returns undefined and the caller simply produces no
 * watermarked rendition — the same way a missing AVIF encoder produces no
 * AVIF. A gallery then falls back to serving no marked variant, which the
 * policy layer treats as "cannot mark", not as "mark not required".
 */
async function textMark(
  width: number,
  height: number,
  text: string,
): Promise<Buffer | undefined> {
  const size = Math.max(16, Math.round(width * 0.075));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="${size}" ` +
      `font-weight="700" fill="#ffffff" fill-opacity="0.42" ` +
      `stroke="#000000" stroke-opacity="0.18" stroke-width="${Math.max(1, Math.round(size / 40))}"` +
      `>${escapeXml(text)}</text></svg>`,
  );
  try {
    // sharp composites from a Buffer, so the raster stays one.
    return await sharp(svg).png().toBuffer();
  } catch {
    return undefined;
  }
}

/** The logo, scaled to half the rendition's width and made translucent. */
async function logoMark(
  logo: Uint8Array<ArrayBuffer>,
  width: number,
): Promise<Buffer | undefined> {
  try {
    const raster = await sharp(logo)
      .resize({ width: Math.max(48, Math.round(width * 0.5)), withoutEnlargement: false })
      .ensureAlpha()
      // Multiply the existing alpha rather than replacing it, so a logo with
      // transparent corners does not gain an opaque box.
      .composite([
        {
          input: {
            create: {
              width: 1,
              height: 1,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 0.38 },
            },
          },
          tile: true,
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();
    return raster;
  } catch {
    return undefined;
  }
}

/**
 * Every watermarked rendition worth making for one image.
 *
 * Returns an empty list rather than throwing: an upload must not fail because
 * a mark could not be drawn, and the caller records "no watermarked variant"
 * which the serving policy can act on.
 */
export async function buildWatermarked(
  original: Uint8Array<ArrayBuffer>,
  facts: ImageFacts,
  mark: WatermarkMark,
  keyFor: (format: VariantFormat, width: number) => string,
): Promise<BuiltRendition[]> {
  const targets = WIDTHS.filter((width) => width < facts.width);
  if (targets.length === 0) targets.push(facts.width as (typeof WIDTHS)[number]);

  const built: BuiltRendition[] = [];
  for (const width of targets) {
    try {
      const base = sharp(original).resize({ width, withoutEnlargement: true });
      const { data: resized, info } = await base
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true });

      const overlay =
        (mark.logo && (await logoMark(mark.logo, info.width))) ??
        (await textMark(info.width, info.height, mark.text));
      if (!overlay) return [];

      const { data, info: marked } = await sharp(resized)
        .composite([{ input: overlay, gravity: "centre" }])
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true });

      built.push({
        format: FORMAT,
        width: marked.width,
        height: marked.height,
        bytes: marked.size,
        body: new Uint8Array(data),
        contentType: "image/webp",
        key: keyFor(FORMAT, marked.width),
      });
    } catch {
      // This image cannot be marked at all; do not half-mark a gallery.
      return [];
    }
  }
  return built;
}
