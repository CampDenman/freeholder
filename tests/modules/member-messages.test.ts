// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.06: messages reach the inbox only from people the recipient follows or
// befriended; everyone else is a request. Blocks close a conversation both
// ways. Read receipts are opt-in and reciprocal. Bodies are sealed at rest.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { listNotifications } from "@/core/notifications/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { befriendMember, followMember, setMemberRelation } from "@/modules/members/graph";
import {
  answerMessageRequest,
  listConversations,
  sendMessage,
  startConversation,
  unreadConversations,
  unsendMessage,
  viewConversation,
} from "@/modules/members/messages";
import { memberMessages } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const bodies = async (actor: typeof RAE, id: string) => (await viewConversation.call({ id }, actor)).messages.map((m) => m.body);

describe.runIf(hasDatabase)("member messages (C12.06)", () => {
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
  });
  afterAll(closeDb);

  it("delivers strangers' messages as requests and connections' messages to the inbox", async () => {
    const { id } = await startConversation.call({ handles: ["rae"], body: "Hi, love your photos" }, SAM);
    expect(await listConversations.call({ box: "inbox" }, RAE)).toEqual([]);
    expect((await listConversations.call({ box: "requests" }, RAE)).map((c) => c.id)).toEqual([id]);
    expect(await unreadConversations.call({}, RAE)).toEqual({ unread: 0, requests: 1 });
    expect((await failure(sendMessage.call({ conversationId: id, body: "reply" }, RAE))).code).toBe("permission");
    expect((await listNotifications.call({}, RAE)).filter((n) => n.topic === "members.message")).toEqual([]);
    await answerMessageRequest.call({ conversationId: id, accept: true }, RAE);
    await sendMessage.call({ conversationId: id, body: "Thank you!" }, RAE);
    expect(await bodies(SAM, id)).toEqual(["Hi, love your photos", "Thank you!"]);
    expect((await listNotifications.call({}, SAM)).map((n) => n.title)).toContain("Rae sent you a message");

    await updateMyMembership.call({ isPrivate: false }, KIM);
    await followMember.call({ handle: "kim" }, RAE);
    const direct = await startConversation.call({ handles: ["rae"], body: "Hey Rae" }, KIM);
    expect((await listConversations.call({ box: "inbox" }, RAE)).map((c) => c.id)).toContain(direct.id);
    const again = await startConversation.call({ handles: ["rae"], body: "Second" }, KIM);
    expect(again.id).toBe(direct.id);
  });

  it("closes a direct conversation across a block, and keeps outsiders out", async () => {
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const { id } = await startConversation.call({ handles: ["rae"], body: "Hello friend" }, SAM);
    expect((await listConversations.call({}, RAE)).map((c) => c.id)).toEqual([id]);
    expect((await failure(viewConversation.call({ id }, KIM))).code).toBe("not_found");
    expect((await failure(sendMessage.call({ conversationId: id, body: "intrude" }, KIM))).code).toBe("not_found");
    await setMemberRelation.call({ handle: "sam", kind: "block", on: true }, RAE);
    expect(await listConversations.call({}, RAE)).toEqual([]);
    expect((await failure(sendMessage.call({ conversationId: id, body: "still there?" }, SAM))).code).toBe("permission");
    expect((await failure(startConversation.call({ handles: ["rae"], body: "new" }, SAM))).code).toBe("not_found");
    expect((await viewConversation.call({ id }, SAM)).closed).toBe(true);
  });

  it("shows read receipts only between people who both share them", async () => {
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const { id } = await startConversation.call({ handles: ["rae"], body: "Seen?" }, SAM);
    await viewConversation.call({ id }, RAE);
    expect((await viewConversation.call({ id }, SAM)).seenBy).toEqual([]);
    await updateMyMembership.call({ readReceipts: true }, SAM);
    expect((await viewConversation.call({ id }, SAM)).seenBy).toEqual([]);
    await updateMyMembership.call({ readReceipts: true }, RAE);
    await viewConversation.call({ id }, RAE);
    expect((await viewConversation.call({ id }, SAM)).seenBy.map((p) => p.handle)).toEqual(["rae"]);
  });

  it("runs group conversations, seals bodies at rest, and unsends for everyone", async () => {
    await befriendMember.call({ handle: "rae" }, SAM);
    await befriendMember.call({ handle: "sam" }, RAE);
    const { id } = await startConversation.call({ handles: ["rae", "kim"], title: "Shoot planning", body: "Saturday at 7?" }, SAM);
    const raeView = await viewConversation.call({ id }, RAE);
    expect(raeView.conversation).toMatchObject({ kind: "group", title: "Shoot planning", state: "active" });
    expect((await listConversations.call({ box: "requests" }, KIM)).map((c) => c.id)).toEqual([id]);
    const [stored] = await db().select().from(memberMessages).where(eq(memberMessages.conversationId, id));
    expect(stored!.bodySealed).not.toContain("Saturday");
    await unsendMessage.call({ id: stored!.id }, SAM);
    expect(await bodies(RAE, id)).toEqual([null]);
    expect((await failure(unsendMessage.call({ id: stored!.id }, RAE))).code).toBe("not_found");
  });
});
