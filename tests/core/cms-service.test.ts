// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The cms services against a real database (MASTER.md §11, §32).
//
// cms is the first feature module, so these cover two things at once: what the
// services do, and whether the module contract actually holds when something
// other than core uses it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { boot, resetBootForTests } from "@/core/boot";
import { resetRegistryForTests } from "@/core/service";
import { completeSetup, updateBusiness } from "@/core/settings/service";
import coreManifest from "@/core/manifest";
import cmsManifest from "@/modules/cms/manifest";
import {
  createPage,
  createSectionLocale,
  ensureDefaults,
  getSection,
  listRevisions,
  publishPage,
  publishedPaths,
  resolvePage,
  restoreRevision,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  tagline: "Coastal light, honestly made",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  schemaType: "Photographer",
};

describe.runIf(hasDatabase)("the cms module", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("the module contract", () => {
    it("boots alongside core, after it", async () => {
      resetRegistryForTests();
      resetBootForTests();
      // Listed cms-first on purpose: the topo-sort is what must put core
      // first, not the order somebody happened to write.
      const report = await boot([cmsManifest, coreManifest]);
      expect(report.modules).toEqual(["core", "cms"]);
      expect(report.services).toContain("cms.resolvePage");
      expect(report.services).toContain("contacts.create");
    });

    it("subscribes its listener to core's event", async () => {
      resetRegistryForTests();
      resetBootForTests();
      const report = await boot([coreManifest, cmsManifest]);
      expect(report.listeners).toContainEqual({
        event: "settings.setupCompleted",
        module: "cms",
        handler: "onSetupCompleted",
      });
    });
  });

  describe("cms.ensureDefaults", () => {
    it("gives a fresh instance a header, a footer and a home page", async () => {
      await updateBusiness.call(BUSINESS, OWNER);
      const first = await ensureDefaults.call({}, OWNER);
      expect(first.created).toEqual(["section:header", "section:footer", "page:home"]);

      const home = await resolvePage.call({ slug: "" }, ANONYMOUS);
      expect(home?.title).toBe(BUSINESS.name);
      expect(home?.status).toBe("published");

      const header = await getSection.call({ key: "header" }, ANONYMOUS);
      expect(header?.kind).toBe("chrome");
    });

    /**
     * The production bug, reproduced.
     *
     * Setup completed on the live instance and nothing was seeded — no error,
     * no listener, nothing in the audit trail after `settings.completeSetup`.
     * The cause was that boot ran in `instrumentation.ts`'s module graph while
     * requests were served from a different one, so the listener map that boot
     * populated was invisible to the code publishing the event.
     *
     * This asserts the whole chain end to end — service → post-commit event →
     * subscribed listener → seeded rows — and it only passes because a service
     * call now guarantees the platform is booted first (core/runtime.ts).
     */
    it("seeds the site when setup completes, via the event bus", async () => {
      await updateBusiness.call(BUSINESS, OWNER);
      await completeSetup.call({}, OWNER);

      expect(await resolvePage.call({ slug: "" }, ANONYMOUS)).not.toBeNull();
      expect(await getSection.call({ key: "header" }, ANONYMOUS)).not.toBeNull();
      expect(await getSection.call({ key: "footer" }, ANONYMOUS)).not.toBeNull();
    });

    it("is idempotent, so re-running repairs without duplicating", async () => {
      await updateBusiness.call(BUSINESS, OWNER);
      await ensureDefaults.call({}, OWNER);
      const second = await ensureDefaults.call({}, OWNER);
      expect(second.created).toEqual([]);
    });
  });

  describe("pages", () => {
    it("serves only published pages to the public", async () => {
      const page = await createPage.call(
        { slug: "about", title: "About", blocks: [] },
        STAFF,
      );
      // A draft is not "unlisted" — it is not readable by URL at all.
      expect(await resolvePage.call({ slug: "about" }, ANONYMOUS)).toBeNull();

      await publishPage.call({ id: page.id, published: true }, STAFF);
      expect((await resolvePage.call({ slug: "about" }, ANONYMOUS))?.id).toBe(page.id);

      await publishPage.call({ id: page.id, published: false }, STAFF);
      expect(await resolvePage.call({ slug: "about" }, ANONYMOUS)).toBeNull();
    });

    it("normalizes a path rather than trusting how it was typed", async () => {
      const page = await createPage.call(
        { slug: "/services/weddings/", title: "Weddings" },
        STAFF,
      );
      expect(page.slug).toBe("services/weddings");
    });

    it("refuses a second page at the same path, in plain English", async () => {
      await createPage.call({ slug: "about", title: "About" }, STAFF);
      const error = await failure(
        createPage.call({ slug: "about", title: "About again" }, STAFF),
      );
      expect(error.code).toBe("conflict");
      expect(error.message).toMatch(/already lives at \/about/);
      // The message a business owner reads must not name an index.
      expect(error.message).not.toMatch(/idx|constraint|postgres/i);
    });

    it("refuses an invalid block tree before it reaches the database", async () => {
      const error = await failure(
        createPage.call(
          { slug: "bad", title: "Bad", blocks: [{ id: "x", type: "nope", props: {} }] },
          STAFF,
        ),
      );
      expect(error.code).toBe("validation");
    });

    it("keeps drafts out of the sitemap source", async () => {
      const live = await createPage.call({ slug: "live", title: "Live" }, STAFF);
      await publishPage.call({ id: live.id, published: true }, STAFF);
      await createPage.call({ slug: "hidden", title: "Hidden" }, STAFF);

      const paths = await publishedPaths.call({}, ANONYMOUS);
      expect(paths.map((p) => p.slug)).toEqual(["live"]);
    });
  });

  describe("revisions", () => {
    it("keeps the previous version on every save", async () => {
      const page = await createPage.call(
        {
          slug: "story",
          title: "Story",
          blocks: [{ id: "h", type: "heading", props: { text: "First" } }],
        },
        STAFF,
      );

      await updatePage.call(
        {
          id: page.id,
          blocks: [{ id: "h", type: "heading", props: { text: "Second" } }],
        },
        STAFF,
      );

      const revisions = await listRevisions.call(
        { subjectType: "page", subjectId: page.id },
        STAFF,
      );
      expect(revisions).toHaveLength(1);
      expect((revisions[0]!.blocks as { props: { text: string } }[])[0]!.props.text).toBe(
        "First",
      );
    });

    it("restores an earlier version, and the restore is itself undoable", async () => {
      const page = await createPage.call(
        {
          slug: "story",
          title: "Story",
          blocks: [{ id: "h", type: "heading", props: { text: "Original" } }],
        },
        STAFF,
      );
      await updatePage.call(
        {
          id: page.id,
          blocks: [{ id: "h", type: "heading", props: { text: "Replaced" } }],
        },
        STAFF,
      );

      const [revision] = await listRevisions.call(
        { subjectType: "page", subjectId: page.id },
        STAFF,
      );
      await restoreRevision.call({ revisionId: revision!.id }, STAFF);

      const restored = await resolvePage.call({ slug: "story" }, ANONYMOUS);
      // Draft, so read it back through the staff door.
      const revisionsAfter = await listRevisions.call(
        { subjectType: "page", subjectId: page.id },
        STAFF,
      );
      expect(restored).toBeNull();
      // §37 wants every change reversible in one action — including a restore,
      // which is why restoring writes a revision of what it replaced.
      expect(revisionsAfter).toHaveLength(2);
      expect(
        (revisionsAfter[0]!.blocks as { props: { text: string } }[])[0]!.props.text,
      ).toBe("Replaced");
    });
  });

  describe("chrome", () => {
    it("edits the header as data, keeping a revision", async () => {
      await updateBusiness.call(BUSINESS, OWNER);
      await ensureDefaults.call({}, OWNER);

      await updateSection.call(
        {
          key: "header",
          blocks: [
            {
              id: "nav",
              type: "nav",
              props: { links: [{ label: "About", href: "/about" }] },
            },
          ],
        },
        STAFF,
      );

      const header = await getSection.call({ key: "header" }, ANONYMOUS);
      const blocks = header!.blocks as { type: string }[];
      expect(blocks[0]!.type).toBe("nav");

      const revisions = await listRevisions.call(
        { subjectType: "section", subjectId: header!.id },
        STAFF,
      );
      expect(revisions).toHaveLength(1);
    });

    it("refuses a page-only block in the chrome", async () => {
      await updateBusiness.call(BUSINESS, OWNER);
      await ensureDefaults.call({}, OWNER);
      const error = await failure(
        updateSection.call(
          {
            key: "header",
            blocks: [{ id: "f", type: "faq", props: { items: [{ question: "Q", answer: "A" }] } }],
          },
          STAFF,
        ),
      );
      expect(error.code).toBe("validation");
    });

    it("falls back coherently, then creates an independently editable locale variant", async () => {
      await updateBusiness.call({
        ...BUSINESS,
        defaultLocale: "en",
        enabledLocales: ["en", "fr"],
      }, OWNER);
      await ensureDefaults.call({}, OWNER);

      const fallback = await getSection.call(
        { key: "header", locale: "fr" },
        ANONYMOUS,
      );
      expect(fallback?.locale).toBe("en");
      expect(await getSection.call(
        { key: "header", locale: "fr", fallback: false },
        ANONYMOUS,
      )).toBeNull();

      const localized = await createSectionLocale.call(
        { key: "header", locale: "fr" },
        STAFF,
      );
      expect(localized.locale).toBe("fr");
      expect(JSON.stringify(localized.blocks)).toContain('"type":"locales"');

      await updateSection.call({
        key: "header",
        locale: "fr",
        blocks: [{
          id: "nav-fr",
          type: "nav",
          props: { links: [{ label: "À propos", href: "/about" }] },
        }],
      }, STAFF);
      const french = await getSection.call(
        { key: "header", locale: "fr", fallback: false },
        ANONYMOUS,
      );
      expect(JSON.stringify(french?.blocks)).toContain("À propos");
      expect((await getSection.call({ key: "header" }, ANONYMOUS))?.locale)
        .toBe("en");
    });
  });
});
