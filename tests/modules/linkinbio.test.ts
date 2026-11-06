// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Link in bio (MASTER.md §32, §34, C9.39).
//
// The tests worth reading first:
//
//   - "only ever redirects to what the published page says": the click door
//     takes an id and a page from a stranger, and the destination still
//     comes from the stored link and nowhere else.
//   - "counts a click in analytics, under consent": the click lands as one
//     first-party event and the report reads it back through analytics, so
//     the two numbers cannot disagree.
//   - "an agent scoped to link-in-bio alone cannot edit the page": the
//     links are page content, so the page grant is required too.
//   - "does not publish somebody else's unfinished edit": a link edit goes
//     live only when it cannot drag anything else live with it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import type { Actor } from "@/core/service";
import { updateBusiness } from "@/core/settings/service";
import { siteOrigin } from "@/core/seo/origin";
import { toolsFor } from "@/mcp/tools";
import { analyticsEvents } from "@/modules/analytics/schema";
import { track } from "@/modules/analytics/service";
import { createPage, getPage, publishPage, updatePage } from "@/modules/cms/service";
import { linkInBioBlocks } from "@/modules/linkinbio/links";
import {
  addLink,
  follow,
  page,
  removeLink,
  reorderLinks,
  report,
  scheduleLink,
  setLinkHidden,
  setup,
  targets,
  updateLink,
  updateProfile,
} from "@/modules/linkinbio/service";
import {
  ANONYMOUS,
  CUSTOMER,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const BUSINESS = {
  name: "Harbour Lane Ceramics",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const agent = (scopes: string[]): Actor => ({ kind: "agent", keyName: "bio-helper", scopes });

describe.runIf(hasDatabase)("link in bio", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  }, 60_000);
  afterAll(closeDb);

  async function livePage() {
    const created = await setup.call({ slug: "links", publish: true }, OWNER);
    expect(created.publication.live).toBe(true);
    return created.view;
  }

  async function publishedOnSite(slug: string, title: string) {
    const created = await createPage.call(
      {
        slug,
        title,
        blocks: [{ id: "h", type: "heading", props: { text: title, level: 1 } }],
      },
      OWNER,
    );
    await publishPage.call({ id: created.id, published: true }, OWNER);
    return created.id;
  }

  it("creates one page at /links with the profile block, and returns it again on a second call", async () => {
    const first = await setup.call({}, OWNER);
    expect(first.view.page.slug).toBe("links");
    expect(first.view.page.status).toBe("draft");
    expect(first.publication).toEqual({ live: false, pending: "draftPage" });
    const again = await setup.call({ slug: "elsewhere" }, OWNER);
    expect(again.view.page.id).toBe(first.view.page.id);
    const stored = await getPage.call({ id: first.view.page.id }, OWNER);
    expect(linkInBioBlocks(stored.blocks as never)).toHaveLength(1);
  });

  it("publishes a page whose only heading is the profile's name", async () => {
    // The CMS refuses to publish a page without an H1. The profile block
    // declares its heading level, so the page passes that gate on its own.
    const view = await livePage();
    expect(view.page.status).toBe("published");
    expect((await page.call({}, OWNER))?.page.id).toBe(view.page.id);
  });

  it("adds links of every kind in order, live straight away on a live page", async () => {
    await livePage();
    await publishedOnSite("products/linen-tote", "Linen tote");
    await addLink.call({ label: "Our podcast", kind: "url", target: "https://example.test/podcast" }, OWNER);
    const added = await addLink.call(
      { label: "The linen tote", kind: "product", target: "linen-tote", position: 0 },
      OWNER,
    );
    expect(added.publication).toEqual({ live: true, pending: null });
    const [first, second] = added.view.links;
    expect(first).toMatchObject({ label: "The linen tote", kind: "product", target: "products/linen-tote", state: "live", destination: "/products/linen-tote" });
    expect(second).toMatchObject({ label: "Our podcast", external: true, state: "live" });
    expect(first!.clickUrl).toBe(`${siteOrigin().replace(/\/+$/, "")}/go/link/${first!.id}?from=%2Flinks`);
  });

  it("refuses a destination that does not fit its kind", async () => {
    await livePage();
    for (const [kind, target] of [
      ["url", "javascript:alert(1)"],
      ["url", "example.test/no-scheme"],
      ["page", "https://elsewhere.example/x"],
      ["page", "../admin"],
      ["product", "products/a/b"],
      ["booking", "not-a-uuid"],
    ] as const) {
      const refused = await failure(addLink.call({ label: "Bad", kind, target }, OWNER));
      expect(refused.code, `${kind} ${target}`).toBe("validation");
    }
    expect((await failure(addLink.call({ label: "  ", kind: "url", target: "https://example.test" }, OWNER))).code).toBe(
      "validation",
    );
  });

  it("hides a smart link whose page is unpublished, and says why", async () => {
    await livePage();
    const productId = await publishedOnSite("products/glaze-kit", "Glaze kit");
    const added = await addLink.call({ label: "Glaze kit", kind: "product", target: "glaze-kit" }, OWNER);
    const id = added.view.links[0]!.id;
    await publishPage.call({ id: productId, published: false }, OWNER);
    const view = await page.call({}, OWNER);
    expect(view?.links[0]).toMatchObject({ id, state: "unavailable" });
    expect((await failure(follow.call({ id, from: "/links" }, ANONYMOUS))).code).toBe("not_found");
  });

  it("schedules a link in the business's time zone and honours the window", async () => {
    await livePage();
    const added = await addLink.call({ label: "Spring sale", kind: "url", target: "https://example.test/sale" }, OWNER);
    const id = added.view.links[0]!.id;

    const future = await scheduleLink.call({ id, startsAt: "2099-03-01T09:00", endsAt: null }, OWNER);
    expect(future.view.links[0]).toMatchObject({ state: "scheduled", startsAt: "2099-03-01T09:00" });
    expect((await failure(follow.call({ id, from: "/links" }, ANONYMOUS))).code).toBe("not_found");

    const past = await scheduleLink.call({ id, startsAt: "2020-01-01", endsAt: "2020-01-31" }, OWNER);
    expect(past.view.links[0]!.state).toBe("expired");

    const open = await scheduleLink.call({ id, startsAt: "2020-01-01", endsAt: null }, OWNER);
    expect(open.view.links[0]!.state).toBe("live");

    const refused = await failure(scheduleLink.call({ id, startsAt: "2026-05-02", endsAt: "2026-05-01" }, OWNER));
    expect(refused.code).toBe("validation");
    expect((await failure(scheduleLink.call({ id, startsAt: "next tuesday", endsAt: null }, OWNER))).code).toBe(
      "validation",
    );
  });

  it("hides and shows a link without losing it", async () => {
    await livePage();
    const added = await addLink.call({ label: "Studio tour", kind: "url", target: "https://example.test/tour" }, OWNER);
    const id = added.view.links[0]!.id;
    const hidden = await setLinkHidden.call({ id, hidden: true }, OWNER);
    expect(hidden.view.links[0]!.state).toBe("hidden");
    expect((await failure(follow.call({ id, from: "/links" }, ANONYMOUS))).code).toBe("not_found");
    const shown = await setLinkHidden.call({ id, hidden: false }, OWNER);
    expect(shown.view.links[0]!.state).toBe("live");
  });

  it("reorders by naming ids, keeping the rest in place, and never loses a link", async () => {
    await livePage();
    for (const label of ["One", "Two", "Three"]) {
      await addLink.call({ label, kind: "url", target: `https://example.test/${label.toLowerCase()}` }, OWNER);
    }
    const before = (await page.call({}, OWNER))!.links.map((link) => link.id);
    const moved = await reorderLinks.call({ ids: [before[2]!] }, OWNER);
    expect(moved.view.links.map((link) => link.label)).toEqual(["Three", "One", "Two"]);
    expect((await failure(reorderLinks.call({ ids: ["nosuchlink"] }, OWNER))).code).toBe("not_found");
    expect((await failure(reorderLinks.call({ ids: [before[0]!, before[0]!] }, OWNER))).code).toBe("validation");
  });

  it("removes a link only with explicit confirmation", async () => {
    await livePage();
    const added = await addLink.call({ label: "Old link", kind: "url", target: "https://example.test/old" }, OWNER);
    const id = added.view.links[0]!.id;
    const refused = await failure(removeLink.call({ id, confirm: false as never }, OWNER));
    expect(refused.code).toBe("validation");
    const removed = await removeLink.call({ id, confirm: true }, OWNER);
    expect(removed.view.links).toEqual([]);
  });

  it("changes a link's kind and re-checks its destination", async () => {
    await livePage();
    await publishedOnSite("about", "About");
    const added = await addLink.call({ label: "About us", kind: "url", target: "https://example.test/about" }, OWNER);
    const id = added.view.links[0]!.id;
    expect((await failure(updateLink.call({ id, kind: "page" }, OWNER))).code).toBe("validation");
    const changed = await updateLink.call({ id, kind: "page", target: "/about/" }, OWNER);
    expect(changed.view.links[0]).toMatchObject({ kind: "page", target: "about", destination: "/about", state: "live" });
  });

  it("keeps the profile honest: social links must be real addresses", async () => {
    await livePage();
    const saved = await updateProfile.call(
      {
        name: "Harbour Lane",
        bio: "Hand-thrown stoneware from a small coastal studio.",
        style: "outline",
        socials: [
          { network: "instagram", url: "https://instagram.example/harbourlane" },
          { network: "email", url: "hello@example.test" },
        ],
      },
      OWNER,
    );
    expect(saved.view.profile).toMatchObject({ name: "Harbour Lane", style: "outline" });
    expect(saved.view.profile.socials).toHaveLength(2);
    const refused = await failure(
      updateProfile.call({ socials: [{ network: "x", url: "javascript:alert(1)" }] }, OWNER),
    );
    expect(refused.code).toBe("validation");
  });

  it("only ever redirects to what the published page says", async () => {
    await livePage();
    await publishedOnSite("services/workshops", "Workshops");
    const external = await addLink.call({ label: "Podcast", kind: "url", target: "https://example.test/pod" }, OWNER);
    const internal = await addLink.call({ label: "Workshops", kind: "page", target: "services/workshops" }, OWNER);
    const podcastId = external.view.links[0]!.id;
    const workshopsId = internal.view.links[1]!.id;

    expect((await follow.call({ id: podcastId, from: "/links" }, ANONYMOUS)).destination).toBe("https://example.test/pod");

    const landed = new URL((await follow.call({ id: workshopsId, from: "/links" }, ANONYMOUS)).destination);
    expect(landed.origin).toBe(new URL(siteOrigin()).origin);
    expect(landed.pathname).toBe("/services/workshops");
    expect(landed.searchParams.get("utm_medium")).toBe("link-in-bio");
    expect(landed.searchParams.get("utm_campaign")).toBe(`bio:${workshopsId}`);

    // A page that does not carry the link, an unknown id and a hostile `from`
    // all get the same answer.
    await publishedOnSite("about", "About");
    expect((await failure(follow.call({ id: podcastId, from: "/about" }, ANONYMOUS))).code).toBe("not_found");
    expect((await failure(follow.call({ id: "unknownid", from: "/links" }, ANONYMOUS))).code).toBe("not_found");
    expect((await failure(follow.call({ id: podcastId, from: "https://evil.example/links" }, ANONYMOUS))).code).toBe(
      "not_found",
    );
  });

  it("follows the published page, not the draft", async () => {
    const view = await livePage();
    const added = await addLink.call(
      { label: "Draft only", kind: "url", target: "https://example.test/draft", publish: false },
      OWNER,
    );
    expect(added.publication).toEqual({ live: false, pending: "notRequested" });
    expect((await failure(follow.call({ id: added.view.links[0]!.id, from: "/links" }, ANONYMOUS))).code).toBe(
      "not_found",
    );
    expect(added.view.page.id).toBe(view.page.id);
  });

  it("does not publish somebody else's unfinished edit", async () => {
    const view = await livePage();
    // Somebody is mid-way through an edit in the visual editor.
    const current = await getPage.call({ id: view.page.id }, OWNER);
    await updatePage.call(
      {
        id: view.page.id,
        blocks: [
          ...(current.blocks as never[]),
          { id: "draft-note", type: "text", props: { body: "Not ready yet" } },
        ],
      },
      OWNER,
    );
    const added = await addLink.call({ label: "New", kind: "url", target: "https://example.test/new" }, OWNER);
    expect(added.publication).toEqual({ live: false, pending: "unpublishedEdits" });
    const stored = await getPage.call({ id: view.page.id }, OWNER);
    expect(JSON.stringify(stored.blocks)).not.toContain("draft-note");
    expect(JSON.stringify(stored.workingBlocks)).toContain("draft-note");
  });

  it("counts a click in analytics, under consent, and reports it back", async () => {
    await livePage();
    await publishedOnSite("about", "About");
    const added = await addLink.call({ label: "About", kind: "page", target: "about" }, OWNER);
    const id = added.view.links[0]!.id;

    // No identifiers: the visitor declined analytics. They still travel.
    await follow.call({ id, from: "/links" }, ANONYMOUS);
    expect(await db().select().from(analyticsEvents).where(eq(analyticsEvents.name, "linkinbio.clicked"))).toHaveLength(0);

    await follow.call({ id, from: "/links", anonId: "visitor-1", sessionId: "session-1" }, ANONYMOUS);
    // A double tap within the minute is one click.
    await follow.call({ id, from: "/links", anonId: "visitor-1", sessionId: "session-1" }, ANONYMOUS);
    await follow.call({ id, from: "/links", anonId: "visitor-2", sessionId: "session-2" }, ANONYMOUS);
    // A crawler is recorded but not counted as a person.
    await follow.call({ id, from: "/links", anonId: "bot-1", sessionId: "bot-1", visitorKind: "bot" }, ANONYMOUS);

    const events = await db().select().from(analyticsEvents).where(eq(analyticsEvents.name, "linkinbio.clicked"));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ path: "/links", props: { linkId: id, kind: "page" } });

    // The visit the redirect produced, carrying the link's campaign.
    await track.call(
      {
        anonId: "visitor-1",
        sessionId: "session-1",
        name: "page.viewed",
        path: "/about",
        campaign: { source: "bio", medium: "link-in-bio", campaign: `bio:${id}`, term: null, content: null },
      },
      ANONYMOUS,
    );
    const numbers = await report.call({ days: 30 }, OWNER);
    expect(numbers?.totalClicks).toBe(2);
    expect(numbers?.links[0]).toMatchObject({ id, clicks: 2, visitors: 2, arrivals: 1 });
  });

  it("does not write an audit row per stranger's tap, but does for every owner edit", async () => {
    await livePage();
    const added = await addLink.call({ label: "Shop", kind: "url", target: "https://example.test/shop" }, OWNER);
    await follow.call({ id: added.view.links[0]!.id, from: "/links" }, ANONYMOUS);
    const rows = await db().select().from(auditLog).where(eq(auditLog.action, "linkinbio.follow"));
    expect(rows).toHaveLength(0);
    const edits = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "linkinbio.addLink"), eq(auditLog.actor, `user:${OWNER.userId}`)));
    expect(edits).toHaveLength(1);
    // The page write it composed is audited beside it.
    expect(await db().select().from(auditLog).where(eq(auditLog.action, "cms.updatePage"))).not.toHaveLength(0);
  });

  it("offers the site's own pages as smart-link targets", async () => {
    await livePage();
    await publishedOnSite("products/linen-tote", "Linen tote");
    await publishedOnSite("events/open-studio", "Open studio");
    await publishedOnSite("about", "About");
    const listed = await targets.call({}, OWNER);
    expect(listed).toEqual(
      expect.arrayContaining([
        { kind: "product", target: "products/linen-tote", title: "Linen tote" },
        { kind: "event", target: "events/open-studio", title: "Open studio" },
        { kind: "page", target: "about", title: "About" },
      ]),
    );
  });

  it("refuses customers, anonymous callers and unscoped agents", async () => {
    await livePage();
    for (const actor of [CUSTOMER, ANONYMOUS, agent(["share.*"])]) {
      expect((await failure(page.call({}, actor))).code).toBe("permission");
      expect(
        (await failure(addLink.call({ label: "x", kind: "url", target: "https://example.test" }, actor))).code,
      ).toBe("permission");
    }
  });

  it("an agent scoped to link-in-bio alone cannot edit the page", async () => {
    await livePage();
    const narrow = agent(["linkinbio.*"]);
    const refused = await failure(
      addLink.call({ label: "Agent link", kind: "url", target: "https://example.test/a" }, narrow),
    );
    expect(refused.code).toBe("permission");

    const scoped = agent(["linkinbio.*", "cms.*"]);
    const added = await addLink.call({ label: "Agent link", kind: "url", target: "https://example.test/a" }, scoped);
    expect(added.view.links).toHaveLength(1);
    const audit = await db().select().from(auditLog).where(eq(auditLog.action, "linkinbio.addLink"));
    expect(audit.at(-1)?.actor).toBe("agent:bio-helper");
  });

  it("exposes the same services as MCP tools to a scoped agent", () => {
    const names = toolsFor(agent(["linkinbio.*"])).map((tool) => tool.name);
    for (const name of [
      "linkinbio_page",
      "linkinbio_addLink",
      "linkinbio_updateLink",
      "linkinbio_reorderLinks",
      "linkinbio_setLinkHidden",
      "linkinbio_scheduleLink",
      "linkinbio_removeLink",
      "linkinbio_report",
    ]) {
      expect(names).toContain(name);
    }
    const remove = toolsFor(agent(["linkinbio.*"])).find((tool) => tool.name === "linkinbio_removeLink");
    expect(remove?.annotations.destructiveHint).toBe(true);
    expect(toolsFor(agent(["share.*"])).some((tool) => tool.name.startsWith("linkinbio_add"))).toBe(false);
  });
});
