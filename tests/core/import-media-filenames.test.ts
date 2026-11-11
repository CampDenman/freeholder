// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { importedMediaFilename, validateMediaFile } from "@/core/media/validation";

describe("signature-derived source endpoint filenames (C3.22)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  it("names a strongly identified endpoint while preserving ordinary validation", () => {
    const filename = importedMediaFilename("source-image", png);
    expect(filename).toBe("source-image.png");
    expect(validateMediaFile({ filename, declaredMime: "application/octet-stream", bytes: png.length, prefix: png })).toMatchObject({ mime: "image/png", kind: "image" });
    expect(() => validateMediaFile({ filename: "source-image", declaredMime: "application/octet-stream", bytes: png.length, prefix: png })).toThrow(/extension/);
  });
  it("keeps SVG refusal even when a misleading SVG filename carries raster bytes", () => {
    const filename = importedMediaFilename("source.svg", png);
    expect(() => validateMediaFile({ filename, declaredMime: "application/octet-stream", bytes: png.length, prefix: png })).toThrow(/SVG/);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>source()</script></svg>');
    expect(() => validateMediaFile({ filename: importedMediaFilename("source-endpoint", svg), declaredMime: "application/octet-stream", bytes: svg.length, prefix: svg })).toThrow(/not supported/);
  });
  it("does not turn an HTML response into supported media", () => {
    const body = new TextEncoder().encode('<html><script>source()</script></html>');
    expect(() => validateMediaFile({ filename: importedMediaFilename("source-endpoint", body), declaredMime: "application/octet-stream", bytes: body.length, prefix: body })).toThrow(/not supported/);
  });
});
