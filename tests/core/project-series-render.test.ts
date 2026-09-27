// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public rendering half of a published progress series (MASTER.md C8.16).
//
// A time series is only a series if the page reads as one: frames in the
// order the pictures were taken, each dated, grouped apart from the
// before/after pairs. The consent gate decides whether the series may render
// at all; this is the proof that rendering it says something true.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedImage } from "@/core/media/service";
import { projectCaseStudy } from "@/modules/projects/blocks";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";

function t(key: string) {
  return key;
}

const ctx: BlockRenderContext = {
  locale: "en",
  t,
  business: null,
  path: "/portfolio/aligner-course",
};

const image: ResolvedImage = {
  src: "/media/week-0.webp",
  sources: [],
  width: 800,
  height: 600,
  altText: "Smile, week zero",
};

type MediaItem = {
  assetId: string;
  role: "hero" | "gallery" | "before" | "after" | "series" | "process" | "detail";
  pairKey: string | null;
  seriesKey: string | null;
  capturedAt: string | null;
  caption: string | null;
  position: number;
};

function frame(overrides: Partial<MediaItem>): { item: MediaItem; image: ResolvedImage } {
  return {
    item: {
      assetId: "11111111-1111-4111-8111-111111111111",
      role: "series",
      pairKey: null,
      seriesKey: "progress",
      capturedAt: "2026-07-01T00:00:00.000Z",
      caption: null,
      position: 0,
      ...overrides,
    },
    image: { ...image },
  };
}

function render(props: Record<string, unknown>, media: Array<ReturnType<typeof frame>>) {
  const parsed = projectCaseStudy.schema.parse({
    projectId: "22222222-2222-4222-8222-222222222222",
    summary: null,
    clientDisplayName: null,
    occurredOn: null,
    coverAssetId: null,
    featured: false,
    services: [],
    outcomes: [],
    media: [],
    testimonials: [],
    ...props,
  });
  return renderToStaticMarkup(
    createElement(projectCaseStudy.render, { props: parsed, resolved: { cover: null, media }, ctx }),
  );
}

describe("projectCaseStudy progress series rendering", () => {
  it("orders series frames by when they were taken, not how they were filed", () => {
    const html = render({}, [
      frame({ assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", caption: "Filed second, taken third", capturedAt: "2026-09-01T00:00:00.000Z" }),
      frame({ assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", caption: "Filed first, taken first", capturedAt: "2026-05-01T00:00:00.000Z" }),
      frame({ assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", caption: "Filed third, taken second", capturedAt: "2026-07-01T00:00:00.000Z" }),
    ]);
    expect(html).toContain("projects.public.progress");
    const order = [
      html.indexOf("taken first"),
      html.indexOf("taken second"),
      html.indexOf("taken third"),
    ];
    expect(order[0]).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Every frame carries its capture date in a machine-readable element.
    expect(html).toContain('<time dateTime="2026-05-01T00:00:00.000Z">2026-05-01</time>');
  });

  it("keeps pairs, series and loose media apart", () => {
    const html = render({}, [
      frame({
        assetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        role: "before",
        pairKey: "smile",
        seriesKey: null,
        capturedAt: null,
        caption: "The before frame",
      }),
      frame({
        assetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        role: "after",
        pairKey: "smile",
        seriesKey: null,
        capturedAt: null,
        caption: "The after frame",
      }),
      frame({ assetId: "ffffffff-ffff-4fff-8fff-ffffffffffff", caption: "A series frame" }),
      frame({
        assetId: "99999999-9999-4999-8999-999999999999",
        role: "detail",
        seriesKey: null,
        caption: "A loose detail",
      }),
    ]);
    // The pair lands in the comparison section with its role label.
    expect(html).toContain("projects.public.comparison");
    expect(html).toContain("projects.public.before");
    expect(html).toContain("projects.public.after");
    // The series frame is not filed as a loose image and the loose image is
    // not pulled into the series.
    const looseList = html.slice(html.indexOf('<ul class="grid list-none'));
    expect(looseList).toContain("A loose detail");
    expect(looseList).not.toContain("A series frame");
  });

  it("parses snapshots published before series existed", () => {
    // Snapshots already live in page rows from before the series role: media
    // entries without series metadata must still validate and render.
    const legacy = {
      assetId: "77777777-7777-4777-8777-777777777777",
      role: "gallery",
      pairKey: null,
      caption: "Legacy frame",
      position: 3,
    };
    const parsed = projectCaseStudy.schema.parse({
      projectId: "22222222-2222-4222-8222-222222222222",
      media: [legacy],
    });
    expect(parsed.media[0]).toMatchObject({ seriesKey: null, capturedAt: null });
    const [legacyFrame] = parsed.media;
    const html = render(
      {},
      legacyFrame ? [{ item: legacyFrame, image: { ...image } }] : [],
    );
    expect(html).toContain("Legacy frame");
  });
});
