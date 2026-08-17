// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Newsletters: double-opt-in, RFC 8058, public archive, prefs (C9.04).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { publishedPaths } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import { createContact, mergeContacts } from "@/core/contacts/service";
import {
  confirmSubscription,
  createIssue,
  createNewsletter,
  publishIssue,
  rfc8058UnsubscribeHeaders,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "@/modules/newsletters/service";
import { newsletterSubscriptions } from "@/modules/newsletters/schema";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("newsletters module", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("publishes an archive leaf, requires double opt-in, and honours RFC 8058 unsubscribe", async () => {
    const newsletter = await createNewsletter.call(
      { name: "Coast notes", slug: "coast-notes", description: "Studio notes" },
      OWNER,
    );
    const draft = await createIssue.call(
      {
        newsletterId: newsletter.id,
        slug: "august-light",
        title: "August light",
        excerpt: "What the fog did.",
        body: "The strait was silver.",
      },
      OWNER,
    );
    await publishIssue.call({ id: draft.id, expectedVersion: draft.version }, OWNER);

    const [page] = await db()
      .select()
      .from(pages)
      .where(and(eq(pages.slug, "newsletters/august-light"), eq(pages.locale, "en")));
    expect(page).toMatchObject({ status: "published", title: "August light" });
    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths.map((entry) => entry.slug)).toEqual(
      expect.arrayContaining(["newsletters", "newsletters/august-light"]),
    );

    const pending = await subscribeToNewsletter.call(
      { newsletterId: newsletter.id, email: "reader@example.test", name: "Reader" },
      ANONYMOUS,
    );
    expect(pending.status).toBe("pending");
    const [row] = await db()
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.id, pending.subscriptionId));
    const confirmed = await confirmSubscription.call({ token: row!.confirmToken }, ANONYMOUS);
    expect(confirmed.status).toBe("confirmed");

    const headers = rfc8058UnsubscribeHeaders("https://example.test", row!.unsubscribeToken);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toContain("/unsubscribe?token=");

    const left = await unsubscribeFromNewsletter.call({ token: row!.unsubscribeToken }, ANONYMOUS);
    expect(left.status).toBe("unsubscribed");
  });

  it("merges two subscription rows for the same newsletter into the survivor", async () => {
    const newsletter = await createNewsletter.call({ name: "Notes", slug: "notes" }, OWNER);
    const ada = await createContact.call({ name: "Ada", email: "ada@example.test" }, OWNER);
    const grace = await createContact.call({ name: "Grace", email: "grace@example.test" }, OWNER);
    await subscribeToNewsletter.call(
      { newsletterId: newsletter.id, email: "ada@example.test" },
      ANONYMOUS,
    );
    await subscribeToNewsletter.call(
      { newsletterId: newsletter.id, email: "grace@example.test" },
      ANONYMOUS,
    );
    await mergeContacts.call({ survivingId: ada.id, duplicateId: grace.id }, OWNER);
    const rows = await db()
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.newsletterId, newsletter.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contactId).toBe(ada.id);
  });
});
