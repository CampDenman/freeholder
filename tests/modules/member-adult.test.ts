// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.29: adult content exists only where the site allows it, only adults may
// post or see it, seeing it is opt-in, and minors and visitors never receive
// it from any service.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { listNotifications } from "@/core/notifications/service";
import { joinSite, myMembership, updateMembershipRules, updateMyMembership } from "@/modules/members/service";
import { createPost, latestPublic, postsBy, viewPost } from "@/modules/members/posts";
import { followMember } from "@/modules/members/graph";
import { createListing } from "@/modules/members/listings";
import { marketListings } from "@/modules/catalog/market";
import { resolveVisibleProduct } from "@/modules/catalog/service";
import { updateBusiness } from "@/core/settings/service";
import type { Actor } from "@/core/service";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ADA = CUSTOMER; // adult author
const BEN = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" }; // adult who opts in
const CAL = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" }; // adult who has not opted in
const DEE = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c4" }; // minor

const latestBodies = async (actor: Actor) => (await latestPublic.call({}, actor)).posts.map((p) => p.body);

describe.runIf(hasDatabase)("adult content (C12.29)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: ADA.userId, email: "ada@example.test", role: "customer" },
      { id: BEN.userId, email: "ben@example.test", role: "customer" },
      { id: CAL.userId, email: "cal@example.test", role: "customer" },
      { id: DEE.userId, email: "dee@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Adult proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    for (const [actor, handle, isAdult] of [[ADA, "ada", true], [BEN, "ben", true], [CAL, "cal", true], [DEE, "dee", false]] as const) {
      await joinSite.call({ handle, displayName: handle, meetsMinimumAge: true, isAdult }, actor);
    }
  });
  afterAll(closeDb);

  it("is off until the site allows it, and only adults may post or opt in", async () => {
    expect((await failure(createPost.call({ body: "After dark", visibility: "public", adult: true }, ADA))).code).toBe("validation");
    expect((await failure(updateMyMembership.call({ showAdult: true }, BEN))).code).toBe("validation");
    await updateMembershipRules.call({ adultContent: true }, OWNER);
    expect((await failure(createPost.call({ body: "After dark", visibility: "public", adult: true }, DEE))).code).toBe("permission");
    expect((await failure(updateMyMembership.call({ showAdult: true }, DEE))).code).toBe("permission");
    await updateMyMembership.call({ showAdult: true }, BEN);
    await updateMyMembership.call({ isAdult: false }, BEN);
    expect((await myMembership.call({}, BEN))).toMatchObject({ isAdult: false, showAdult: false });
  });

  it("reaches only opted-in adults and the author, from every post service", async () => {
    await updateMembershipRules.call({ adultContent: true }, OWNER);
    await updateMyMembership.call({ showAdult: true }, BEN);
    const adult = await createPost.call({ body: "After dark set", visibility: "public", adult: true }, ADA);
    await createPost.call({ body: "Morning set", visibility: "public" }, ADA);
    expect(adult.adult).toBe(true);

    expect(await latestBodies(BEN)).toEqual(["Morning set", "After dark set"]);
    expect(await latestBodies(ADA)).toEqual(["Morning set", "After dark set"]);
    for (const viewer of [CAL, DEE, ANONYMOUS]) {
      expect(await latestBodies(viewer)).toEqual(["Morning set"]);
      expect((await postsBy.call({ handle: "ada" }, viewer)).posts.map((p) => p.body)).toEqual(["Morning set"]);
      expect((await failure(viewPost.call({ id: adult.id }, viewer))).code).toBe("not_found");
    }
    expect((await viewPost.call({ id: adult.id }, BEN)).post.body).toBe("After dark set");

    const shared = await createPost.call({ repostOf: adult.id }, BEN);
    expect(shared.adult).toBe(true);
    await followMember.call({ handle: "ben" }, CAL);
    expect((await postsBy.call({ handle: "ben" }, CAL)).posts).toEqual([]);

    // Turning the site switch off hides everything already marked adult.
    await updateMembershipRules.call({ adultContent: false }, OWNER);
    expect(await latestBodies(BEN)).not.toContain("After dark set");
    expect((await latestPublic.call({}, BEN)).posts.find((p) => p.id === shared.id)?.repost).toBeNull();
  });

  it("never points a minor at adult content through a mention", async () => {
    await updateMembershipRules.call({ adultContent: true }, OWNER);
    await createPost.call({ body: "Hey @dee and @ben", visibility: "public", adult: true }, ADA);
    await updateMyMembership.call({ showAdult: true }, BEN);
    await createPost.call({ body: "Again @dee and @ben", visibility: "public", adult: true }, ADA);
    const mentions = async (actor: Actor) => (await listNotifications.call({}, actor)).filter((n) => n.topic === "members.mention").length;
    expect(await mentions(DEE)).toBe(0);
    expect(await mentions(BEN)).toBe(1);
  });

  it("keeps adult listings out of the market and product pages for anyone not opted in", async () => {
    await updateMembershipRules.call({ adultContent: true, marketplaceEnabled: true, listingReview: false }, OWNER);
    await updateMyMembership.call({ showAdult: true }, BEN);
    expect((await failure(createListing.call({ title: "Boudoir session", kind: "service", price: "200", adult: true }, DEE))).code).toBe("permission");
    const listing = await createListing.call({ title: "Boudoir session", kind: "service", price: "200", adult: true }, ADA);
    await createListing.call({ title: "Portrait session", kind: "service", price: "150" }, ADA);
    const names = async (actor: Actor) => (await marketListings.call({}, actor)).map((l) => l.name).sort();
    expect(await names(BEN)).toEqual(["Boudoir session", "Portrait session"]);
    expect(await names(ADA)).toEqual(["Boudoir session", "Portrait session"]);
    for (const viewer of [CAL, DEE, ANONYMOUS]) {
      expect(await names(viewer)).toEqual(["Portrait session"]);
      expect(await resolveVisibleProduct.call({ slug: listing.slug }, viewer)).toBeNull();
    }
    expect((await resolveVisibleProduct.call({ slug: listing.slug }, BEN))?.name).toBe("Boudoir session");
  });
});
