// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Link in bio without a database (C9.39): what a link is, where it goes,
// when it shows, how the block draws, and whether that drawing is accessible.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";
import { analyzeAccessibility } from "@/modules/cms/a11y-hints";
import { deriveFields } from "@/modules/cms/blocks/fields";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";
import { linkInBio } from "@/modules/linkinbio/blocks";
import {
  clickHref,
  destinationOf,
  findLink,
  internalDestination,
  linkInBioPropsSchema,
  linkState,
  monogram,
  normalizeTarget,
  safeExternalUrl,
  scheduleInstant,
  sitePath,
  socialHref,
  type LinkItem,
} from "@/modules/linkinbio/links";
import en from "../../locales/en.json";

const ZONE = "America/Vancouver";
const ORIGIN = "https://studio.example.test";

function link(overrides: Partial<LinkItem> = {}): LinkItem {
  return {
    id: "abcd2345ef",
    label: "Shop",
    kind: "url",
    target: "https://example.test/shop",
    hidden: false,
    startsAt: "",
    endsAt: "",
    ...overrides,
  };
}

describe("where a link may go", () => {
  it("accepts web, mail and phone addresses and nothing that could run", () => {
    expect(safeExternalUrl("https://example.test/a?b=1")).toBe("https://example.test/a?b=1");
    expect(safeExternalUrl("mailto:hello@example.test")).toBe("mailto:hello@example.test");
    expect(safeExternalUrl("tel:+1 250 555 0100")).toBe("tel:+12505550100");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "example.test",
      "//example.test",
      // Embedded credentials, assembled so a secret scanner does not read
      // the test fixture as a leaked login.
      ["https://", "someone", ":", "letmein", "@example.test"].join(""),
      "ftp://example.test",
      "",
    ]) {
      expect(safeExternalUrl(bad), bad).toBeNull();
    }
  });

  it("stores on-site targets as the page's own path", () => {
    expect(sitePath("/about/")).toBe("about");
    expect(sitePath("/")).toBe("");
    for (const bad of ["../admin", "https://x.example", "//x.example", "a//b", "A B", "Caps"]) {
      expect(sitePath(bad), bad).toBeNull();
    }
    expect(normalizeTarget("product", "linen-tote")).toBe("products/linen-tote");
    expect(normalizeTarget("product", "/products/linen-tote")).toBe("products/linen-tote");
    expect(normalizeTarget("product", "products/a/b")).toBeNull();
    expect(normalizeTarget("event", "open-studio")).toBe("events/open-studio");
    expect(normalizeTarget("newsletter", "")).toBe("newsletters");
    expect(normalizeTarget("newsletter", "spring-letter")).toBe("newsletters/spring-letter");
    expect(normalizeTarget("gallery", "/g/smith-wedding")).toBe("smith-wedding");
    expect(normalizeTarget("booking", "8B2C4C3E-6F2B-4E7A-9C1D-2F3A4B5C6D7E")).toBe(
      "8b2c4c3e-6f2b-4e7a-9c1d-2f3a4b5c6d7e",
    );
    expect(normalizeTarget("booking", "session")).toBeNull();
  });

  it("turns each kind into the site's own address for it", () => {
    expect(destinationOf(link())).toEqual({ external: true, href: "https://example.test/shop" });
    expect(destinationOf(link({ kind: "page", target: "" }))).toEqual({ external: false, href: "/" });
    expect(destinationOf(link({ kind: "gallery", target: "coast" }))).toEqual({ external: false, href: "/g/coast" });
    expect(destinationOf(link({ kind: "booking", target: "8b2c4c3e-6f2b-4e7a-9c1d-2f3a4b5c6d7e" }))).toEqual({
      external: false,
      href: "/book?service=8b2c4c3e-6f2b-4e7a-9c1d-2f3a4b5c6d7e",
    });
    expect(destinationOf(link({ target: "javascript:alert(1)" }))).toBeNull();
  });

  it("never resolves an on-site destination to another origin", () => {
    const landed = new URL(internalDestination("/products/linen-tote", "abcd2345ef", ORIGIN)!);
    expect(landed.origin).toBe(ORIGIN);
    expect(landed.searchParams.get("utm_source")).toBe("bio");
    expect(landed.searchParams.get("utm_campaign")).toBe("bio:abcd2345ef");
    expect(internalDestination("//evil.example/x", "abcd2345ef", ORIGIN)).toBeNull();
    expect(internalDestination("https://evil.example/x", "abcd2345ef", ORIGIN)).toBeNull();
  });

  it("points every button at the first-party click door", () => {
    expect(clickHref("abcd2345ef", "/links")).toBe("/go/link/abcd2345ef?from=%2Flinks");
    expect(clickHref("abcd2345ef", "/links", "fr")).toBe("/go/link/abcd2345ef?from=%2Flinks&lang=fr");
  });

  it("links social profiles only to real addresses", () => {
    expect(socialHref({ network: "instagram", url: "https://instagram.example/a" })).toBe("https://instagram.example/a");
    expect(socialHref({ network: "email", url: "hi@example.test" })).toBe("mailto:hi@example.test");
    expect(socialHref({ network: "x", url: "mailto:hi@example.test" })).toBeNull();
    expect(socialHref({ network: "x", url: "javascript:alert(1)" })).toBeNull();
  });
});

