// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The edge must not mistake a route for a language (MASTER.md §4.9).
//
// `/og/services` is shaped exactly like `/fr/services`, so the prefix was
// stripped and the request became `/services`. Every page's link-preview image
// 404ed, and `/go/…` short links were swallowed the same way. You cannot see it
// on the site — you see it when a page is shared and comes back blank.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";

const ROOT = join(import.meta.dirname, "..", "..");

/** Where Next reports the path it rewrote to, if it rewrote at all. */
function rewrittenTo(path: string): string | null {
  const response = proxy(new NextRequest(`https://example.test${path}`));
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("locale prefixes versus route roots", () => {
  it("treats a real language tag as a prefix", () => {
    expect(rewrittenTo("/fr/services")).toBe("/services");
    expect(rewrittenTo("/fr-CA/services")).toBe("/services");
  });

  it("leaves two-letter route roots alone", () => {
    // The whole bug: these used to arrive at the route as "/services" and "/abc".
    expect(rewrittenTo("/og/services")).not.toBe("/services");
    expect(rewrittenTo("/go/abc")).not.toBe("/abc");
  });

  // A deny-list only works while it is complete, and the edge cannot read the
  // filesystem at runtime. So the list is checked against the filesystem here:
  // add a two-letter route in `app/` without listing it and this fails, rather
  // than the next person discovering it from a blank Facebook preview.
  it("lists every two-letter route root that exists", () => {
    const roots = readdirSync(join(ROOT, "app"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("(") && !name.startsWith("_"))
      .filter((name) => /^[a-z]{2}([-][A-Za-z]{2,4})?$/.test(name));

    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      expect(
        rewrittenTo(`/${root}/anything`),
        `/${root} is a route in app/ but the edge treats it as a language`,
      ).not.toBe("/anything");
    }
  });
});
