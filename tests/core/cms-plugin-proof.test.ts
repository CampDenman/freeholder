// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A plugin can join the editor without touching it (C2.23).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import manifests from "@/modules";
import { paletteFor, parseBlockTree, registerBlock } from "@/modules/cms/blocks/registry";
import { deriveFields } from "@/modules/cms/blocks/fields";
import { notice } from "@/modules/proof/blocks";
import { seedNoticeBlock } from "@/modules/proof/seed";
import { publishedPaths, seedProofNotice } from "@/modules/proof/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("plugin block proof", () => {
  it("registers a schema, renderer and derived editor fields", () => {
    registerBlock(notice as never);
    const entry = paletteFor("page").find((row) => row.type === "notice");
    expect(entry).toBeDefined();
    expect(entry?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["body", "tone"]),
    );
    expect(deriveFields("notice", notice.schema, notice.fieldHints).map((f) => f.kind)).toEqual(
      expect.arrayContaining(["multiline", "choice"]),
    );
    expect(parseBlockTree([seedNoticeBlock()], "page")[0]?.type).toBe("notice");
  });

  it("did not change the core editor to learn about this block", () => {
    const editor = readFileSync("app/(admin)/admin/BlockEditor.tsx", "utf8");
    expect(editor).not.toContain("notice");
    expect(editor).not.toMatch(/proof/i);
  });

  it("declares a migration, sitemap source and seed block", () => {
    const proof = manifests.find((row) => row.name === "proof");
    expect(proof?.requires).toEqual(expect.arrayContaining(["cms"]));
    expect(proof?.seo?.sitemapSources).toEqual(["proof.publishedPaths"]);
    expect(proof?.tables).toBeTypeOf("function");
    expect(proof?.blocks).toBeTypeOf("function");
    const migration = readFileSync("db/migrations/0073_plain_lilandra.sql", "utf8");
    expect(migration).toContain("proof_notices");
    expect(seedNoticeBlock().type).toBe("notice");
  });
});

describe.runIf(hasDatabase)("plugin sitemap source", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("seeds a draft notice that stays off the sitemap until published", async () => {
    const seeded = await seedProofNotice.call({}, OWNER);
    expect(seeded.block.type).toBe("notice");
    expect(await publishedPaths.call({ locale: "en" }, OWNER)).toEqual([]);
  });
});
