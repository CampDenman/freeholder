// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy-paste embeds with a backlink home (MASTER.md C9.36, §34).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { embedSnippet, embedPath, escapeEmbedText } from "@/modules/share/embeds";
import { embedSnippetFor } from "@/modules/share/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("embed snippets", () => {
  it("escapes owner-supplied names in the HTML an owner will paste", () => {
    expect(escapeEmbedText(`A&B <studio> "x"`)).toBe(
      "A&amp;B &lt;studio&gt; &quot;x&quot;",
    );
  });

  it("puts the widget in an iframe and a backlink beside it", () => {
    const snippet = embedSnippet({
      kind: "reviews",
      businessName: "Hearth & Pine",
      title: "Reviews from Hearth & Pine",
    });
    expect(snippet.src).toMatch(/\/embed\/reviews$/);
    expect(snippet.html).toContain("<iframe");
    expect(snippet.html).toContain(snippet.src);
    expect(snippet.html).toContain("<a href=");
    expect(snippet.html).toContain("Hearth &amp; Pine");
    expect(snippet.html).not.toContain("Hearth & Pine</a>");
    expect(embedPath("gallery", "henderson-proofs")).toBe(
      "/embed/gallery/henderson-proofs",
    );
    expect(embedPath("newsletter", "n1")).toBe("/embed/newsletter/n1");
  });
});

describe.runIf(hasDatabase)("share.embedSnippet", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  it("names the business in the snippet and points the backlink at this origin", async () => {
    const snippet = await embedSnippetFor.call({ kind: "reviews" }, OWNER);
    expect(snippet.html).toContain("/embed/reviews");
    expect(snippet.html).toContain("<iframe");
    expect(snippet.backlink).toMatch(/^https?:\/\//);
    expect(snippet.html).toContain("Hearth &amp; Pine");
  });
});
