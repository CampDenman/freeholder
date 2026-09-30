// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Crop and focal point as data (MASTER.md §4.5, C2.25).
//
// Two ideas, deliberately kept apart:
//
// - The *focal point* describes the picture: where its subject is. It lives on
//   the Asset (`focal_x`/`focal_y`, set in the media library) so every surface
//   that frames the image tighter than its natural shape keeps the subject in
//   view. A placement may override it — the same portrait framed as a banner
//   may need the eyes, not the centre — and that override is a block prop.
//
// - A *crop* is a placement decision, never a property of the file: the hero
//   wants 16:9 and the card wants a square of the same photograph. It is a
//   rectangle on the block, in basis points of the original, and the original
//   bytes (and every responsive rendition the pipeline derived from them) are
//   untouched. Rendering is a window onto the ordinary `<picture>` — the same
//   srcset, the same lazy loading — so a crop costs no new renditions, can be
//   undone at any time, and travels with the page tree through revisions,
//   export and restore like every other block prop.
//
// Everything here is pure: the block renderer on the server and the canvas's
// crop tool in the browser share these functions, so what the tool previews
// is exactly what the page renders.
import type { CSSProperties } from "react";
import { z } from "zod";

/** Basis points: 0..10000 across the original image, top-left origin. */
export const BASIS = 10_000;
/** The smallest crop edge, in basis points (1% of the original). */
export const MIN_CROP = 100;

export const imageCropSchema = z
  .object({
    x: z.number().int().min(0).max(BASIS - MIN_CROP),
    y: z.number().int().min(0).max(BASIS - MIN_CROP),
    w: z.number().int().min(MIN_CROP).max(BASIS),
    h: z.number().int().min(MIN_CROP).max(BASIS),
  })
  .refine((crop) => crop.x + crop.w <= BASIS && crop.y + crop.h <= BASIS, {
    message: "The crop must stay inside the image.",
  });

export type ImageCrop = z.infer<typeof imageCropSchema>;

export const focalCoordinate = z.number().int().min(0).max(BASIS);

/**
 * The frame shapes an image placement may take. `original` keeps the
 * picture's own proportions; the rest are the frames owners actually ask for.
 */
export const IMAGE_ASPECTS = {
  original: null,
  wide: 16 / 9,
  landscape: 4 / 3,
  square: 1,
  portrait: 4 / 5,
} as const;

export type ImageAspect = keyof typeof IMAGE_ASPECTS;

export const imageAspectSchema = z.enum(
  Object.keys(IMAGE_ASPECTS) as [ImageAspect, ...ImageAspect[]],
);

