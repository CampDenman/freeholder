// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locale workflow: machine drafts and SEO completeness (C2.16).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seoComplete } from "@/modules/cms/translation-workflow";
import {
  createPage,
  draftPageTranslation,
  pageTranslationReport,
} from "@/modules/cms/service";
import { getTranslation, setTranslation } from "@/core/i18n/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("seo completeness", () => {
  it("needs a title and a description", () => {
    expect(seoComplete({ title: "Bonjour" })).toBe(false);
    expect(seoComplete({ title: "Bonjour", seo: { description: "Une page." } })).toBe(true);
  });
});

describe.runIf(hasDatabase)("cms translation workflow", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

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

  it("seeds a machine draft that is not reviewed", async () => {
    const page = await bilingualPage();
    const draft = await draftPageTranslation.call({ pageId: page.id, locale: "fr" }, OWNER);
    expect(draft.status).toBe("machine");
    expect((draft.fields as { title?: string }).title).toContain("[draft]");

    const publicRead = await getTranslation.call(
      { entityType: "page", entityId: page.id, locale: "fr" },
      OWNER,
    );
    expect(publicRead).toBeNull();

    const report = await pageTranslationReport.call({ locale: "fr" }, OWNER);
    const row = report.find((item) => item.pageId === page.id);
    expect(row?.status).toBe("machine");
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
});
