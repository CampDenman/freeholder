// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04: posts reach exactly who their visibility allows; the home feed is
// chronological and made of follows and friends; mutes, blocks and
// restrictions apply to feeds and comments; tags wait for consent.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { answerFollowRequest, befriendMember, followMember, setMemberRelation } from "@/modules/members/graph";
import {
  answerTag,
  commentOnPost,
  createPost,
  deletePost,
  editPost,
  hashtags,
  homeFeed,
  latestPublic,
  mentions,
  pendingTags,
  postsBy,
  reactToPost,
  viewPost,
} from "@/modules/members/posts";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const bodies = (page: { posts: { body: string }[] }) => page.posts.map((p) => p.body);

describe.runIf(hasDatabase)("member posts and feeds (C12.04)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
      { id: KIM.userId, email: "kim@example.test", role: "customer" },
    ]);
    for (const [actor, handle] of [[RAE, "rae"], [SAM, "sam"], [KIM, "kim"]] as const) {
      await joinSite.call({ handle, displayName: handle.toUpperCase(), meetsMinimumAge: true, isAdult: true }, actor);
    }
  });
  afterAll(closeDb);

  it("parses hashtags and mentions", () => {
    expect(hashtags("Sunrise at #Comox, #comox and #light_study. Not a#tag")).toEqual(["comox", "light_study"]);
    expect(mentions("Thanks @Sam and @kim! email@example.test")).toEqual(["sam", "kim"]);
  });

  it("shows each post only to its audience and keeps the home feed to follows and friends, newest first", async () => {
    await createPost.call({ body: "public one", visibility: "public" }, RAE);
    await createPost.call({ body: "for followers" }, RAE);
    await createPost.call({ body: "friends only", visibility: "friends" }, RAE);
    await createPost.call({ body: "note to self", visibility: "only_me" }, RAE);
    expect(bodies(await postsBy.call({ handle: "rae" }, ANONYMOUS))).toEqual(["public one"]);
    expect(bodies(await homeFeed.call({}, SAM))).toEqual([]);
    await followMember.call({ handle: "rae" }, SAM);
    await answerFollowRequest.call({ handle: "sam", approve: true }, RAE);
    expect(bodies(await homeFeed.call({}, SAM))).toEqual(["for followers", "public one"]);
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    expect(bodies(await homeFeed.call({}, SAM))).toEqual(["friends only", "for followers", "public one"]);
    expect(bodies(await homeFeed.call({}, RAE))).toEqual(["note to self", "friends only", "for followers", "public one"]);
    expect(bodies(await latestPublic.call({}, ANONYMOUS))).toEqual(["public one"]);
    await setMemberRelation.call({ handle: "rae", kind: "mute", on: true }, SAM);
    expect(bodies(await homeFeed.call({}, SAM))).toEqual([]);
    expect(bodies(await postsBy.call({ handle: "rae" }, SAM))).toHaveLength(3);
  });

  it("hides posts and comments across a block, and keeps restricted comments between the commenter and the author", async () => {
    await updateMyMembership.call({ isPrivate: false }, RAE);
    const post = await createPost.call({ body: "open thread #coast", visibility: "public" }, RAE);
    expect(bodies(await latestPublic.call({ tag: "coast" }, ANONYMOUS))).toEqual(["open thread #coast"]);
    await commentOnPost.call({ postId: post.id, body: "Lovely" }, SAM);
    await setMemberRelation.call({ handle: "kim", kind: "restrict", on: true }, RAE);
    await commentOnPost.call({ postId: post.id, body: "Hmm" }, KIM);
    const comments = async (actor: typeof RAE | typeof ANONYMOUS) => (await viewPost.call({ id: post.id }, actor)).comments.map((c) => c.body);
    expect(await comments(ANONYMOUS)).toEqual(["Lovely"]);
    expect(await comments(KIM)).toEqual(["Lovely", "Hmm"]);
    expect(await comments(RAE)).toEqual(["Lovely", "Hmm"]);
    await setMemberRelation.call({ handle: "sam", kind: "block", on: true }, RAE);
    expect((await failure(viewPost.call({ id: post.id }, SAM))).code).toBe("not_found");
    expect((await failure(commentOnPost.call({ postId: post.id, body: "again" }, SAM))).code).toBe("not_found");
    expect(bodies(await latestPublic.call({}, SAM))).toEqual([]);
  });

  it("reacts, reposts only public posts, edits, deletes and asks before tagging", async () => {
    const pub = await createPost.call({ body: "shareable", visibility: "public" }, RAE);
    const priv = await createPost.call({ body: "not shareable" }, RAE);
    await reactToPost.call({ postId: pub.id, kind: "love" }, SAM);
    await reactToPost.call({ postId: pub.id, kind: "like" }, KIM);
    const seen = (await viewPost.call({ id: pub.id }, SAM)).post;
    expect(seen.reactions).toEqual({ love: 1, like: 1 });
    expect(seen.myReaction).toBe("love");
    const repost = await createPost.call({ repostOf: pub.id }, SAM);
    expect(repost.repost?.body).toBe("shareable");
    expect(repost.visibility).toBe("public");
    expect((await failure(createPost.call({ repostOf: priv.id }, SAM))).code).toBe("not_found");
    const tagged = await createPost.call({ body: "With @kim at the beach", visibility: "public", tag: ["kim"] }, RAE);
    expect(tagged.tagged).toEqual([]);
    const waiting = await pendingTags.call({}, KIM);
    expect(waiting.map((w) => w.post.id)).toEqual([tagged.id]);
    await answerTag.call({ mentionId: waiting[0]!.mentionId, approve: true }, KIM);
    expect((await viewPost.call({ id: tagged.id }, ANONYMOUS)).post.tagged.map((p) => p.handle)).toEqual(["kim"]);
    const edited = await editPost.call({ id: pub.id, body: "shareable, edited" }, RAE);
    expect(edited.editedAt).toBeTruthy();
    expect((await failure(editPost.call({ id: pub.id, body: "not mine" }, SAM))).code).toBe("not_found");
    await deletePost.call({ id: pub.id }, RAE);
    expect((await failure(viewPost.call({ id: pub.id }, ANONYMOUS))).code).toBe("not_found");
    expect((await viewPost.call({ id: repost.id }, ANONYMOUS)).post.repost).toBeNull();
    expect((await failure(createPost.call({ body: "anon" }, ANONYMOUS))).code).toBe("permission");
  });
});
