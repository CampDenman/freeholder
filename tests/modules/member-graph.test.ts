// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.02/C12.03: profiles show each field to exactly who the member chose,
// follows respect private accounts, friendship is mutual, and a block cuts
// every tie and hides each side from the other.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { joinSite, setMemberStatus, updateMyMembership } from "@/modules/members/service";
import {
  answerFollowRequest,
  befriendMember,
  followMember,
  myConnections,
  setMemberRelation,
  unfollowMember,
  unfriendMember,
  viewProfile,
} from "@/modules/members/graph";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const joined = (handle: string) => ({ handle, displayName: handle.toUpperCase(), meetsMinimumAge: true as const, isAdult: true });
const handles = (list: { handle: string }[]) => list.map((p) => p.handle);

describe.runIf(hasDatabase)("member profiles and graph (C12.02–C12.03)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
      { id: KIM.userId, email: "kim@example.test", role: "customer" },
    ]);
    await joinSite.call(joined("rae"), RAE);
    await joinSite.call(joined("sam"), SAM);
    await joinSite.call(joined("kim"), KIM);
    await updateMyMembership.call({ bio: "Coastal photographer.", links: [{ label: "Site", url: "https://rae.example" }] }, RAE);
  });
  afterAll(closeDb);

  it("starts private: strangers see the name, never the bio, until a follow is approved", async () => {
    const stranger = await viewProfile.call({ handle: "rae" }, ANONYMOUS);
    expect(stranger).toMatchObject({ handle: "rae", displayName: "RAE", isPrivate: true, indexable: false, bio: null, links: null });
    expect(await followMember.call({ handle: "rae" }, SAM)).toEqual({ following: "requested" });
    expect((await viewProfile.call({ handle: "rae" }, SAM)).bio).toBeNull();
    expect(handles((await myConnections.call({}, RAE)).followRequests)).toEqual(["sam"]);
    await answerFollowRequest.call({ handle: "sam", approve: true }, RAE);
    const follower = await viewProfile.call({ handle: "rae" }, SAM);
    expect(follower.bio).toBe("Coastal photographer.");
    expect(follower.relation.following).toBe("active");
    expect((await viewProfile.call({ handle: "rae" }, RAE)).followers).toBe(1);
    await unfollowMember.call({ handle: "rae" }, SAM);
    expect((await viewProfile.call({ handle: "rae" }, SAM)).bio).toBeNull();
  });

  it("shows each field at the visibility the member chose", async () => {
    await updateMyMembership.call({ isPrivate: false, bioVisibility: "public", linksVisibility: "friends", indexable: true }, RAE);
    const anyone = await viewProfile.call({ handle: "rae" }, ANONYMOUS);
    expect(anyone).toMatchObject({ bio: "Coastal photographer.", links: null, indexable: true });
    await befriendMember.call({ handle: "rae" }, SAM);
    expect((await viewProfile.call({ handle: "rae" }, SAM)).links).toBeNull();
    expect(await befriendMember.call({ handle: "sam" }, RAE)).toEqual({ friend: "friends" });
    expect((await viewProfile.call({ handle: "rae" }, SAM)).links).toEqual([{ label: "Site", url: "https://rae.example" }]);
    await updateMyMembership.call({ bioVisibility: "only_me", linksVisibility: "subscribers" }, RAE);
    const friend = await viewProfile.call({ handle: "rae" }, SAM);
    expect([friend.bio, friend.links]).toEqual([null, null]);
    expect((await viewProfile.call({ handle: "rae" }, RAE)).bio).toBe("Coastal photographer.");
    await unfriendMember.call({ handle: "rae" }, SAM);
    expect((await viewProfile.call({ handle: "rae" }, SAM)).relation.friend).toBe("none");
  });

  it("approves waiting followers when an account goes public", async () => {
    await followMember.call({ handle: "rae" }, SAM);
    await updateMyMembership.call({ isPrivate: false }, RAE);
    expect(handles((await myConnections.call({}, RAE)).followers)).toEqual(["sam"]);
    expect(await followMember.call({ handle: "rae" }, KIM)).toEqual({ following: "active" });
  });

  it("blocks both ways and ends every tie", async () => {
    await updateMyMembership.call({ isPrivate: false, bioVisibility: "public" }, RAE);
    await followMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    await setMemberRelation.call({ handle: "sam", kind: "block", on: true }, RAE);
    expect((await failure(viewProfile.call({ handle: "rae" }, SAM))).code).toBe("not_found");
    expect((await failure(followMember.call({ handle: "rae" }, SAM))).code).toBe("not_found");
    expect((await failure(befriendMember.call({ handle: "rae" }, SAM))).code).toBe("not_found");
    const raes = await myConnections.call({}, RAE);
    expect([handles(raes.followers), handles(raes.friends), handles(raes.blocked)]).toEqual([[], [], ["sam"]]);
    const own = await viewProfile.call({ handle: "sam" }, RAE);
    expect(own.relation).toMatchObject({ blocked: true, youBlocked: true });
    await setMemberRelation.call({ handle: "sam", kind: "block", on: false }, RAE);
    expect((await viewProfile.call({ handle: "rae" }, SAM)).bio).toBe("Coastal photographer.");
  });

  it("keeps mutes and restrictions private and lets only active members reach out", async () => {
    await setMemberRelation.call({ handle: "sam", kind: "mute", on: true }, RAE);
    await setMemberRelation.call({ handle: "kim", kind: "restrict", on: true }, RAE);
    expect((await viewProfile.call({ handle: "rae" }, SAM)).relation.muted).toBe(false);
    expect((await viewProfile.call({ handle: "sam" }, RAE)).relation.muted).toBe(true);
    expect(handles((await myConnections.call({}, RAE)).restricted)).toEqual(["kim"]);
    expect((await failure(followMember.call({ handle: "rae" }, ANONYMOUS))).code).toBe("permission");
    await setMemberStatus.call({ userId: KIM.userId, status: "suspended", reason: "Spam" }, OWNER);
    expect((await failure(followMember.call({ handle: "rae" }, KIM))).code).toBe("permission");
    expect((await failure(viewProfile.call({ handle: "kim" }, RAE))).code).toBe("not_found");
    expect((await failure(followMember.call({ handle: "rae" }, RAE))).code).toBe("not_found");
  });
});
