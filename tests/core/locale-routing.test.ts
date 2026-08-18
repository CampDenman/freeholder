// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locale routing and content translation (MASTER.md §4.9, §5).
//
// The design decision under test is that a translated page is *the same page
// with different words* — same slug, same place in the hierarchy, same
// publication state — rather than a second page somebody has to remember to
// keep in step. Almost every assertion here is a consequence of that.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { LOCALE_HEADER } from "@/core/http/headers";
import { localePath } from "../../app/(public)/[[...slug]]/alternates";
import {
  getTranslation,
  setTranslation,
  translatedIds,
} from "@/core/i18n/service";
import {
  createPage,
  publishedPaths,
  publishPage,
  resolvePage,
} from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const BILINGUAL = {
  name: "Aurora Coast",
  schemaType: "Photographer",
  country: "CA",
  defaultLocale: "en",
  enabledLocales: ["en", "fr-CA"],
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  units: "metric" as const,
  firstDayOfWeek: 1,
};

describe("the URL strategy at the edge", () => {
  const rewriteOf = (path: string) => {
    const response = proxy(new NextRequest(new URL(`https://example.test${path}`)));
    return {
      to: response.headers.get("x-middleware-rewrite"),
      locale: response.headers.get("x-middleware-request-" + LOCALE_HEADER),
    };
  };

  it("strips a language prefix and rewrites to the plain path", () => {
    const { to } = rewriteOf("/fr-CA/services/weddings");
    expect(to && new URL(to).pathname).toBe("/services/weddings");
  });

  it("handles a prefix with nothing after it", () => {
    const { to } = rewriteOf("/fr-CA");
    expect(to && new URL(to).pathname).toBe("/");
  });

  it("leaves an ordinary path alone", () => {
    // Two segments that are not a language tag, and the home page.
    expect(rewriteOf("/services/weddings").to).toBeNull();
    expect(rewriteOf("/about").to).toBeNull();
  });

  it("does not treat the admin as translatable", () => {
    // The admin is not a public surface and has no URL locale (§4.9).
    expect(rewriteOf("/admin/pages").to).toBeNull();
    expect(rewriteOf("/fr/admin/pages").to).toBeNull();
  });

  it("rewrites the customer portal without minting analytics cookies", () => {
    const response = proxy(new NextRequest(
      new URL("https://example.test/fr/portal/privacy"),
    ));
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname)
      .toBe("/portal/privacy");
    expect(response.headers.get("x-middleware-request-" + LOCALE_HEADER)).toBe("fr");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("where a page lives in each locale", () => {
  it("leaves the default locale unprefixed and prefixes the rest", () => {
    expect(localePath("", "en", "en")).toBe("/");
    expect(localePath("services", "en", "en")).toBe("/services");
    expect(localePath("", "fr-CA", "en")).toBe("/fr-CA");
    expect(localePath("services/weddings", "fr-CA", "en")).toBe(
      "/fr-CA/services/weddings",
    );
  });
});

describe.runIf(hasDatabase)("translating content", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BILINGUAL, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  const publishedPage = async () => {
    const page = await createPage.call(
      {
        slug: "services",
        title: "Services",
        seo: { title: "Services" },
        blocks: [{ id: "h", type: "heading", props: { text: "Services", level: 1 } }],
      },
      STAFF,
    );
    await publishPage.call({ id: page.id, published: true }, STAFF);
    return page;
  };

  it("serves the translation in place of the original", async () => {
    const page = await publishedPage();
    await setTranslation.call(
      {
        entityType: "page",
        entityId: page.id,
        locale: "fr-CA",
        status: "reviewed",
        fields: { title: "Prestations" },
      },
      STAFF,
    );

    // Same slug, same page, different words — that is the whole design.
    const english = await resolvePage.call({ slug: "services", locale: "en" }, ANONYMOUS);
    const french = await resolvePage.call({ slug: "services", locale: "fr-CA" }, ANONYMOUS);
    expect(english?.title).toBe("Services");
    expect(french?.title).toBe("Prestations");
    expect(french?.id).toBe(english?.id);
  });

  it("falls back to the site's own language rather than a 404", async () => {
    // A visitor who followed a French link to an untranslated page should read
    // the English one. hreflang never advertised a French version, so nothing
    // promised otherwise.
    await publishedPage();
    const french = await resolvePage.call({ slug: "services", locale: "fr-CA" }, ANONYMOUS);
    expect(french?.title).toBe("Services");
  });

  it("does not publish a machine draft", async () => {
    // §4.9 permits machine translation to draft and forbids it publishing
    // silently. The read path is the only place that can enforce it.
    const page = await publishedPage();
    await setTranslation.call(
      {
        entityType: "page",
        entityId: page.id,
        locale: "fr-CA",
        status: "machine",
        fields: { title: "Prestations (machine)" },
      },
      STAFF,
    );

    const french = await resolvePage.call({ slug: "services", locale: "fr-CA" }, ANONYMOUS);
    expect(french?.title).toBe("Services");

    // It is not lost — an owner reviewing it can see it.
    const stored = await getTranslation.call(
      { entityType: "page", entityId: page.id, locale: "fr-CA", includeUnreviewed: true },
      STAFF,
    );
    expect((stored?.fields as { title: string }).title).toContain("machine");
  });

  it("refuses a locale the site does not publish", async () => {
    const page = await publishedPage();
    const error = await failure(
      setTranslation.call(
        {
          entityType: "page",
          entityId: page.id,
          locale: "de",
          fields: { title: "Leistungen" },
        },
        STAFF,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("does not publish");
  });

  it("refuses to translate a page into its own language", async () => {
    // Two homes for one language and no rule about which wins.
    const page = await publishedPage();
    const error = await failure(
      setTranslation.call(
        { entityType: "page", entityId: page.id, locale: "en", fields: {} },
        STAFF,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("is not something a visitor can write", async () => {
    const page = await publishedPage();
    expect(
      (
        await failure(
          setTranslation.call(
            { entityType: "page", entityId: page.id, locale: "fr-CA", fields: {} },
            ANONYMOUS,
          ),
        )
      ).code,
    ).toBe("permission");
  });
});

describe.runIf(hasDatabase)("what each locale's sitemap lists", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BILINGUAL, OWNER);
  });

  it("lists every page for the site's own language, unprefixed", async () => {
    const page = await createPage.call(
      {
        slug: "about",
        title: "About",
        blocks: [{ id: "h", type: "heading", props: { text: "About", level: 1 } }],
      },
      STAFF,
    );
    await publishPage.call({ id: page.id, published: true }, STAFF);

    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths.map((p: { slug: string }) => p.slug)).toEqual(["about"]);
  });

  it("lists only what the other locale actually has, prefixed", async () => {
    // Listing an untranslated page under /fr-CA/ would advertise a French page
    // that is in English — which is how a site earns a duplicate-content
    // problem in two languages instead of one.
    const translated = await createPage.call(
      {
        slug: "about",
        title: "About",
        blocks: [{ id: "h", type: "heading", props: { text: "About", level: 1 } }],
      },
      STAFF,
    );
    await publishPage.call({ id: translated.id, published: true }, STAFF);
    const untranslated = await createPage.call(
      {
        slug: "contact",
        title: "Contact",
        blocks: [{ id: "h2", type: "heading", props: { text: "Contact", level: 1 } }],
      },
      STAFF,
    );
    await publishPage.call({ id: untranslated.id, published: true }, STAFF);

    await setTranslation.call(
      {
        entityType: "page",
        entityId: translated.id,
        locale: "fr-CA",
        status: "reviewed",
        fields: { title: "À propos" },
      },
      STAFF,
    );

    const paths = await publishedPaths.call({ locale: "fr-CA" }, ANONYMOUS);
    expect(paths.map((p: { slug: string }) => p.slug)).toEqual(["fr-CA/about"]);
  });

  it("knows which pages are translated, for hreflang", async () => {
    const page = await createPage.call({ slug: "about", title: "About" }, STAFF);
    await setTranslation.call(
      {
        entityType: "page",
        entityId: page.id,
        locale: "fr-CA",
        status: "reviewed",
        fields: { title: "À propos" },
      },
      STAFF,
    );
    expect(
      await translatedIds.call(
        { entityType: "page", locale: "fr-CA", ids: [page.id] },
        ANONYMOUS,
      ),
    ).toEqual([page.id]);

    // A machine draft is not something to advertise to a search engine.
    await setTranslation.call(
      {
        entityType: "page",
        entityId: page.id,
        locale: "fr-CA",
        status: "machine",
        fields: { title: "À propos" },
      },
      STAFF,
    );
    expect(
      await translatedIds.call(
        { entityType: "page", locale: "fr-CA", ids: [page.id] },
        ANONYMOUS,
      ),
    ).toEqual([]);
  });
});
