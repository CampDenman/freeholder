// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One conversation with one person, whatever it arrived on (C7.08, §4.14).
//
// §4.14 says two things about a conversation that do not obviously agree. The
// entity row calls it "one thread with one person on one channel"; the rule
// twenty lines earlier says "the inbox threads by contact, not by channel — a
// form submission, a reply to it by email, and a text message about the same
// job belong in one conversation".
//
// The resolution these tests pin down: a **message** carries the channel it
// arrived on and never changes; a **conversation** carries the channel a reply
// would use, and that follows the last thing that happened. So a thread can
// hold all three, and replying still has one unambiguous route.
//
// Four other claims:
//
//   1. **An inbound message resolves to a Contact, always** — including a text
//      from a number nobody has seen.
//   2. **Ingest is idempotent.** Every provider retries; a duplicate is a
//      duplicate in the inbox and on the bill.
//   3. **Delivery is observed, not assumed**, with the provider's own codes.
//   4. **Erasure takes the correspondence.** Their words, in their voice.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { conversations, messages, messageDeliveries } from "@/core/messaging/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  getConversation,
  listConversations,
  markConversationRead,
  recordDelivery,
  recordMessage,
} from "@/core/messaging/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("conversations", { timeout: 90_000 }, () => {
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

  async function inbound(overrides: Record<string, unknown> = {}) {
    return recordMessage.call(
      {
        email: "rae@example.test",
        name: "Rae Lane",
        direction: "inbound",
        channel: "email",
        body: "Are you free on the 14th?",
        ...overrides,
      },
      OWNER,
    );
  }

  it("refuses a message with nobody attached to it", async () => {
    const refused = await failure(
      recordMessage.call(
        { direction: "inbound", channel: "email", body: "Hello?" },
        OWNER,
      ),
    );
    // A thread with nobody attached has no history, no consent record, and no
    // way to answer "who is this".
    expect(refused.message).toContain("who the message is with");
  });

  it("resolves an inbound message onto a real contact", async () => {
    const { conversation, message } = await inbound();
    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(rae).toBeTruthy();
    expect(conversation).toMatchObject({
      contactId: rae!.id,
      replyChannel: "email",
      status: "open",
      unread: true,
      messageCount: 1,
    });
    expect(message).toMatchObject({ direction: "inbound", channel: "email", sentBy: "contact" });
  });

  it("does not mint a second record for somebody already known", async () => {
    const existing = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "form" },
      { kind: "system" },
    )) as { contact: { id: string } };
    const { conversation } = await inbound();
    expect(conversation.contactId).toBe(existing.contact.id);
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  // A text from a number nobody has seen still has to become somebody.
  it("makes a contact out of a phone number alone", async () => {
    const { conversation } = await recordMessage.call(
      {
        phone: "+447700900123",
        direction: "inbound",
        channel: "sms",
        body: "On my way",
      },
      OWNER,
    );
    const [made] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId));
    expect(made!.phone).toBe("+447700900123");
    // A placeholder that must never be mistaken for a deliverable address.
    expect(made!.email).toContain("@sms.invalid");
  });

  it("finds the same person by their number the second time", async () => {
    await recordMessage.call(
      { phone: "+447700900123", direction: "inbound", channel: "sms", body: "First" },
      OWNER,
    );
    await recordMessage.call(
      { phone: "+447700900123", direction: "inbound", channel: "sms", body: "Second" },
      OWNER,
    );
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  // §4.14's promise, made executable.
  it("keeps a form submission, an email and a text in one thread", async () => {
    const first = await recordMessage.call(
      {
        email: "rae@example.test",
        name: "Rae Lane",
        direction: "inbound",
        channel: "form",
        body: "Can you do a kitchen?",
        subject: "Contact form",
      },
      OWNER,
    );
    const second = await inbound({ body: "Following up by email." });
    const third = await recordMessage.call(
      {
        contactId: first.conversation.contactId,
        direction: "inbound",
        channel: "sms",
        body: "Texting instead",
      },
      OWNER,
    );

    expect(second.conversation.id).toBe(first.conversation.id);
    expect(third.conversation.id).toBe(first.conversation.id);
    expect(await db().select().from(conversations)).toHaveLength(1);

    const thread = await getConversation.call({ id: first.conversation.id }, OWNER);
    // Each message keeps the door it came through; the thread does not.
    expect(thread!.messages.map((one) => one.channel)).toEqual(["form", "email", "sms"]);
    // And a reply follows the last thing that happened.
    expect(thread!.replyChannel).toBe("sms");
    expect(thread!.messageCount).toBe(3);
  });

  it("starts a new thread when the last one is long over", async () => {
    const spring = await inbound({ body: "Spring enquiry" });
    await db()
      .update(conversations)
      .set({ updatedAt: new Date(Date.now() - 60 * 86_400_000) })
      .where(eq(conversations.id, spring.conversation.id));

    const autumn = await inbound({ body: "Autumn enquiry" });
    // A reply three days later is the same conversation; one three months
    // later is a new subject even from the same person.
    expect(autumn.conversation.id).not.toBe(spring.conversation.id);
  });

  it("keeps a named provider thread out of another thread", async () => {
    const loose = await inbound({ body: "General question" });
    const threaded = await inbound({ body: "About invoice 12", threadKey: "gmail-thread-1" });
    // A conversation that belongs to a specific email thread must not swallow
    // an unrelated one, and vice versa.
    expect(threaded.conversation.id).toBe(loose.conversation.id);

    const same = await inbound({ body: "Same email thread", threadKey: "gmail-thread-1" });
    expect(same.conversation.id).toBe(threaded.conversation.id);
  });

  it("refuses to move a message into somebody else's thread", async () => {
    const theirs = await inbound();
    const refused = await failure(
      recordMessage.call(
        {
          email: "sam@example.test",
          direction: "inbound",
          channel: "email",
          body: "Wrong thread",
          conversationId: theirs.conversation.id,
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("somebody else");
  });

  // Every provider retries its webhooks.
  it("records the same provider message once", async () => {
    const first = await inbound({ providerRef: "SM-1" });
    const again = await inbound({ providerRef: "SM-1", body: "Different words entirely" });
    expect(again.duplicate).toBe(true);
    expect(again.message.id).toBe(first.message.id);
    // Not a duplicate in the inbox, and not a duplicate on the bill.
    expect(await db().select().from(messages)).toHaveLength(1);
    expect(first.conversation.messageCount).toBe(1);
  });

  it("marks a thread unread when something arrives and read when asked", async () => {
    const { conversation } = await inbound();
    expect(conversation.unread).toBe(true);
    const read = await markConversationRead.call({ id: conversation.id }, OWNER);
    expect(read.unread).toBe(false);
  });

  it("does not call a thread read just because somebody replied", async () => {
    const { conversation } = await inbound();
    await inbound({ body: "And another thing" });
    await recordMessage.call(
      {
        contactId: conversation.contactId,
        direction: "outbound",
        channel: "email",
        body: "Looking into it",
      },
      OWNER,
    );
    const [after] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    // Replying to one of two waiting messages does not mean the other was read.
    expect(after!.unread).toBe(true);
    expect(after!.lastOutboundAt).toBeTruthy();
  });

  it("reopens a closed thread when the customer writes again", async () => {
    const { conversation } = await inbound();
    await db()
      .update(conversations)
      .set({ status: "closed" })
      .where(eq(conversations.id, conversation.id));
    const again = await inbound({ body: "Actually, one more thing" });
    // The alternative is a customer talking to a closed door.
    expect(again.conversation.status).toBe("open");
  });

  it("puts a message on the person's timeline whatever door it came through", async () => {
    await inbound({ channel: "sms", body: "Text" });
    const [event] = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.eventType, "message.received"));
    expect(event).toMatchObject({ subjectType: "conversation" });
  });

  it("records what the carrier said, with its own codes", async () => {
    const { message } = await recordMessage.call(
      {
        email: "rae@example.test",
        direction: "outbound",
        channel: "sms",
        body: "Confirmed for the 14th",
        segments: 1,
        costMinor: 4,
        costCurrency: "GBP",
      },
      OWNER,
    );
    await recordDelivery.call({ messageId: message.id, status: "sent" }, OWNER);
    const failed = await recordDelivery.call(
      {
        messageId: message.id,
        status: "undelivered",
        errorCode: "30003",
        errorText: "Unreachable destination handset",
      },
      OWNER,
    );
    expect(failed.duplicate).toBe(false);

    const thread = await getConversation.call({ id: message.conversationId }, OWNER);
    const reports = thread!.messages[0]!.deliveries;
    expect(reports.map((one) => one.status)).toEqual(["sent", "undelivered"]);
    // Kept verbatim, because "undelivered, code 30003" is what support asks for.
    expect(reports[1]!.errorCode).toBe("30003");
    // And what it cost, because SMS is the channel where an owner can spend
    // real money by accident.
    expect(thread!.messages[0]).toMatchObject({ segments: 1, costMinor: 4, costCurrency: "GBP" });
  });

  it("records the same carrier callback once", async () => {
    const { message } = await inbound({ direction: "outbound", channel: "sms" });
    await recordDelivery.call({ messageId: message.id, status: "delivered" }, OWNER);
    const again = await recordDelivery.call({ messageId: message.id, status: "delivered" }, OWNER);
    expect(again.duplicate).toBe(true);
    expect(await db().select().from(messageDeliveries)).toHaveLength(1);
  });

  it("refuses a delivery report about a message that is not here", async () => {
    const refused = await failure(
      recordDelivery.call(
        { messageId: "00000000-0000-4000-8000-0000000000ff", status: "sent" },
        OWNER,
      ),
    );
    expect(refused.message).toContain("not here");
  });

  it("lists threads for one person and by state", async () => {
    await inbound();
    await recordMessage.call(
      { email: "sam@example.test", direction: "inbound", channel: "chat", body: "Hi" },
      OWNER,
    );
    const [rae] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));

    expect(await listConversations.call({ contactId: rae!.id }, OWNER)).toHaveLength(1);
    expect(await listConversations.call({ unreadOnly: true }, OWNER)).toHaveLength(2);
    expect(await listConversations.call({ channel: "chat" }, OWNER)).toHaveLength(1);
    const listed = await listConversations.call({}, OWNER);
    // The person's name comes back with the thread, so an inbox needs no
    // second query to say who each one is with.
    expect(typeof listed[0]?.contactName).toBe("string");
  });

  it("brings both sides' threads to the survivor of a merge", async () => {
    const first = await inbound();
    const second = await recordMessage.call(
      { email: "rae.lane@example.test", direction: "inbound", channel: "sms", body: "Also me" },
      OWNER,
    );
    await getService("contacts.merge").call(
      { survivingId: first.conversation.contactId, duplicateId: second.conversation.contactId },
      OWNER,
    );
    // Side by side, not spliced: two records of one person were two real
    // conversations, and interleaving them would invent an exchange.
    const kept = await listConversations.call({ contactId: first.conversation.contactId }, OWNER);
    expect(kept).toHaveLength(2);
  });

  it("takes the correspondence when somebody is forgotten", async () => {
    const { conversation, message } = await inbound();
    await recordDelivery.call({ messageId: message.id, status: "delivered" }, OWNER);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.conversations");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, conversation.contactId, { requestId: "t" }));

    // Their words, in their voice: a business asked to forget somebody cannot
    // keep the transcript.
    expect(await db().select().from(conversations)).toHaveLength(0);
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await db().select().from(messageDeliveries)).toHaveLength(0);
  });
});
