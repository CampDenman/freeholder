// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Trust, conversion and gated blocks (C2.08–C2.10).

import { describe, expect, it } from "vitest";
import { collectJsonLd, parseBlockTree } from "@/modules/cms/blocks/registry";
import { socialEmbed } from "@/modules/cms/blocks/social";
import { submitQuoteRequest } from "@/modules/cms/inbound";
import { afterAll, beforeEach } from "vitest";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("social embeds", () => {
  it("accepts youtube and vimeo and refuses anything else", () => {
    expect(socialEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(socialEmbed("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(socialEmbed("https://vimeo.com/123456789")?.src).toContain("player.vimeo.com/video/123456789");
    expect(socialEmbed("https://example.com/watch?v=nope")).toBeNull();
    expect(socialEmbed("javascript:alert(1)")).toBeNull();
  });
});

describe("parseBlockTree for new surfaces", () => {
  it("accepts the C2.08–C2.10 starters", () => {
    const tree = parseBlockTree(
      [
        { id: "t", type: "testimonial", props: { quote: "Great", name: "Ada" } },
        { id: "s", type: "share", props: {} },
        { id: "q", type: "quoteRequest", props: {} },
        {
          id: "p",
          type: "paywall",
          props: { teaser: "Locked", ctaLabel: "Go", ctaHref: "/contact" },
          children: [{ id: "h", type: "heading", props: { text: "Secret", level: 2 } }],
        },
        { id: "a", type: "adSlot", props: { code: "header" } },
      ],
      "page",
    );
    expect(tree.map((node) => node.type)).toEqual([
      "testimonial",
      "share",
      "quoteRequest",
      "paywall",
      "adSlot",
    ]);
  });

  it("does not leak paywall children into JSON-LD", () => {
    const json = collectJsonLd(
      parseBlockTree(
        [
          {
            id: "p",
            type: "paywall",
            props: { teaser: "Locked", ctaLabel: "Go", ctaHref: "/contact" },
            children: [
              {
                id: "f",
                type: "faq",
                props: { items: [{ question: "Secret?", answer: "Yes." }] },
              },
            ],
          },
        ],
        "page",
      ),
    );
    expect(json.some((row) => row["@type"] === "FAQPage")).toBe(false);
    expect(json.some((row) => row.isAccessibleForFree === false)).toBe(true);
  });

  it("refuses an unknown social host at render time by storing only a URL", () => {
    const [node] = parseBlockTree(
      [{ id: "s", type: "social", props: { url: "https://example.com/x" } }],
      "page",
    );
    expect(node!.props.url).toBe("https://example.com/x");
    expect(socialEmbed(node!.props.url as string)).toBeNull();
  });
});

describe.runIf(hasDatabase)("inbound blocks land on the contact spine", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("resolves a quote request to one contact per email", async () => {
    const first = await submitQuoteRequest.call(
      { name: "Ada", email: "ada@example.com", message: "A wedding in June." },
      { kind: "anonymous" },
    );
    expect(first.ok).toBe(true);
    const again = await submitQuoteRequest.call(
      { name: "Ada Lovelace", email: "ada@example.com", message: "Actually July." },
      { kind: "anonymous" },
    );
    expect(again.ok).toBe(true);
    const { listContacts } = await import("@/core/contacts/service");
    const listed = await listContacts.call({}, OWNER);
    expect(listed.rows.filter((row) => row.email === "ada@example.com")).toHaveLength(1);
  });

  it("refuses a tip that is not integer minor units", async () => {
    const blocked = await failure(
      submitQuoteRequest.call({ name: "", email: "bad", message: "" }, { kind: "anonymous" }),
    );
    expect(blocked.code).toBe("validation");
  });
});
