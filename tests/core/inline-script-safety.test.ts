// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeInlineJson } from "@/core/http/inline-json";
import { providerMarkup } from "@/modules/ads/tags";

const ATTACK = "</script><script>alert('owned')</script>&\u2028";

describe("inline script serialization", () => {
  it("keeps JSON semantics without exposing HTML parser terminators", () => {
    const serialized = serializeInlineJson({ value: ATTACK });
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("&");
    expect(JSON.parse(serialized)).toEqual({ value: ATTACK });
  });

  it("keeps provider values inside the generated ad script", () => {
    const markup = providerMarkup(
      { network: "google.com", unitPath: ATTACK },
      { width: 728, height: 90 },
      "fh-gpt-1",
    );
    expect(markup).toContain("\\u003c/script\\u003e");
    expect(markup).not.toContain("</script><script>alert");
  });

  it("keeps every direct dangerouslySetInnerHTML value on its reviewed boundary", () => {
    const publicPage = readFileSync(
      resolve(process.cwd(), "app/(public)/[[...slug]]/page.tsx"),
      "utf8",
    );
    const previewLayout = readFileSync(
      resolve(process.cwd(), "app/(preview)/layout.tsx"),
      "utf8",
    );
    expect(publicPage).toContain("__html: serializeJsonLd(entry)");
    expect(previewLayout).toContain("serializeInlineJson(t(\"cms.editor.dragBlock\"))");
  });
});
