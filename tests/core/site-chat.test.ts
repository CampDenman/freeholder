// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Site live chat, assistant handoff, and click-to-chat boundaries (MASTER C7.15).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { SITE_CHAT_COOKIE } from "@/core/messaging/chat-cookie";
import {
  endSiteChat,
  escalateAssistantChat,
  getSiteChat,
  postSiteChat,
  sendAssistantChatMessage,
  startSiteChat,
} from "@/core/messaging/chat";
import { replyToConversation } from "@/core/messaging/inbox";
import { messages, siteChatSessions } from "@/core/messaging/schema";
import { recordMessage } from "@/core/messaging/service";
import { consentRecords } from "@/core/privacy/schema";
import { ready } from "@/core/runtime";
import { GET as getChatRoute, POST as postChatRoute } from "../../app/api/chat/route";
import {
  messengerDeepLink,
  whatsappDeepLink,
} from "@/modules/cms/blocks/surfaces";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const ASSISTANT = {
  kind: "agent" as const,
  keyName: "agent:site-assistant",
  scopes: ["messaging.*"],
};
const ANONYMOUS = { kind: "anonymous" as const };

describe("click-to-chat links", () => {
  it("builds only provider-owned HTTPS deep links", () => {
    expect(whatsappDeepLink("+1 (604) 555-0123", "Hello there")).toBe(
      "https://wa.me/16045550123?text=Hello%20there",
    );
    expect(messengerDeepLink("freeholder.business")).toBe(
      "https://m.me/freeholder.business",
    );
  });
});

describe.runIf(hasDatabase)("site live chat", { timeout: 90_000 }, () => {
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

  async function begin(email = "ada@example.test") {
    return startSiteChat.call(
      { name: "Ada", email, message: "Could somebody help?", locale: "en" },
      ANONYMOUS,
    );
  }

  it("stores a hashed bearer and writes both visitor messages to one canonical thread", async () => {
    const started = await begin();
    expect(started.ok).toBe(true);
    const [stored] = await db()
      .select()
      .from(siteChatSessions)
      .where(eq(siteChatSessions.conversationId, started.conversationId));
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toBe(started.token);

    const after = await postSiteChat.call(
      { token: started.token, message: "It is about my booking." },
      ANONYMOUS,
    );
    expect(after.messages.map((message) => message.body)).toEqual([
      "Could somebody help?",
      "It is about my booking.",
    ]);
    expect(new Set(after.messages.map((message) => message.channel))).toEqual(new Set(["chat"]));

    const rows = await db()
      .select()
      .from(messages)
      .where(eq(messages.chatSessionId, stored!.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((message) => message.conversationId))).toEqual(
      new Set([started.conversationId]),
    );
  });

  it("never exposes another channel from the shared Contact conversation", async () => {
    const started = await begin();
    const [session] = await db()
      .select()
      .from(siteChatSessions)
      .where(eq(siteChatSessions.conversationId, started.conversationId));
    const [first] = await db()
      .select({ contactId: messages.contactId })
      .from(messages)
      .where(eq(messages.chatSessionId, session!.id))
      .limit(1);
    await recordMessage.call(
      {
        conversationId: started.conversationId,
        contactId: first!.contactId,
        direction: "outbound",
        channel: "email",
        body: "Private email history",
      },
      OWNER,
    );

    const visible = await getSiteChat.call({ token: started.token }, ANONYMOUS);
    expect(visible.messages.map((message) => message.body)).toEqual(["Could somebody help?"]);
  });

  it("delivers owner replies to the browser and leaves the final transcript readable when closed", async () => {
    const started = await begin();
    await replyToConversation.call(
      { id: started.conversationId, body: "Yes—what do you need?", close: false },
      OWNER,
    );
    await replyToConversation.call(
      { id: started.conversationId, body: "We will take it from here.", close: true },
      OWNER,
    );

    const final = await getSiteChat.call({ token: started.token }, ANONYMOUS);
    expect(final.state).toBe("closed");
    expect(final.messages.map((message) => message.body)).toEqual([
      "Could somebody help?",
      "Yes—what do you need?",
      "We will take it from here.",
    ]);
    expect(
      await failure(postSiteChat.call({ token: started.token, message: "One more" }, ANONYMOUS)),
    ).toMatchObject({ code: "not_found" });
  });

  it("preserves assistant authorship, flags a human handoff, and resolves it on human reply", async () => {
    const started = await begin();
    expect(
      await failure(
        sendAssistantChatMessage.call(
          { conversationId: started.conversationId, message: "Pretending" },
          OWNER,
        ),
      ),
    ).toMatchObject({ code: "permission" });

    await sendAssistantChatMessage.call(
      { conversationId: started.conversationId, message: "I can check the basics." },
      ASSISTANT,
    );
    await escalateAssistantChat.call(
      {
        conversationId: started.conversationId,
        reason: "The visitor asked for a pricing exception.",
        message: "I am bringing a person into the conversation.",
      },
      ASSISTANT,
    );
    expect(await getSiteChat.call({ token: started.token }, ANONYMOUS)).toMatchObject({
      escalated: true,
      messages: [
        { channel: "chat" },
        { channel: "assistant" },
        { channel: "assistant" },
      ],
    });

    await replyToConversation.call(
      { id: started.conversationId, body: "I can help with that.", close: false },
      OWNER,
    );
    expect((await getSiteChat.call({ token: started.token }, ANONYMOUS)).escalated).toBe(false);
  });

  it("does not infer marketing consent from local chat or external deep links", async () => {
    const started = await begin("consent-boundary@example.test");
    expect(started.ok).toBe(true);
    expect(await db().select().from(consentRecords)).toHaveLength(0);
    whatsappDeepLink("+16045550123", "A question");
    messengerDeepLink("owner.handle");
    expect(await db().select().from(consentRecords)).toHaveLength(0);
  });

  it("ends only the bearer session and refuses unknown tokens", async () => {
    const started = await begin();
    expect(await endSiteChat.call({ token: started.token }, ANONYMOUS)).toEqual({ ok: true });
    expect((await getSiteChat.call({ token: started.token }, ANONYMOUS)).state).toBe("closed");
    expect(
      await failure(getSiteChat.call({ token: "x".repeat(43) }, ANONYMOUS)),
    ).toMatchObject({ code: "not_found" });
  });

  it("binds the browser transport to its HttpOnly cookie and refuses cross-site writes", async () => {
    const started = await begin("route@example.test");
    const cookie = `${SITE_CHAT_COOKIE}=${encodeURIComponent(started.token)}`;
    const read = await getChatRoute(
      new Request("https://instance.test/api/chat", { headers: { cookie } }),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");

    const crossed = await postChatRoute(
      new Request("https://instance.test/api/chat", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "https://attacker.test",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ message: "Forged" }),
      }),
    );
    expect(crossed.status).toBe(403);

    const posted = await postChatRoute(
      new Request("https://instance.test/api/chat", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "https://instance.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ token: "ignored-body-token", message: "Cookie-bound" }),
      }),
    );
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as { messages: Array<{ body: string }> };
    expect(body.messages.at(-1)?.body).toBe("Cookie-bound");
  });
});
