// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A Markdown deliverable is a document (C3.39). Browsers declare .md files
// as text/markdown (RFC 7763); the media guard must accept that spelling as
// well as the older text/x-markdown, and still refuse a binary in disguise.
import { describe, expect, it } from "vitest";
import { MediaValidationError, validateMediaFile } from "@/core/media/validation";

const text = new TextEncoder().encode("# Show notes\n\n## Chapters\n\n- 00:00 Welcome\n");

describe("Markdown uploads", () => {
  it("accepts .md declared as text/markdown or text/x-markdown", () => {
    for (const declaredMime of ["text/markdown", "text/x-markdown", "text/markdown; charset=utf-8"]) {
      expect(validateMediaFile({ filename: "show-notes.md", declaredMime, bytes: text.byteLength, prefix: text }).kind).toBe("doc");
    }
  });

  it("still refuses a binary that calls itself Markdown", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(() => validateMediaFile({ filename: "show-notes.md", declaredMime: "text/markdown", bytes: png.byteLength, prefix: png })).toThrow(MediaValidationError);
  });
});
