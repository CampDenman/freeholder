// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Community rooms, posts, gated feed and moderation (MASTER.md §36, C3.13).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contactTimeline, createContact, mergeContacts } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import {
  createCommunityPost,
  createCommunityPostBySlug,
  createCommunityRoom,
  createCommunitySpace,
  getCommunityFeedBySlug,
  hideCommunityPost,
  joinCommunity,
  joinCommunityBySlug,
  listCommunityFeed,
  listCommunityJoinRequests,
  listCommunityMembers,
  listCommunityModeration,
  moderateCommunityPostBySlug,
  requestCommunityJoinBySlug,
} from "../../plugins/community/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("community rooms, posts and moderation (C3.13)", () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
  });
  afterAll(closeDb);

  it("refuses a public join to a gated space and a duplicate membership", async () => {
    const gated = await createCommunitySpace.call(
      { slug: "private", title: "Private circle", access: "gated" },
      OWNER,
    );
    const refused = await failure(
      joinCommunityBySlug.call(
        { slug: "private", email: "outsider@demo.freeholder.test", name: "Outsider" },
        { kind: "anonymous" },
      ),
    );
    expect(refused.code).toBe("permission");

    const person = await createContact.call(
      { name: "Ada", email: "ada@demo.freeholder.test" },
      OWNER,
    );
    await joinCommunity.call({ spaceId: gated.id, contactId: person.id }, OWNER);
    const duplicate = await failure(
      joinCommunity.call({ spaceId: gated.id, contactId: person.id }, OWNER),
    );
    expect(duplicate.code).toBe("conflict");
  });

  it("lets a visitor request a gated join that staff later accept", async () => {
    const gated = await createCommunitySpace.call(
      { slug: "atelier", title: "Atelier", access: "gated" },
      OWNER,
    );
    const request = await requestCommunityJoinBySlug.call(
      { slug: "atelier", email: "wait@demo.freeholder.test", name: "Waiter" },
      { kind: "anonymous" },
    );
    expect(request.spaceId).toBe(gated.id);
    const waiting = await listCommunityJoinRequests.call({ spaceId: gated.id }, OWNER);
    expect(waiting).toHaveLength(1);
    const accepted = await joinCommunity.call(
      { spaceId: gated.id, contactId: request.contactId },
      OWNER,
    );
    expect(accepted.contactId).toBe(request.contactId);
    expect(await listCommunityJoinRequests.call({ spaceId: gated.id }, OWNER)).toHaveLength(0);
  });

  it("hides gated posts from outsiders and shows them to members", async () => {
    const gated = await createCommunitySpace.call(
      { slug: "members", title: "Members", access: "gated" },
      OWNER,
    );
    const room = await createCommunityRoom.call(
      { spaceId: gated.id, slug: "general", title: "General" },
      OWNER,
    );
    const person = await createContact.call(
      { name: "Bea", email: "bea@demo.freeholder.test" },
      OWNER,
    );
    await joinCommunity.call({ spaceId: gated.id, contactId: person.id }, OWNER);
    await createCommunityPost.call(
      { roomId: room.id, contactId: person.id, body: "Members only." },
      OWNER,
    );

    const outsider = await getCommunityFeedBySlug.call(
      { slug: "members" },
      { kind: "anonymous" },
    );
    expect(outsider.canRead).toBe(false);
    expect(outsider.posts).toHaveLength(0);
    expect(outsider.rooms).toHaveLength(0);

    const member = await getCommunityFeedBySlug.call(
      { slug: "members", email: "bea@demo.freeholder.test" },
      { kind: "anonymous" },
    );
    expect(member.canRead).toBe(true);
    expect(member.rooms.map((item) => item.slug)).toEqual(["general"]);
    expect(member.posts.map((post) => post.body)).toEqual(["Members only."]);
  });

  it("orders the feed newest first and records join and post on the timeline", async () => {
    const space = await createCommunitySpace.call(
      { slug: "harbour", title: "Harbour", access: "open" },
      OWNER,
    );
    await createCommunityRoom.call(
      { spaceId: space.id, slug: "lounge", title: "Lounge" },
      OWNER,
    );
    const joined = await joinCommunityBySlug.call(
      { slug: "harbour", email: "pat@demo.freeholder.test", name: "Pat" },
      { kind: "anonymous" },
    );
    const first = await createCommunityPostBySlug.call(
      {
        slug: "harbour",
        roomSlug: "lounge",
        email: "pat@demo.freeholder.test",
        name: "Pat",
        body: "First.",
      },
      { kind: "anonymous" },
    );
    const second = await createCommunityPostBySlug.call(
      {
        slug: "harbour",
        roomSlug: "lounge",
        email: "pat@demo.freeholder.test",
        name: "Pat",
        body: "Second.",
      },
      { kind: "anonymous" },
    );
    const third = await createCommunityPostBySlug.call(
      {
        slug: "harbour",
        roomSlug: "lounge",
        email: "pat@demo.freeholder.test",
        name: "Pat",
        body: "Third.",
      },
      { kind: "anonymous" },
    );
    const feed = await listCommunityFeed.call({ spaceId: space.id, limit: 2 }, OWNER);
    expect(feed.map((post) => post.body)).toEqual(["Third.", "Second."]);
    expect(feed.map((post) => post.id)).toEqual([third.id, second.id]);
    expect(feed.map((post) => post.id)).not.toContain(first.id);

    const older = await listCommunityFeed.call(
      { spaceId: space.id, limit: 2, before: second.id },
      OWNER,
    );
    expect(older.map((post) => post.body)).toEqual(["First."]);

    const publicFeed = await getCommunityFeedBySlug.call(
      { slug: "harbour", limit: 2 },
      { kind: "anonymous" },
    );
    expect(publicFeed.canRead).toBe(true);
    expect(publicFeed.posts.map((post) => post.body)).toEqual(["Third.", "Second."]);
    expect(publicFeed.posts.map((post) => post.id)).not.toContain(first.id);

    const timeline = await contactTimeline.call({ contactId: joined.contactId }, OWNER);
    expect(timeline.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["community.joined", "community.posted"]),
    );
  });

  it("lets a moderator hide a post so it leaves the public feed", async () => {
    const space = await createCommunitySpace.call(
      { slug: "circle", title: "Circle", access: "open" },
      OWNER,
    );
    const room = await createCommunityRoom.call(
      { spaceId: space.id, slug: "board", title: "Board" },
      OWNER,
    );
    const author = await joinCommunityBySlug.call(
      { slug: "circle", email: "author@demo.freeholder.test", name: "Author" },
      { kind: "anonymous" },
    );
    const moderator = await createContact.call(
      { name: "Mod", email: "mod@demo.freeholder.test" },
      OWNER,
    );
    await joinCommunity.call(
      { spaceId: space.id, contactId: moderator.id, role: "moderator" },
      OWNER,
    );
    const post = await createCommunityPost.call(
      { roomId: room.id, contactId: author.contactId, body: "Please hide me." },
      OWNER,
    );

    const memberHide = await failure(
      moderateCommunityPostBySlug.call(
        {
          slug: "circle",
          postId: post.id,
          email: "author@demo.freeholder.test",
          name: "Author",
          action: "hide",
        },
        { kind: "anonymous" },
      ),
    );
    expect(memberHide.code).toBe("permission");

    const hidden = await moderateCommunityPostBySlug.call(
      {
        slug: "circle",
        postId: post.id,
        email: "mod@demo.freeholder.test",
        name: "Mod",
        action: "hide",
      },
      { kind: "anonymous" },
    );
    expect(hidden.status).toBe("hidden");
    expect(
      (await getCommunityFeedBySlug.call({ slug: "circle" }, { kind: "anonymous" })).posts,
    ).toHaveLength(0);
    expect(await listCommunityModeration.call({ spaceId: space.id }, OWNER)).toHaveLength(1);

    const staffHidden = await hideCommunityPost.call({ postId: post.id }, OWNER);
    expect(staffHidden.status).toBe("hidden");
  });

  it("drops the duplicate membership and join request when both people share a space", async () => {
    const gated = await createCommunitySpace.call(
      { slug: "circle", title: "Circle", access: "gated" },
      OWNER,
    );
    const waiting = await createCommunitySpace.call(
      { slug: "waitlist", title: "Waitlist", access: "gated" },
      OWNER,
    );
    const keep = await createContact.call(
      { name: "Keep", email: "keep@demo.freeholder.test" },
      OWNER,
    );
    const drop = await createContact.call(
      { name: "Drop", email: "drop@demo.freeholder.test" },
      OWNER,
    );
    await joinCommunity.call({ spaceId: gated.id, contactId: keep.id, role: "moderator" }, OWNER);
    await joinCommunity.call({ spaceId: gated.id, contactId: drop.id }, OWNER);
    await requestCommunityJoinBySlug.call(
      { slug: "waitlist", email: "keep@demo.freeholder.test", name: "Keep" },
      { kind: "anonymous" },
    );
    await requestCommunityJoinBySlug.call(
      { slug: "waitlist", email: "drop@demo.freeholder.test", name: "Drop" },
      { kind: "anonymous" },
    );

    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);

    const members = await listCommunityMembers.call({ spaceId: gated.id }, OWNER);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ contactId: keep.id, role: "moderator" });
    const requests = await listCommunityJoinRequests.call({ spaceId: waiting.id }, OWNER);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.contactId).toBe(keep.id);
  });
});