describe("when a link shows", () => {
  it("reads a wall-clock time in the business's zone", () => {
    // A zone with no daylight time, so the expectation does not depend on
    // which tz database release the machine running the test carries.
    const tokyo = "Asia/Tokyo";
    expect(scheduleInstant("2027-03-20T09:00", tokyo, "start")?.toISOString()).toBe("2027-03-20T00:00:00.000Z");
    expect(scheduleInstant("2027-03-20T09:00:00Z", tokyo, "start")?.toISOString()).toBe("2027-03-20T09:00:00.000Z");
    expect(scheduleInstant("2027-03-20T09:00+02:00", tokyo, "start")?.toISOString()).toBe("2027-03-20T07:00:00.000Z");
    // An end date with no time means through that day.
    expect(scheduleInstant("2027-01-31", tokyo, "end")?.toISOString()).toBe("2027-01-31T15:00:00.000Z");
    expect(scheduleInstant("2027-01-31", tokyo, "start")?.toISOString()).toBe("2027-01-30T15:00:00.000Z");
    expect(scheduleInstant("", tokyo, "start")).toBeUndefined();
    expect(scheduleInstant("2027-02-31", tokyo, "start")).toBeNull();
    expect(scheduleInstant("soon", tokyo, "start")).toBeNull();
  });

  it("explains every reason a link is not on the page", () => {
    const now = new Date("2099-06-01T12:00:00Z");
    expect(linkState(link(), now, ZONE)).toBe("live");
    expect(linkState(link({ hidden: true }), now, ZONE)).toBe("hidden");
    expect(linkState(link({ label: " " }), now, ZONE)).toBe("needsLabel");
    expect(linkState(link({ target: "" }), now, ZONE)).toBe("needsTarget");
    expect(linkState(link({ startsAt: "2099-07-01" }), now, ZONE)).toBe("scheduled");
    expect(linkState(link({ endsAt: "2099-05-01" }), now, ZONE)).toBe("expired");
    expect(linkState(link({ startsAt: "2099-05-02", endsAt: "2099-05-01" }), now, ZONE)).toBe("invalidSchedule");
    expect(linkState(link({ startsAt: "whenever" }), now, ZONE)).toBe("invalidSchedule");
    // Hidden wins over an expired window: it is the switch flipped last.
    expect(linkState(link({ hidden: true, endsAt: "2099-05-01" }), now, ZONE)).toBe("hidden");
  });
});

