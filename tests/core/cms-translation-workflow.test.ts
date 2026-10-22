// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locale workflow: machine drafts and SEO completeness (C2.16).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiAdapters } from "@/adapters/ai";
import type { AiGenerationRequest } from "@/adapters/ai";
import { db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { seoComplete } from "@/modules/cms/translation-workflow";
import {
  createPage,
  draftPageTranslation,
  pageTranslationReport,
} from "@/modules/cms/service";
import { getTranslation, setTranslation } from "@/core/i18n/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { openTransactions } from "../helpers/open-transactions";

describe("seo completeness", () => {
  it("needs a title and a description", () => {
    expect(seoComplete({ title: "Bonjour" })).toBe(false);
    expect(seoComplete({ title: "Bonjour", seo: { description: "Une page." } })).toBe(true);
  });
});

describe.runIf(hasDatabase)("cms translation workflow", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  // The configured instance adapter is "none" in tests; this makes it a
  // working model for one test, and afterEach puts it back.
  const none = aiAdapters.get("none");
  const original = { status: none.status, generate: none.generate.bind(none) };
  afterEach(() => {
    Object.assign(none, original);
  });
  function stubTranslator(during: () => Promise<void> = async () => {}): number[] {
    const seen: number[] = [];
    Object.assign(none, {
      status: { ...original.status, available: true },
      generate: async (request: AiGenerationRequest) => {
        seen.push(await openTransactions());
        await during();
        const source = JSON.parse(request.input) as Record<string, string>;
        const translated: Record<string, string> = {};
        for (const key of Object.keys(source)) translated[key] = `FR ${source[key]}`;
        return {
          structured: translated,
          provider: "none",
          model: "stub",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    });
    return seen;
  }

  async function bilingualPage() {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
        defaultLocale: "en",
        enabledLocales: ["en", "fr"],
      },
      OWNER,
    );
    return createPage.call(
      {
        title: "About",
        slug: "about",
        seo: { description: "Who we are." },
        blocks: [{ id: "h", type: "heading", props: { text: "About us", level: 1 } }],
      },
      OWNER,
    );
  }

  it("seeds an honest draft when no translation model ran", async () => {
    const page = await bilingualPage();
    const draft = await draftPageTranslation.call({ pageId: page.id, locale: "fr" }, OWNER);
    // No AI adapter is configured in tests, so the identity seed must say
    // "draft" — recording "machine" here would tell the owner a French
    // translation exists when the text is still English.
    expect(draft.status).toBe("draft");
    expect((draft.fields as { title?: string }).title).toContain("[draft]");

    const publicRead = await getTranslation.call(
      { entityType: "page", entityId: page.id, locale: "fr" },
      OWNER,
    );
    expect(publicRead).toBeNull();

    const report = await pageTranslationReport.call({ locale: "fr" }, OWNER);
    const row = report.find((item) => item.pageId === page.id);
    expect(row?.status).toBe("draft");
    expect(row?.seoComplete).toBe(true);
  });

  it("refuses to overwrite a reviewed translation", async () => {
    const page = await bilingualPage();
    await setTranslation.call(
      {
        entityType: "page",
        entityId: page.id,
        locale: "fr",
        status: "reviewed",
        fields: { title: "À propos", seo: { description: "Qui nous sommes." } },
      },
      OWNER,
    );
    const blocked = await failure(
      draftPageTranslation.call({ pageId: page.id, locale: "fr" }, OWNER),
    );
    expect(blocked.code).toBe("conflict");
  });

  // MASTER.md §11: a translation model can take many seconds, and no service
  // transaction may wait on it.
  it("drafts with the model while no transaction is open", async () => {
    const page = await bilingualPage();
    const seen = stubTranslator();
    const draft = await draftPageTranslation.call({ pageId: page.id, locale: "fr" }, OWNER);
    expect(seen).toEqual([0]);
    expect(draft.status).toBe("machine");
    expect((draft.fields as { title?: string }).title).toBe("FR About");
  });

  it("refuses a draft of text the owner changed while the model ran", async () => {
    const page = await bilingualPage();
    stubTranslator(async () => {
      await db()
        .update(pages)
        .set({ workingTitle: "About the studio" })
        .where(eq(pages.id, page.id));
    });
    const refused = await failure(
      draftPageTranslation.call({ pageId: page.id, locale: "fr" }, OWNER),
    );
    expect(refused.code).toBe("conflict");
    const stored = await getTranslation.call(
      { entityType: "page", entityId: page.id, locale: "fr", includeUnreviewed: true },
      OWNER,
    );
    expect(stored).toBeNull();
  });
});
