// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Newsletters: double-opt-in, RFC 8058, public archive, prefs (C9.04).

import { afterAll, afterEach, beforeEach, vi, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetMailForTests } from "@/adapters/mail";
import { resetEnvForTests } from "@/core/env";
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
import { canContact } from "@/core/privacy/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { waitForBlockedQuery } from "../helpers/database-lock";
import { GET as readConfirmation, POST as applyConfirmation } from "../../app/newsletters/confirm/route";
import { GET as readUnsubscribe, POST as applyUnsubscribe } from "../../app/unsubscribe/route";

describe.runIf(hasDatabase)("newsletters module", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    vi.stubEnv("MAIL_ADAPTER", "smtp");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", "2525");
    vi.stubEnv("MAIL_FROM", "sender@example.test");
    resetEnvForTests(); resetMailForTests();
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
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); resetMailForTests(); });
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

    // The confirmation is the consent evidence (§2096), not merely a status.
    // Nothing else on the platform records marketing-email consent, and
    // `contacts.canContact` treats absence of evidence as refusal — so without
    // this a campaign (C9.06) would lawfully refuse to mail every confirmed
    // subscriber the business has.
    expect(
      await canContact.call(
        { contactId: row!.contactId, purpose: "marketing", channel: "email" },
        OWNER,
      ),
    ).toMatchObject({ allowed: true, reason: "granted" });

    const left = await unsubscribeFromNewsletter.call({ token: row!.unsubscribeToken }, ANONYMOUS);
    expect(left.status).toBe("unsubscribed");
    // And leaving withdraws it, so a segment cannot mail them anyway.
    expect(
      await canContact.call(
        { contactId: row!.contactId, purpose: "marketing", channel: "email" },
        OWNER,
      ),
    ).toMatchObject({ allowed: false, reason: "withdrawn" });
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

  it("requires a POST for mail links and keeps repeated one-click withdrawals safe", async () => {
    const newsletter = await createNewsletter.call({ name: "Scanner proof", slug: "scanner-proof" }, OWNER);
    const pending = await subscribeToNewsletter.call({ newsletterId: newsletter.id, email: "reader@example.test" }, ANONYMOUS);
    const [row] = await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, pending.subscriptionId));
    const confirm = `https://example.test/newsletters/confirm?token=${row!.confirmToken}`;
    const unsubscribe = `https://example.test/unsubscribe?token=${row!.unsubscribeToken}`;
    const page = await readConfirmation(new Request(confirm, { headers: { cookie: "freeholder_theme=dark", "x-freeholder-locale": "fr" } }));
    const html = await page.text();
    expect(html).toContain('method="post"'); expect(html).toContain('data-theme="dark"'); expect(html).toContain('lang="fr"');
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, row!.id)))[0]?.status).toBe("pending");
    expect((await applyConfirmation(new Request(confirm, { method: "POST" }))).status).toBe(200);
    expect((await readUnsubscribe(new Request(unsubscribe))).status).toBe(200);
    expect((await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, row!.id)))[0]?.status).toBe("confirmed");
    for (let repeat = 0; repeat < 2; repeat++) expect((await applyUnsubscribe(new Request(unsubscribe, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    }))).status).toBe(200);
    expect((await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, row!.id)))[0]?.status).toBe("unsubscribed");
  });

  it("does not restore consent when a stale confirmation races an unsubscribe", async () => {
    const newsletter = await createNewsletter.call({ name: "Withdrawal wins", slug: "withdrawal-wins" }, OWNER);
    const pending = await subscribeToNewsletter.call({ newsletterId: newsletter.id, email: "reader@example.test" }, ANONYMOUS);
    const [row] = await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, pending.subscriptionId));
    let release!: () => void;
    let withdrawn!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { withdrawn = resolve; });
    const withdrawing = db().transaction(async tx => {
      await unsubscribeFromNewsletter.call({ token: row!.unsubscribeToken }, ANONYMOUS, { tx });
      withdrawn(); await held;
    });
    await entered;
    const confirming = confirmSubscription.call({ token: row!.confirmToken }, ANONYMOUS).then(() => "unexpected success", (error: unknown) => (error as { code?: string }).code);
    try { await waitForBlockedQuery("newsletter_subscriptions"); } finally { release(); }
    await withdrawing;
    expect(await confirming).toBe("conflict");
    expect((await db().select().from(newsletterSubscriptions).where(eq(newsletterSubscriptions.id, row!.id)))[0]?.status).toBe("unsubscribed");
    expect(await canContact.call({ contactId: row!.contactId, purpose: "marketing", channel: "email" }, OWNER)).toMatchObject({ allowed: false, reason: "withdrawn" });
  });
});