export interface Focal {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Round and clamp a focal point onto the stored grid. */
export function clampFocal(focal: Focal): Focal {
  return {
    x: clamp(Math.round(focal.x), 0, BASIS),
    y: clamp(Math.round(focal.y), 0, BASIS),
  };
}

/**
 * Keep a crop a valid rectangle inside the image: integer basis points, at
 * least MIN_CROP on each edge, never past an edge. Moving a rect that would
 * overhang slides it back in rather than shrinking it.
 */
export function clampCrop(crop: ImageCrop): ImageCrop {
  const w = clamp(Math.round(crop.w), MIN_CROP, BASIS);
  const h = clamp(Math.round(crop.h), MIN_CROP, BASIS);
  return {
    x: clamp(Math.round(crop.x), 0, BASIS - w),
    y: clamp(Math.round(crop.y), 0, BASIS - h),
    w,
    h,
  };
}

/** Whether a crop is the whole picture, i.e. no crop at all. */
export function isFullCrop(crop: ImageCrop | undefined): boolean {
  return !crop || (crop.x === 0 && crop.y === 0 && crop.w === BASIS && crop.h === BASIS);
}

/**
 * The largest rectangle of `ratio` (width/height, in pixels) that fits the
 * image, centred on the focal point as nearly as the edges allow. This is
 * what choosing a frame shape in the crop tool starts from, and it is the
 * same window `object-position` produces for an uncropped framed image — so
 * "pick a shape" and "pick a shape, then nudge" agree.
 */
export function cropForAspect(
  imageWidth: number,
  imageHeight: number,
  ratio: number,
  focal: Focal = { x: BASIS / 2, y: BASIS / 2 },
): ImageCrop {
  const imageRatio = imageWidth / imageHeight;
  // Width and height of the window as fractions of the image's own.
  const w = ratio >= imageRatio ? 1 : ratio / imageRatio;
  const h = ratio >= imageRatio ? imageRatio / ratio : 1;
  const wBp = w * BASIS;
  const hBp = h * BASIS;
  return clampCrop({
    x: focal.x - wBp / 2,
    y: focal.y - hBp / 2,
    w: wBp,
    h: hBp,
  });
}

/**
 * Resize a crop from one of its corners to a pointer position, keeping the
 * opposite corner fixed and, when `ratio` is given, the pixel aspect locked.
 */
export function resizeCrop(
  crop: ImageCrop,
  corner: "nw" | "ne" | "sw" | "se",
  point: Focal,
  imageWidth: number,
  imageHeight: number,
  ratio?: number | null,
): ImageCrop {
  const anchorX = corner.includes("w") ? crop.x + crop.w : crop.x;
  const anchorY = corner.includes("n") ? crop.y + crop.h : crop.y;
  let w = Math.max(MIN_CROP, Math.abs(point.x - anchorX));
  let h = Math.max(MIN_CROP, Math.abs(point.y - anchorY));
  // Never past the edge on the dragged side.
  w = Math.min(w, corner.includes("w") ? anchorX : BASIS - anchorX);
  h = Math.min(h, corner.includes("n") ? anchorY : BASIS - anchorY);
  if (ratio) {
    // Convert the pixel ratio into basis points and shrink whichever edge
    // overshoots, so the locked shape always fits what the pointer allows.
    const bpRatio = ratio * (imageHeight / imageWidth);
    if (w / h > bpRatio) w = h * bpRatio;
    else h = w / bpRatio;
  }
  return clampCrop({
    x: corner.includes("w") ? anchorX - w : anchorX,
    y: corner.includes("n") ? anchorY - h : anchorY,
    w,
    h,
  });
}

/** Where a placement's focal point is: its own override, else the asset's. */
export function effectiveFocal(
  block: { focalX?: number; focalY?: number },
  asset: { focalX?: number | null; focalY?: number | null } | null | undefined,
): Focal {
  return {
    x: block.focalX ?? asset?.focalX ?? BASIS / 2,
    y: block.focalY ?? asset?.focalY ?? BASIS / 2,
  };
}

export interface FramingInput {
  /** Intrinsic pixel size; framing needs it to know the picture's shape. */
  width: number | null | undefined;
  height: number | null | undefined;
  crop?: ImageCrop;
  aspect?: ImageAspect;
  focal: Focal;
}

/** Style objects for the frame and the image (types only; no React runtime). */
export type FrameStyle = CSSProperties;

export interface Framing {
  mode: "natural" | "crop" | "aspect";
  /** Styles for the window element wrapping `<picture>`. */
  frame?: FrameStyle;
  /** Styles for the `<img>` inside it. */
  image?: FrameStyle;
  /** The rendered shape, width/height in pixels of the original's scale. */
  ratio?: number;
}

const percent = (value: number) => `${Number(value.toFixed(4))}%`;

/**
 * How to draw one placement.
 *
 * - An explicit crop wins: the frame takes the crop's pixel shape and the
 *   image is scaled and offset so exactly the cropped window shows.
 * - Otherwise a frame shape crops by `object-fit: cover`, anchored on the
 *   focal point — the subject stays in view whatever the shape.
 * - Otherwise the picture renders at its own proportions and the focal point
 *   has nothing to do.
 *
 * Unknown intrinsic size (a legacy asset with no dimensions) falls back to
 * natural rendering rather than guessing a shape.
 */
export function imageFraming(input: FramingInput): Framing {
  const { width, height, crop, aspect = "original", focal } = input;
  if (!width || !height) return { mode: "natural" };
  if (crop && !isFullCrop(crop)) {
    const safe = clampCrop(crop);
    const pixelWidth = (safe.w / BASIS) * width;
    const pixelHeight = (safe.h / BASIS) * height;
    return {
      mode: "crop",
      ratio: pixelWidth / pixelHeight,
      frame: {
        position: "relative",
        overflow: "hidden",
        aspectRatio: `${Math.round(pixelWidth)} / ${Math.round(pixelHeight)}`,
        maxWidth: "100%",
        width: `${Math.round(pixelWidth)}px`,
      },
      image: {
        position: "absolute",
        maxWidth: "none",
        width: percent((BASIS / safe.w) * 100),
        height: percent((BASIS / safe.h) * 100),
        // Physical on purpose: a photograph is not mirrored in a
        // right-to-left document, so its crop window is not either.
        left: percent((-safe.x / safe.w) * 100),
        top: percent((-safe.y / safe.h) * 100),
      },
    };
  }
  const ratio = IMAGE_ASPECTS[aspect] ?? null;
  if (ratio) {
    const { x, y } = clampFocal(focal);
    return {
      mode: "aspect",
      ratio,
      frame: {
        position: "relative",
        overflow: "hidden",
        aspectRatio: String(Number(ratio.toFixed(6))),
        maxWidth: "100%",
        width: `${width}px`,
      },
      image: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${percent(x / 100)} ${percent(y / 100)}`,
      },
    };
  }
  return { mode: "natural" };
}
