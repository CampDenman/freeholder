// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Responsive image renditions (MASTER.md §36: "automatic responsive variants,
// AVIF/WebP, lazy loading, CDN-friendly caching headers — the media pipeline
// does this by default").
//
// "By default" is the point. §36 lists image optimization among the things
// Freeholder *absorbs* rather than leaves to a plugin, so an owner who uploads
// a 4000px photograph from a camera gets sensible renditions without knowing
// what a rendition is.
import sharp from "sharp";

/**
 * The ladder. Wide enough at the top for a full-bleed hero on a dense display,
 * fine-grained enough at the bottom that a phone on cellular is not sent a
 * desktop image. Never upscales: a 500px logo yields one variant, not four
 * blurry ones.
 */
const WIDTHS = [400, 800, 1600, 2400] as const;

/**
 * AVIF first, WebP second — `<picture>` takes the first source the browser
 * accepts, and AVIF is materially smaller at the same quality. The original is
 * always kept as the final fallback, so a browser that understands neither
 * still gets the file the owner uploaded.
 */
const FORMATS = ["avif", "webp"] as const;
export type VariantFormat = (typeof FORMATS)[number];

export interface Rendition {
  width: number;
  height: number;
  bytes: number;
  key: string;
}

/**
 * What is stored on `Asset.variants` (§4.5: "thumbs, web, watermarked").
 *
 * The format keys are the public ladder. `watermarked` is deliberately not
 * one of them: a marked rendition must never reach a `<picture>` on a public
 * page, so it lives under its own key and every reader states which of the
 * two it wants. Iterating the raw object is what would leak it.
 */
export interface VariantSet extends Partial<Record<VariantFormat, Rendition[]>> {
  watermarked?: Partial<Record<VariantFormat, Rendition[]>>;
}

/** The public ladder only — never the marked renditions. */
export function publicRenditions(
  set: VariantSet,
): Array<[VariantFormat, Rendition[]]> {
  return FORMATS.flatMap((format) => {
    const renditions = set[format];
    return renditions?.length ? [[format, renditions] as [VariantFormat, Rendition[]]] : [];
  });
}

/** The marked ladder only — what a proof gallery is allowed to serve. */
export function watermarkedRenditions(set: VariantSet): Rendition[] {
  const marked = set.watermarked ?? {};
  return FORMATS.flatMap((format) => marked[format] ?? []);
}

/**
 * Every stored object this asset owns, marked or not. Purge reads through
 * here so a deleted asset does not leave its watermarks behind.
 */
export function allRenditionKeys(set: VariantSet): string[] {
  return [
    ...publicRenditions(set).flatMap(([, renditions]) => renditions),
    ...watermarkedRenditions(set),
  ].map((rendition) => rendition.key);
}

/**
 * The smallest rendition at least `minWidth` wide, or the largest there is.
 * The same rule the alt-text preview already uses, named once.
 */
export function pickRendition(
  renditions: Rendition[],
  minWidth: number,
): Rendition | undefined {
  const ordered = [...renditions].sort((a, b) => a.width - b.width);
  return ordered.find((candidate) => candidate.width >= minWidth) ?? ordered.at(-1);
}

export interface ImageFacts {
  width: number;
  height: number;
}

/** What a file's mime type says it is (§4.5's `kind`). */
export function kindFor(mime: string): "image" | "video" | "doc" | "audio" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
}

/**
 * SVG is an image but not a raster one: it has no meaningful pixel dimensions
 * to resize to, it is already small, and — more to the point — it is a
 * document that can carry script. It is stored as uploaded and never fed to
 * the resizer, and the serving route sends it with a content type that stops
 * a browser executing it inline.
 */
export function isRasterImage(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export async function readImageFacts(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<ImageFacts | undefined> {
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return undefined;
    return { width: meta.width, height: meta.height };
  } catch {
    // A file that claims to be an image and is not. The upload still succeeds
    // — the owner gets their file back — it simply has no renditions.
    return undefined;
  }
}

export interface BuiltRendition extends Rendition {
  format: VariantFormat;
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * Every rendition worth making for one image.
 *
 * A format the installed libvips cannot encode is skipped rather than fatal:
 * AVIF support varies between builds, and an owner uploading a photograph
 * should not get an error because their host's image library was compiled
 * without one codec. WebP is effectively universal, so something always
 * survives.
 */
export async function buildRenditions(
  original: Uint8Array<ArrayBuffer>,
  facts: ImageFacts,
  keyFor: (format: VariantFormat, width: number) => string,
): Promise<BuiltRendition[]> {
  const targets = WIDTHS.filter((width) => width < facts.width);
  // A small image still deserves modern formats, just at its own size.
  if (targets.length === 0) targets.push(facts.width as (typeof WIDTHS)[number]);

  const built: BuiltRendition[] = [];
  for (const format of FORMATS) {
    for (const width of targets) {
      try {
        const pipeline = sharp(original).resize({
          width,
          withoutEnlargement: true,
        });
        const encoded =
          format === "avif"
            ? pipeline.avif({ quality: 55 })
            : pipeline.webp({ quality: 78 });
        const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
        built.push({
          format,
          width: info.width,
          height: info.height,
          bytes: info.size,
          body: new Uint8Array(data),
          contentType: `image/${format}`,
          key: keyFor(format, info.width),
        });
      } catch {
        // This format is unavailable in this build; stop trying it entirely
        // rather than failing once per width.
        break;
      }
    }
  }
  return built;
}

function group(built: BuiltRendition[]): Partial<Record<VariantFormat, Rendition[]>> {
  const set: Partial<Record<VariantFormat, Rendition[]>> = {};
  for (const rendition of built) {
    (set[rendition.format] ??= []).push({
      width: rendition.width,
      height: rendition.height,
      bytes: rendition.bytes,
      key: rendition.key,
    });
  }
  for (const list of Object.values(set)) list.sort((a, b) => a.width - b.width);
  return set;
}

/** Group built renditions into the shape stored on the asset row. */
export function toVariantSet(built: BuiltRendition[]): VariantSet {
  return group(built);
}

/** Fold watermarked renditions in under their own key. */
export function withWatermarked(
  set: VariantSet,
  built: BuiltRendition[],
): VariantSet {
  if (!built.length) return set;
  return { ...set, watermarked: group(built) };
}