describe("the stored block", () => {
  it("gives every entry a stable, unique id on save, and keeps the ones it has", () => {
    const parsed = linkInBioPropsSchema.parse({
      links: [{ label: "A" }, { id: "abcd2345ef", label: "B" }, { id: "abcd2345ef", label: "C" }],
    });
    const ids = parsed.links.map((each) => each.id);
    expect(ids[1]).toBe("abcd2345ef");
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => /^[a-z0-9]{4,24}$/.test(id))).toBe(true);
    // A half-written entry saves: the editor autosaves while somebody types.
    expect(() => linkInBioPropsSchema.parse({ links: [{ label: "", target: "" }] })).not.toThrow();
  });

  it("finds a link anywhere on the page, including inside a variant", () => {
    const tree = [
      {
        id: "exp",
        type: "experiment",
        props: {},
        children: [{ id: "bio", type: "linkInBio", props: { links: [link()] } }],
      },
    ];
    expect(findLink(tree, "abcd2345ef")?.block.id).toBe("bio");
    expect(findLink(tree, "nope")).toBeNull();
  });

  it("derives an editor form that hides the id and offers date-time pickers", () => {
    const fields = deriveFields("linkInBio", linkInBio.schema, linkInBio.fieldHints);
    const links = fields.find((field) => field.name === "links");
    expect(links?.kind).toBe("list");
    const items = links?.itemFields?.map((field) => [field.name, field.kind]);
    expect(items).not.toContainEqual(expect.arrayContaining(["id"]));
    expect(items).toContainEqual(["startsAt", "datetime"]);
    expect(items).toContainEqual(["kind", "choice"]);
    expect(fields.find((field) => field.name === "avatarAssetId")?.kind).toBe("asset");
  });

  it("counts as the page's H1 for the publish gate", () => {
    const tree = [{ id: "bio", type: "linkInBio", props: { headingLevel: 1 } }];
    expect(analyzeAccessibility(tree).some((hint) => hint.code === "missingH1")).toBe(false);
    const doubled = [...tree, { id: "h", type: "heading", props: { level: 1, text: "Hi" } }];
    expect(analyzeAccessibility(doubled).some((hint) => hint.code === "multipleH1")).toBe(true);
  });

  it("makes a monogram from the name", () => {
    expect(monogram("Harbour Lane Ceramics")).toBe("HL");
    expect(monogram("")).toBe("");
  });
});

/* ---------------------------------------------------------------- render */

const messages = en as Record<string, string>;
const ctx: BlockRenderContext = {
  locale: "en",
  t: (key: string) => messages[key] ?? key,
  business: { name: "Harbour Lane Ceramics", tagline: null, defaultLocale: "en", enabledLocales: ["en"] },
  path: "/links",
};

function draw(props: Record<string, unknown>, resolved: Parameters<typeof linkInBio.render>[0]["resolved"]): string {
  const parsed = linkInBioPropsSchema.parse(props);
  return renderToStaticMarkup(linkInBio.render({ props: parsed, ctx, resolved }) as ReactElement);
}

const RESOLVED = {
  avatar: null,
  links: [
    { id: "abcd2345ef", label: "Visit the shop", kind: "product" as const, external: false },
    { id: "wxyz2345ab", label: "Listen to the podcast", kind: "url" as const, external: true },
  ],
};

describe("the public block", () => {
  const html = draw(
    {
      bio: "Hand-thrown stoneware.",
      socials: [
        { network: "instagram", url: "https://instagram.example/harbour" },
        { network: "x", url: "javascript:alert(1)" },
      ],
    },
    RESOLVED,
  );

  it("draws the profile, the links in order and the social icons", () => {
    expect(html).toContain("<h1");
    expect(html).toContain("Harbour Lane Ceramics");
    expect(html).toContain("Hand-thrown stoneware.");
    expect(html.indexOf("Visit the shop")).toBeLessThan(html.indexOf("Listen to the podcast"));
    expect(html).toContain('href="/go/link/abcd2345ef?from=%2Flinks"');
    expect(html).toContain('rel="me noopener"');
    expect(html).toContain('href="https://instagram.example/harbour"');
    // An unsafe social address is dropped, not rendered.
    expect(html).not.toContain("javascript:");
    // The external link says so to a screen reader.
    expect(html).toContain(messages["linkinbio.public.external"]);
  });

  it("uses semantic tokens only", () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|bg-(white|black|gray|blue)/i);
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-on-accent");
  });

  it("passes the axe smoke test", async () => {
    const doc = `<!doctype html><html lang="en"><head><title>Links</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body><main>${html}</main></body></html>`;
    const result = (await auditHtml(doc, "https://example.test/links")) as { violations: Array<{ id: string }> };
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });

  it("emits ProfilePage structured data with only the safe profiles", () => {
    const data = linkInBio.jsonLd!(
      linkInBioPropsSchema.parse({
        name: "Harbour Lane",
        socials: [
          { network: "instagram", url: "https://instagram.example/harbour" },
          { network: "email", url: "hi@example.test" },
        ],
      }),
    );
    expect(data).toMatchObject({
      "@type": "ProfilePage",
      mainEntity: { name: "Harbour Lane", sameAs: ["https://instagram.example/harbour"] },
    });
  });
});
