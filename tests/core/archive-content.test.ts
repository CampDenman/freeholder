// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: static documents, audio and video keep real typed asset references.
import { describe, expect, it } from "vitest";
import { archiveBodyToBlocks, type ArchiveMediaMatch } from "@/core/import/archive-content";
import { parseBlockTree } from "@/modules/cms/blocks/registry";

const ids = { doc: "019ac001-0000-4000-8000-000000000001", audio: "019ac001-0000-4000-8000-000000000002", video: "019ac001-0000-4000-8000-000000000003", image: "019ac001-0000-4000-8000-000000000004" };
const media: Record<string, ArchiveMediaMatch> = {};
for (const kind of ["doc", "audio", "video", "image"] as const) media[`https://archive.example/${kind}`] = { assetId: ids[kind], kind, filename: `fixture-${kind}` };
const convert = (html: string) => archiveBodyToBlocks(html, { slug: "fixture", title: "Fixture", resolveMedia: src => media[src] ?? null, resolveImage: src => media[src]?.kind === "image" ? { assetId: media[src].assetId } : null, rewriteHref: href => href });

describe("static archive typed media", () => {
  it("preserves document link text and native video/audio through valid CMS blocks", () => {
    const result = convert('<p>Before <a href="https://archive.example/doc">Read the brochure</a> after.</p><video controls src="https://archive.example/video"></video><audio><source src="https://archive.example/audio"></audio>');
    expect(result.overBudget).toBeNull();
    const blocks = parseBlockTree(result.blocks, "page");
    expect(blocks.filter(block => block.type === "file").map(block => [block.props.assetId, block.props.label])).toEqual([[ids.doc, "Read the brochure"], [ids.audio, "fixture-audio"]]);
    expect(blocks.find(block => block.type === "video")?.props.assetId).toBe(ids.video);
    expect(JSON.stringify(blocks)).toContain("Before");
    expect(JSON.stringify(blocks)).toContain("after.");
    expect(JSON.stringify(blocks)).not.toContain("archive-media-");
    expect(result.droppedEmbeds).toBe(0);
  });
  it("keeps external links and reports unsupported external players without loading them", () => {
    const result = convert('<p><a href="https://elsewhere.example/file.pdf">External brochure</a></p><video src="https://elsewhere.example/movie.mp4"></video><script>unsafe()</script>');
    expect(JSON.stringify(result.blocks)).toContain("https://elsewhere.example/file.pdf");
    expect(result.blocks.some(block => ["video", "file"].includes(block.type))).toBe(false);
    expect(result.droppedEmbeds).toBe(1);
    expect(JSON.stringify(result.blocks)).not.toContain("unsafe()");
  });
  it("keeps native images alongside files in a source gallery", () => {
    const result = convert('<figure class="wp-block-gallery"><figure><img src="https://archive.example/image" alt="Blue square"></figure><figure><a href="https://archive.example/doc">Brochure</a></figure></figure>');
    expect(result.overBudget).toBeNull();
    expect(parseBlockTree(result.blocks, "page").filter(block => ["image", "file"].includes(block.type)).map(block => [block.type, block.props.assetId])).toEqual([["image", ids.image], ["file", ids.doc]]);
  });
});
