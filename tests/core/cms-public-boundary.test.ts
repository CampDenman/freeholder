// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.01/C2.03/C2.10: the API cannot expose drafts or bypass editorial review.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { dispatch } from "@/core/api/dispatch";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { savePaywall } from "@/core/paywalls/service";
import { createPage, getPage, publishPage, resolvePageForRender, updatePage } from "@/modules/cms/service";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { renderBlocks } from "@/modules/cms/render";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const heading = (text: string) => ({ id: "title", type: "heading", props: { text, level: 1 } });

describe.runIf(hasDatabase)("CMS public and publishing boundary", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("never serializes working-copy content or editorial metadata to anonymous HTTP readers", async () => {
    const page = await createPage.call({ slug: "blog/public-boundary", title: "Live title", blocks: [heading("Live heading")] }, OWNER);
    const live = await publishPage.call({ id: page.id, published: true }, OWNER);
    await updatePage.call({ id: page.id, expectedVersion: live.version, title: "PRIVATE DRAFT TITLE", blocks: [heading("PRIVATE DRAFT BODY")], seo: { description: "PRIVATE DRAFT SEO" } }, OWNER);
    const response = await dispatch(new Request("https://example.test/api/v1/cms.resolvePage?slug=blog/public-boundary"), "cms.resolvePage");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Live heading");
    expect(body).not.toContain("PRIVATE DRAFT");
    for (const field of ["workingTitle", "workingBlocks", "workingSeo", "approvalNote", "approvedBy", "editLeaseActor"]) expect(body).not.toContain(`\"${field}\"`);
    expect((await getPage.call({ id: page.id }, OWNER)).workingTitle).toBe("PRIVATE DRAFT TITLE");
  });

  it("does not expose nested paywall bodies through anonymous HTTP", async () => {
    const page = await createPage.call({ slug: "blog/supporters", title: "Supporters", blocks: [heading("Public headline"), { id: "gate", type: "paywall", props: { teaser: "Members only", ctaLabel: "Join", ctaHref: "/memberships" }, children: [{ id: "secret", type: "text", props: { body: "PRIVATE MEMBER BODY" } }] }] }, OWNER);
    await publishPage.call({ id: page.id, published: true }, OWNER);
    const response = await dispatch(new Request("https://example.test/api/v1/cms.resolvePage?slug=blog/supporters"), "cms.resolvePage");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Members only");
    expect(body).not.toContain("PRIVATE MEMBER BODY");
    const source = await resolvePageForRender.call({ slug: "blog/supporters" }, { kind: "system" });
    expect(JSON.stringify(source)).toContain("PRIVATE MEMBER BODY");
    expect(JSON.stringify(source)).not.toContain("workingBlocks");
    expect((await failure(resolvePageForRender.call({ slug: "blog/supporters" }, ANONYMOUS))).code).toBe("permission");
    const denied = await dispatch(new Request("https://example.test/api/v1/cms.resolvePageForRender?slug=blog/supporters"), "cms.resolvePageForRender");
    expect(denied.status).toBe(404);
    await savePaywall.call({ name: "Signed-in readers", appliesTo: { kind: "page", selector: "blog/supporters" }, mode: "registration" }, OWNER);
    await db().insert(users).values({ id: CUSTOMER.userId, email: "reader@example.test", role: "customer" });
    const person = await resolveContact.call({ email: "reader@example.test" }, OWNER);
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, person.contact.id));
    const render = async (actor: typeof CUSTOMER | typeof ANONYMOUS) => renderToStaticMarkup(createElement(Fragment, null, ...await renderBlocks(parseBlockTree(source!.blocks, "page"), { locale: "en", path: "/blog/supporters", business: { name: "Test studio", tagline: null }, actor, t: key => key })));
    expect(await render(ANONYMOUS)).not.toContain("PRIVATE MEMBER BODY");
    expect(await render(CUSTOMER)).toContain("PRIVATE MEMBER BODY");
  });

  it("accepts exactly one simultaneous edit of the same version", async () => {
    const page = await createPage.call({ slug: "conflict", title: "Initial", blocks: [heading("Initial")] }, OWNER);
    const outcomes = await Promise.allSettled([
      updatePage.call({ id: page.id, expectedVersion: page.version, title: "First edit" }, OWNER),
      updatePage.call({ id: page.id, expectedVersion: page.version, title: "Second edit" }, OWNER),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "conflict" });
    expect((await getPage.call({ id: page.id }, OWNER)).version).toBe(page.version + 1);
  });

  it("refuses to publish a draft changed after the editor saved its reviewed version", async () => {
    const page = await createPage.call({ slug: "reviewed", title: "Initial", blocks: [heading("Initial")] }, OWNER);
    const reviewed = await updatePage.call({ id: page.id, expectedVersion: page.version, blocks: [heading("Reviewed")] }, OWNER);
    const changed = await updatePage.call({ id: page.id, expectedVersion: reviewed.version, blocks: [heading("Other editor's unreviewed content")] }, OWNER);
    const refused = await failure(publishPage.call({ id: page.id, published: true, expectedVersion: reviewed.version }, OWNER));
    expect(refused.code).toBe("conflict");
    const after = await getPage.call({ id: page.id }, OWNER);
    expect(after.status).toBe("draft");
    expect(after.version).toBe(changed.version);
    const published = await publishPage.call({ id: page.id, published: true, expectedVersion: changed.version }, OWNER);
    expect(published.version).toBe(changed.version + 1);
  });
});
