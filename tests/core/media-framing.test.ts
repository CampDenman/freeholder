// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Crop and focal point as data (C2.25): the pure geometry the renderer and
// the canvas crop tool share, and the image block drawing a placement with it.
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  BASIS,
  clampCrop,
  cropForAspect,
  effectiveFocal,
  imageCropSchema,
  imageFraming,
  isFullCrop,
  resizeCrop,
} from "@/core/media/framing";
import { image } from "@/modules/cms/blocks/library";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";
import { CANVAS_BRIDGE } from "../../app/(preview)/canvas-bridge";

const ctx = (identifyBlocks = false): BlockRenderContext => ({
  locale: "en",
  t: (key: string) => key,
  business: null,
  path: "/",
  identifyBlocks,
});

const resolved = {
  src: "/media/photo.jpg",
  sources: [{ format: "webp", srcset: "/media/photo-800.webp 800w", type: "image/webp" }],
  width: 1600,
  height: 900,
  altText: "Harbour at dawn",
  focalX: 2500,
  focalY: 4000,
};

function draw(props: Record<string, unknown>, canvas = false): string {
  const parsed = image.schema.parse(props);
  return renderToStaticMarkup(
    image.render({ props: parsed, resolved, ctx: ctx(canvas) } as never) as never,
  );
}

describe("crop and focal geometry", () => {
  it("fits the largest window of a shape around the focal point", () => {
    // 16:9 image, square window: full height, 9/16 of the width.
    const square = cropForAspect(1600, 900, 1, { x: 5000, y: 5000 });
    expect(square).toEqual({ x: 2188, y: 0, w: 5625, h: 10_000 });
    // Pulled toward a left-hand subject, stopped by the edge.
    expect(cropForAspect(1600, 900, 1, { x: 500, y: 5000 }).x).toBe(0);
    // A wider shape than the image keeps full width.
    const wide = cropForAspect(1000, 1000, 16 / 9);
    expect(wide.w).toBe(BASIS);
    expect(wide.h).toBe(5625);
  });

  it("keeps crops inside the picture and above the minimum size", () => {
    expect(clampCrop({ x: 9000, y: -50, w: 3000, h: 20 })).toEqual({
      x: 7000,
      y: 0,
      w: 3000,
      h: 100,
    });
    expect(imageCropSchema.safeParse({ x: 6000, y: 0, w: 5000, h: 5000 }).success).toBe(false);
    expect(imageCropSchema.safeParse({ x: 0, y: 0, w: 5000, h: 5000 }).success).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: BASIS, h: BASIS })).toBe(true);
    expect(isFullCrop(undefined)).toBe(true);
  });

  it("resizes from a corner with the opposite corner fixed and the shape locked", () => {
    const start = { x: 2000, y: 2000, w: 4000, h: 4000 };
    const free = resizeCrop(start, "se", { x: 9000, y: 7000 }, 1000, 1000);
    expect(free).toEqual({ x: 2000, y: 2000, w: 7000, h: 5000 });
    const locked = resizeCrop(start, "nw", { x: 0, y: 1000 }, 1000, 1000, 1);
    // Anchor (6000, 6000) stays; the square takes the smaller extent.
    expect(locked).toEqual({ x: 1000, y: 1000, w: 5000, h: 5000 });
  });

  it("prefers the placement's focal point over the asset's", () => {
    expect(effectiveFocal({}, { focalX: 100, focalY: 200 })).toEqual({ x: 100, y: 200 });
    expect(effectiveFocal({ focalX: 7000 }, { focalX: 100, focalY: 200 })).toEqual({
      x: 7000,
      y: 200,
    });
    expect(effectiveFocal({}, null)).toEqual({ x: 5000, y: 5000 });
  });

  it("frames a shape with object-position at the focal point", () => {
    const framing = imageFraming({
      width: 1600,
      height: 900,
      aspect: "square",
      focal: { x: 2500, y: 4000 },
    });
    expect(framing.mode).toBe("aspect");
    expect(framing.image).toMatchObject({ objectFit: "cover", objectPosition: "25% 40%" });
    expect(framing.frame).toMatchObject({ aspectRatio: "1", overflow: "hidden" });
  });

  it("draws an explicit crop as a scaled, offset window onto the same picture", () => {
    const framing = imageFraming({
      width: 1600,
      height: 900,
      crop: { x: 2500, y: 0, w: 5000, h: 10_000 },
      aspect: "wide",
      focal: { x: 5000, y: 5000 },
    });
    // The crop wins over the shape.
    expect(framing.mode).toBe("crop");
    expect(framing.frame).toMatchObject({ aspectRatio: "800 / 900", width: "800px" });
    expect(framing.image).toMatchObject({
      position: "absolute",
      width: "200%",
      height: "100%",
      left: "-50%",
      top: "0%",
    });
  });

  it("renders natural proportions when no frame applies or the size is unknown", () => {
    expect(imageFraming({ width: 10, height: 10, focal: { x: 0, y: 0 } }).mode).toBe("natural");
    expect(
      imageFraming({ width: null, height: 900, aspect: "square", focal: { x: 0, y: 0 } }).mode,
    ).toBe("natural");
  });
});

