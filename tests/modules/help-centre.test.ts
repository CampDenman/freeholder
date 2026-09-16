// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The help centre (MASTER.md §4.6, C8.12).
//
// One test per rule §4.6 states, because the rules are the design. The one
// worth reading first is "an article is a page": there is no article table
// here, so every one of these tests reaches for `pages` to prove it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { helpCategories, pages } from "@/modules/cms/schema";
import {
  createPage,
  deleteHelpCategory,
  fileHelpArticle,
  helpArticleAt,
  helpArticleFeedback,
  helpArticles,
  helpCategoryList,
  publishPage,
  rateHelpArticle,
  saveHelpCategory,
  searchHelp,
} from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function category(slug: string, name: string, position = 0) {
  return saveHelpCategory.call({ slug, name, locale: "en", position }, OWNER);
}

/** A page, optionally filed and optionally published — the three states. */
async function page(opts: {
  slug: string;
  title: string;
  body?: string;
  categoryId?: string | null;
  published?: boolean;
}) {
  const created = await createPage.call(
    {
      slug: opts.slug,
      locale: "en",
      title: opts.title,
      // Exactly one H1, because the CMS refuses to publish a page without
      // one (§32: "the drag-and-drop layer can't produce pages that fail
      // the SEO gate"). An article inherits that rule by being a page,
      // which is the point — the help centre did not get its own weaker one.
      blocks: [
        { type: "heading", props: { text: opts.title, level: 1 } },
        ...(opts.body ? [{ type: "text", props: { body: opts.body } }] : []),
      ],
    },
    OWNER,
  );
  if (opts.categoryId !== undefined) {
    await fileHelpArticle.call({ pageId: created.id, categoryId: opts.categoryId }, OWNER);
  }
  if (opts.published) {
    await publishPage.call({ id: created.id, published: true }, OWNER);
  }
  return created;
}

