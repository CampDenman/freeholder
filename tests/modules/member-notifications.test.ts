// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.13: members hear about follows, friends, mentions, tags, comments and
// reactions; never from someone they blocked or muted; reactions fold into
// one entry per post; member email defaults to a digest.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { listNotifications, notificationPreferenceStatus, updateNotificationPreference } from "@/core/notifications/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { befriendMember, followMember, setMemberRelation } from "@/modules/members/graph";
import { commentOnPost, createPost, reactToPost } from "@/modules/members/posts";
import { closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const titles = async (actor: typeof RAE) => (await listNotifications.call({}, actor)).map((n) => n.title).sort();

describe.runIf(hasDatabase)("member notifications (C12.13)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
      { id: KIM.userId, email: "kim@example.test", role: "customer" },
    ]);
    for (const [actor, handle, name] of [[RAE, "rae", "Rae"], [SAM, "sam", "Sam"], [KIM, "kim", "Kim"]] as const) {
      await joinSite.call({ handle, displayName: name, meetsMinimumAge: true, isAdult: true }, actor);
    }
    await updateMyMembership.call({ isPrivate: false }, RAE);
  });
  afterAll(closeDb);

  it("tells members about follows, friend requests, mentions, comments and reactions", async () => {
    await followMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "rae" }, KIM);
    const post = await createPost.call({ body: "Hello @sam", visibility: "public" }, RAE);
    await commentOnPost.call({ postId: post.id, body: "Hi!" }, SAM);
    await reactToPost.call({ postId: post.id, kind: "love" }, SAM);
    await reactToPost.call({ postId: post.id, kind: "like" }, KIM);
    expect(await titles(RAE)).toEqual([
      "Kim reacted to your post",
      "Kim sent you a friend request",
      "Sam commented on your post",
      "Sam followed you",
    ]);
    const reactions = (await listNotifications.call({}, RAE)).find((n) => n.topic === "members.reaction");
    expect(reactions?.occurrenceCount).toBe(2);
    expect(await titles(SAM)).toEqual(["Rae mentioned you"]);
    await befriendMember.call({ handle: "kim" }, RAE);
    expect(await titles(KIM)).toEqual(["Rae accepted your friend request"]);
  });

  it("stays silent across blocks and mutes, and honours per-topic choices", async () => {
    await setMemberRelation.call({ handle: "sam", kind: "mute", on: true }, RAE);
    await followMember.call({ handle: "rae" }, SAM);
    await setMemberRelation.call({ handle: "kim", kind: "block", on: true }, RAE);
    await createPost.call({ body: "Hey @rae", visibility: "public" }, KIM);
    await updateNotificationPreference.call({ topic: "members.friend", channel: "in_app", mode: "off" }, RAE);
    await setMemberRelation.call({ handle: "sam", kind: "mute", on: false }, RAE);
    await befriendMember.call({ handle: "rae" }, SAM);
    expect(await titles(RAE)).toEqual([]);
    const status = await notificationPreferenceStatus.call({}, RAE);
    expect(status.topics).toEqual(expect.arrayContaining(["members.follow", "members.reaction"]));
  });
});
