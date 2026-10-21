// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A signed-in customer writing in their own thread (C10.28, §4.14).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { conversations, messages } from "@/core/messaging/schema";
import { mailOutbox } from "@/core/mail/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getConversation, listConversations, recordMessage } from "@/core/messaging/service";
import { replyAsContact, replyToConversation } from "@/core/messaging/inbox";
import { myRecords } from "@/core/portal/service";
import { hashPassword } from "@/core/auth/passwords";
import { dispatch } from "@/core/api/dispatch";
import { signIn } from "../../packages/mobile-app/src/session";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("customer reply (C10.28)", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function threadFor(email: string, name: string) {
    return recordMessage.call(
      {
        email,
        name,
        direction: "inbound",
        channel: "email",
        body: "Are you free on the 14th?",
        subject: "Kitchen",
      },
      OWNER,
    );
  }

  async function signedIn(email: string, contactId: string) {
    const password = "customer-reply-test-password";
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email,
      role: "customer",
      passwordHash: await hashPassword(password),
    });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contactId));
    return CUSTOMER;
  }

  it("writes an inbound message into the caller's own thread and never sends on reply_channel", async () => {
    const { conversation } = await threadFor("rae@example.test", "Rae Lane");
    const actor = await signedIn("rae@example.test", conversation.contactId);
    const beforeChannel = conversation.replyChannel;
    const replied = await replyAsContact.call({ id: conversation.id, body: "Thursday still works." }, actor);
    const [row] = await db().select().from(messages).where(eq(messages.id, replied.id));
    expect(row).toMatchObject({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      direction: "inbound",
      channel: "chat",
      sentBy: "contact",
      body: "Thursday still works.",
    });
    const [after] = await db().select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(after!.replyChannel).toBe(beforeChannel);
    expect(after!.unread).toBe(true);
    expect(await db().select().from(mailOutbox)).toEqual([]);
  });

  it("refuses somebody else's thread and never offers the business reply", async () => {
    const mine = await threadFor("rae@example.test", "Rae Lane");
    const theirs = await threadFor("sam@example.test", "Sam");
    const actor = await signedIn("rae@example.test", mine.conversation.contactId);
    expect((await failure(replyAsContact.call({ id: theirs.conversation.id, body: "Hi" }, actor))).code).toBe("not_found");
    expect((await failure(replyToConversation.call({ id: mine.conversation.id, body: "As the studio" }, actor))).code).toBe("permission");
    const listed = await listConversations.call({ contactId: mine.conversation.contactId }, actor);
    expect(listed.map((thread) => thread.id)).toEqual([mine.conversation.id]);
    expect(await getConversation.call({ id: mine.conversation.id, contactId: mine.conversation.contactId }, actor)).toMatchObject({ id: mine.conversation.id });
    expect(await getConversation.call({ id: theirs.conversation.id, contactId: mine.conversation.contactId }, actor)).toBeNull();
    expect((await failure(getConversation.call({ id: mine.conversation.id }, actor))).code).toBe("permission");
  });

  it("links the portal room to the session-authenticated thread", async () => {
    const { conversation } = await threadFor("rae@example.test", "Rae Lane");
    const actor = await signedIn("rae@example.test", conversation.contactId);
    const rooms = await myRecords.call({ section: "messages" }, actor);
    expect(rooms[0]?.records[0]).toMatchObject({
      id: conversation.id,
      href: `/portal/messages/${conversation.id}`,
    });
  });

  it("signs in through the mobile transport and replies over HTTP", async () => {
    const { conversation } = await threadFor("rae@example.test", "Rae Lane");
    const password = "customer-reply-http-password";
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email: "rae@example.test",
      role: "customer",
      passwordHash: await hashPassword(password),
    });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, conversation.contactId));
    const result = await signIn(
      { instanceUrl: "https://example.test", email: "rae@example.test", password },
      async (url, init) => dispatch(new Request(url, init), new URL(url).pathname.split("/").at(-1)!),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a customer session");
    const call = async <T>(name: string, input: unknown): Promise<T> => {
      const response = await dispatch(
        new Request(`https://example.test/api/v1/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${result.session.token}` },
          body: JSON.stringify(input),
        }),
        name,
      );
      expect(response.status, name).toBe(200);
      return (await response.json()) as T;
    };
    const profile = await call<{ contactId: string }>("portal.myProfile", {});
    const replied = await call<{ id: string; conversationId: string }>("conversations.replyAsContact", {
      id: conversation.id,
      body: "See you then.",
    });
    expect(replied.conversationId).toBe(conversation.id);
    const thread = await call<{ messages: { body: string; direction: string }[] }>("conversations.get", {
      id: conversation.id,
      contactId: profile.contactId,
    });
    expect(thread.messages.at(-1)).toMatchObject({ body: "See you then.", direction: "inbound" });
  });

  it("rate-limits replies per contact", async () => {
    expect(replyAsContact.def.rateLimit?.limit).toBe(20);
    expect(replyAsContact.def.rateLimit?.windowSeconds).toBe(10 * 60);
    const { conversation } = await threadFor("rae@example.test", "Rae Lane");
    const actor = await signedIn("rae@example.test", conversation.contactId);
    for (let n = 0; n < 20; n += 1) {
      await replyAsContact.call({ id: conversation.id, body: `Ping ${n}` }, actor);
    }
    expect((await failure(replyAsContact.call({ id: conversation.id, body: "One more" }, actor))).code).toBe("rate_limited");
  });
});