describe.runIf(hasDatabase)("the help centre", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("is the CMS: an article is a page, not a row in a second table", async () => {
    // §4.6: "The help centre is the CMS, not a second CMS." The proof is that
    // filing a page changes nothing about it except one column — same id, same
    // slug, same URL, still a page the block editor can open.
    const hours = await category("hours", "Opening hours");
    const created = await page({ slug: "help/opening-hours", title: "Opening hours" });

    await fileHelpArticle.call({ pageId: created.id, categoryId: hours.id }, OWNER);

    const [row] = await db().select().from(pages).where(eq(pages.id, created.id));
    expect(row!.slug).toBe("help/opening-hours");
    expect(row!.helpCategoryId).toBe(hours.id);
    // The counters exist on the page itself, which is what makes them survive
    // every editor, translation and publish the CMS already has.
    expect(row!.helpfulYes).toBe(0);
    expect(row!.helpfulNo).toBe(0);
  });

  it("shows a reader only what is published and filed", async () => {
    const hours = await category("hours", "Opening hours");
    await page({ slug: "help/open", title: "When we open", categoryId: hours.id, published: true });
    await page({ slug: "help/draft", title: "Not finished", categoryId: hours.id });
    await page({ slug: "about", title: "About us", published: true });

    const listed = await helpArticles.call({ locale: "en" }, ANONYMOUS);
    expect(listed.map((a) => a.slug)).toEqual(["help/open"]);
  });

  it("counts only published articles in a category", async () => {
    // Saying "3 articles" above nothing a reader can open is a small lie, and
    // the small ones are the ones nobody fixes.
    const hours = await category("hours", "Opening hours");
    await page({ slug: "help/a", title: "A", categoryId: hours.id, published: true });
    await page({ slug: "help/b", title: "B", categoryId: hours.id });

    const [listed] = await helpCategoryList.call({ locale: "en" }, ANONYMOUS);
    expect(listed!.articleCount).toBe(1);
  });

  it("searches the body, not only the title", async () => {
    // §4.6: "Somebody looking for help types a fragment of the problem, not a
    // stemmed keyword." The word they type is usually in the article, not in
    // the heading somebody else chose for it.
    const hours = await category("hours", "Opening hours");
    await page({
      slug: "help/opening-hours",
      title: "When we open",
      body: "The studio opens at nine on weekdays and stays closed on Sunday.",
      categoryId: hours.id,
      published: true,
    });

    const byTitle = await searchHelp.call({ q: "open", locale: "en" }, ANONYMOUS);
    expect(byTitle.map((a) => a.slug)).toEqual(["help/opening-hours"]);

    const byBody = await searchHelp.call({ q: "Sunday", locale: "en" }, ANONYMOUS);
    expect(byBody.map((a) => a.slug)).toEqual(["help/opening-hours"]);

    const neither = await searchHelp.call({ q: "parking", locale: "en" }, ANONYMOUS);
    expect(neither).toEqual([]);
  });

  it("takes a yes or a no and offers nowhere to type", async () => {
    // Two counters and no comment box. The contract is the enforcement: there
    // is no field to put a sentence in, so no unstaffed queue can form.
    const hours = await category("hours", "Opening hours");
    const article = await page({
      slug: "help/open",
      title: "When we open",
      categoryId: hours.id,
      published: true,
    });

    await rateHelpArticle.call({ articleId: article.id, helpful: true }, ANONYMOUS);
    await rateHelpArticle.call({ articleId: article.id, helpful: false }, ANONYMOUS);
    const after = await rateHelpArticle.call({ articleId: article.id, helpful: true }, ANONYMOUS);

    expect(after.helpfulYes).toBe(2);
    expect(after.helpfulNo).toBe(1);
    // There is nowhere for a sentence to go: the page carries two integer
    // counters and no text column, so an unstaffed support queue cannot
    // form here even if a future caller wanted to open one.
    const [row] = await db().select().from(pages).where(eq(pages.id, article.id));
    expect(Object.keys(row!).filter((k) => k.startsWith("helpful"))).toEqual([
      "helpfulYes",
      "helpfulNo",
    ]);
  });

  it("refuses a vote on something with no readers", async () => {
    const hours = await category("hours", "Opening hours");
    const draft = await page({ slug: "help/draft", title: "Not finished", categoryId: hours.id });

    const error = await failure(
      rateHelpArticle.call({ articleId: draft.id, helpful: true }, ANONYMOUS),
    );
    expect(error.code).toBe("not_found");
  });

  it("uncategorises the writing when a category goes, and never deletes it", async () => {
    // The destructive-sounding service is the one that must not destroy: an
    // uncategorised article is recoverable in a click, and a deleted one is
    // somebody's afternoon.
    const hours = await category("hours", "Opening hours");
    const article = await page({
      slug: "help/open",
      title: "When we open",
      categoryId: hours.id,
      published: true,
    });

    const result = await deleteHelpCategory.call({ id: hours.id }, OWNER);
    expect(result.uncategorised).toBe(1);

    const [row] = await db().select().from(pages).where(eq(pages.id, article.id));
    expect(row).toBeDefined();
    expect(row!.status).toBe("published");
    expect(row!.helpCategoryId).toBeNull();
    // Still a page at the same URL. Leaving the help centre is not unpublishing.
    expect(row!.slug).toBe("help/open");
  });

  it("will not let two categories share a slug in one language", async () => {
    await category("hours", "Opening hours");
    const error = await failure(category("hours", "When we are open"));
    expect(error.code).toBe("conflict");

    // The same slug in another language is a different category, because that
    // is how §4.9 already treats the pages these categories arrange.
    const french = await saveHelpCategory.call(
      { slug: "hours", name: "Horaires", locale: "fr" },
      OWNER,
    );
    expect(french.slug).toBe("hours");
    const rows = await db().select().from(helpCategories).where(eq(helpCategories.slug, "hours"));
    expect(rows).toHaveLength(2);
  });

  it("answers whether any given path is an article", async () => {
    const hours = await category("hours", "Opening hours");
    await page({ slug: "help/open", title: "When we open", categoryId: hours.id, published: true });
    await page({ slug: "about", title: "About us", published: true });

    const article = await helpArticleAt.call({ slug: "help/open", locale: "en" }, ANONYMOUS);
    expect(article?.title).toBe("When we open");
    // A page that is not an article is not an error — it is a "no".
    expect(await helpArticleAt.call({ slug: "about", locale: "en" }, ANONYMOUS)).toBeNull();
    expect(await helpArticleAt.call({ slug: "nothing/here", locale: "en" }, ANONYMOUS)).toBeNull();
  });

  it("shows the owner the article people said did not help, first", async () => {
    const hours = await category("hours", "Opening hours");
    const good = await page({
      slug: "help/good",
      title: "This one lands",
      categoryId: hours.id,
      published: true,
    });
    const bad = await page({
      slug: "help/bad",
      title: "This one does not",
      categoryId: hours.id,
      published: true,
    });

    await rateHelpArticle.call({ articleId: good.id, helpful: true }, ANONYMOUS);
    await rateHelpArticle.call({ articleId: bad.id, helpful: false }, ANONYMOUS);
    await rateHelpArticle.call({ articleId: bad.id, helpful: false }, ANONYMOUS);

    const report = await helpArticleFeedback.call({ locale: "en" }, OWNER);
    expect(report[0]!.slug).toBe("help/bad");
    expect(report[0]!.helpfulNo).toBe(2);
  });

  it("keeps a category's articles in the owner's order, then newest", async () => {
    const second = await category("billing", "Billing", 2);
    const first = await category("hours", "Opening hours", 1);
    await page({ slug: "help/pay", title: "Paying", categoryId: second.id, published: true });
    await page({ slug: "help/open", title: "Opening", categoryId: first.id, published: true });

    const listed = await helpArticles.call({ locale: "en" }, ANONYMOUS);
    expect(listed.map((a) => a.categorySlug)).toEqual(["hours", "billing"]);

    const scoped = await helpArticles.call({ locale: "en", categorySlug: "billing" }, ANONYMOUS);
    expect(scoped.map((a) => a.slug)).toEqual(["help/pay"]);
  });

  it("does not let a page be filed under a category that is not there", async () => {
    const created = await page({ slug: "help/open", title: "When we open" });
    const error = await failure(
      fileHelpArticle.call(
        { pageId: created.id, categoryId: "00000000-0000-4000-8000-000000000000" },
        OWNER,
      ),
    );
    expect(error.code).toBe("not_found");

    const [row] = await db()
      .select()
      .from(pages)
      .where(and(eq(pages.id, created.id), eq(pages.locale, "en")));
    expect(row!.helpCategoryId).toBeNull();
  });
});