describe("the image block honours crop and focal point", () => {
  it("renders the untouched picture by default", () => {
    const html = draw({ assetId: "11111111-2222-4333-8444-555555555555" });
    expect(html).not.toContain("fh-frame");
    expect(html).not.toContain("object-position");
    expect(html).toContain("h-auto max-w-full");
  });

  it("anchors a framed shape on the asset's focal point", () => {
    const html = draw({ assetId: "11111111-2222-4333-8444-555555555555", aspect: "square" });
    expect(html).toContain('data-framing="aspect"');
    expect(html).toContain("object-position:25% 40%");
    expect(html).toContain("aspect-ratio:1");
  });

  it("uses the block's own focal override when it has one", () => {
    const html = draw({
      assetId: "11111111-2222-4333-8444-555555555555",
      aspect: "portrait",
      focalX: 8000,
      focalY: 1000,
    });
    expect(html).toContain("object-position:80% 10%");
  });

  it("renders an explicit crop window, keeping the responsive sources", () => {
    const html = draw({
      assetId: "11111111-2222-4333-8444-555555555555",
      crop: { x: 2500, y: 0, w: 5000, h: 10_000 },
    });
    expect(html).toContain('data-framing="crop"');
    expect(html).toContain("left:-50%");
    expect(html).toContain("width:200%");
    expect(html).toContain('srcSet="/media/photo-800.webp 800w"');
    expect(html).toContain('alt="Harbour at dawn"');
  });

  it("offers the crop & focus affordance on the canvas only when a picture is chosen", () => {
    expect(draw({ assetId: "11111111-2222-4333-8444-555555555555" }, true)).toContain(
      'data-edit-crop="crop"',
    );
    expect(draw({}, true)).not.toContain("data-edit-crop");
    expect(draw({ assetId: "11111111-2222-4333-8444-555555555555" })).not.toContain(
      "data-edit-crop",
    );
  });

  it("refuses a crop that leaves the picture", () => {
    expect(() =>
      image.schema.parse({ crop: { x: 9000, y: 0, w: 5000, h: 1000 } }),
    ).toThrow();
  });
});

describe("the canvas bridge reports the crop affordance", () => {
  it("posts a cropEdit anchored to the picture", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div data-block-id="i1" data-block-type="image">
          <div class="fh-asset" data-asset-prop="assetId" data-asset-current="x">
            <div class="fh-asset-body"><picture><img src="/a.jpg" alt=""></picture></div>
            <button type="button" class="fh-crop" data-edit-crop="crop">Crop</button>
          </div>
        </div></body></html>`,
      { runScripts: "outside-only", url: "http://localhost/preview/page/p1", pretendToBeVisual: true },
    );
    const parentPost = vi.fn();
    Object.defineProperty(dom.window, "parent", {
      configurable: true,
      value: { postMessage: parentPost },
    });
    dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
    dom.window.eval(CANVAS_BRIDGE);
    dom.window.document.querySelector<HTMLButtonElement>("[data-edit-crop]")!.click();
    const message = parentPost.mock.calls
      .map((call) => call[0] as { cropEdit?: { prop: string }; blockId?: string })
      .find((data) => data.cropEdit);
    expect(message).toMatchObject({ blockId: "i1", cropEdit: { prop: "crop" } });
  });
});
