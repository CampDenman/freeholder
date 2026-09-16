// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The inbox, without reimplementing a mail client (C7.09, MASTER.md §4.14).
//
// That clause is the design brief. A mail client holds everything you have ever
// received; a business inbox makes sure nothing waiting on a person is
// forgotten. So there are four verbs, and each has one way to get it wrong:
//
//   * **assign** — a thread nobody owns is one everybody assumes somebody else
//     has.
//   * **snooze** — a snoozed thread that never comes back is a closed thread
//     with extra steps.
//   * **close** — a closed thread a customer replies to must not stay closed.
//     (Covered by C7.08's suite, which owns that rule.)
//   * **reply** — a reply recorded but never sent puts words in the thread the
//     customer never saw.
//
// Plus the two things that make it usable at all: search over what was actually
// said, and doing one thing to several threads at once.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { conversations } from "@/core/messaging/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  assignConversation,
  bulkConversations,
  inboxCounts,
  replyToConversation,
  searchInbox,
  setConversationStatus,
  snoozeConversation,
  wakeSnoozedConversations,
} from "@/core/messaging/inbox";
import { recordMessage } from "@/core/messaging/service";
import { closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("inbox", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: STAFF.userId, email: "staff@example.test", role: "staff" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function thread(overrides: Record<string, unknown> = {}) {
    const { conversation } = await recordMessage.call(
      {
        email: "rae@example.test",
        name: "Rae Lane",
        direction: "inbound",
        channel: "email",
        body: "Can you quote for a kitchen?",
        subject: "Kitchen",
        ...overrides,
      },
      OWNER,
    );
    return conversation;
  }

  it("hands a thread to somebody, and back to nobody", async () => {
    const one = await thread();
    const assigned = await assignConversation.call({ id: one.id, userId: STAFF.userId }, OWNER);
    expect(assigned.assigneeUserId).toBe(STAFF.userId);
    const unassigned = await assignConversation.call({ id: one.id, userId: null }, OWNER);
    expect(unassigned.assigneeUserId).toBeNull();
  });

  it("refuses to hand a thread to somebody who is not here", async () => {
    const one = await thread();
    const refused = await failure(
      assignConversation.call(
        { id: one.id, userId: "00000000-0000-4000-8000-0000000000ff" },
        OWNER,
      ),
    );
    // A sentence rather than a constraint name.
    expect(refused.message).toContain("not here");
  });

  // A snoozed thread that never comes back is a closed thread with extra steps.
  it("puts a thread away and brings it back unread", async () => {
    const one = await thread();
    const snoozed = await snoozeConversation.call(
      { id: one.id, until: new Date(Date.now() + 86_400_000).toISOString() },
      OWNER,
    );
    expect(snoozed).toMatchObject({ status: "snoozed", unread: false });
    expect(snoozed.snoozedUntil).toBeTruthy();

    // Nothing is due yet.
    expect(await wakeSnoozedConversations()).toEqual({ woken: 0 });

    await db()
      .update(conversations)
      .set({ snoozedUntil: new Date(Date.now() - 60_000) })
      .where(eq(conversations.id, one.id));
    expect(await wakeSnoozedConversations()).toEqual({ woken: 1 });

    const [back] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, one.id));
    // The state it would have been in had nobody snoozed it.
    expect(back).toMatchObject({ status: "open", unread: true, snoozedUntil: null });
  });

  it("refuses to snooze into the past", async () => {
    const one = await thread();
    const refused = await failure(
      snoozeConversation.call(
        { id: one.id, until: new Date(Date.now() - 60_000).toISOString() },
        OWNER,
      ),
    );
    // It would come back on the next sweep, which is not what anybody means.
    expect(refused.message).toContain("future");
  });

  it("closes a thread and clears its return date", async () => {
    const one = await thread();
    await snoozeConversation.call(
      { id: one.id, until: new Date(Date.now() + 86_400_000).toISOString() },
      OWNER,
    );
    const closed = await setConversationStatus.call({ id: one.id, status: "closed" }, OWNER);
    expect(closed).toMatchObject({ status: "closed", snoozedUntil: null, unread: false });
    const reopened = await setConversationStatus.call({ id: one.id, status: "open" }, OWNER);
    expect(reopened.status).toBe("open");
  });

  // The rule that keeps a thread honest: nothing goes in it that did not go out.
  //
  // C7.10 gave the SMS branch a real adapter, so the refusal on an instance with
  // no provider configured is now the adapter's own sentence rather than the
  // generic one — more useful, and the reason this test names the behaviour it
  // cares about instead of a message. What must not change is that the refusal
  // happens and nothing is written.
  it("refuses to reply on a channel nothing can send on yet", async () => {
    const one = await thread({ channel: "sms", phone: "+447700900123", email: undefined });
    const refused = await failure(
      replyToConversation.call({ id: one.id, body: "On my way" }, OWNER),
    );
    expect(refused.message).toMatch(/not configured|not connected yet|quiet hours/);
    // And nothing was recorded, so the thread does not claim words the customer
    // never saw.
    const [after] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, one.id));
    expect(after!.messageCount).toBe(1);
  });

  // A chat row without an active browser bearer still has nowhere honest to
  // deliver. C7.15 connects live sessions, not arbitrary historical rows.
  it("refuses to reply when a chat has no active browser session", async () => {
    const one = await thread({ channel: "chat" });
    const refused = await failure(
      replyToConversation.call({ id: one.id, body: "Hello" }, OWNER),
    );
    expect(refused.message).toContain("no longer has a browser to reach");
  });

  it("refuses to reply to somebody with no address", async () => {
    const one = await thread({
      channel: "sms",
      phone: "+447700900124",
      email: undefined,
    });
    await db()
      .update(conversations)
      .set({ replyChannel: "email" })
      .where(eq(conversations.id, one.id));
    const refused = await failure(
      replyToConversation.call({ id: one.id, body: "Hello" }, OWNER),
    );
    // The placeholder address is not somewhere a reply can go.
    expect(refused.message).toContain("nowhere to send");
  });

  it("finds a thread by what was said in it", async () => {
    await thread({ body: "Can you quote for a kitchen?" });
    await recordMessage.call(
      {
        email: "sam@example.test",
        name: "Sam Okonjo",
        direction: "inbound",
        channel: "email",
        body: "About the bathroom tiles",
      },
      OWNER,
    );

    // A fragment, because that is what people type.
    const kitchen = await searchInbox.call({ q: "kitch" }, OWNER);
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]!.contactName).toBe("Rae Lane");

    // Or the person's name, the other thing anybody remembers.
    const byName = await searchInbox.call({ q: "Okonjo" }, OWNER);
    expect(byName).toHaveLength(1);
  });

  it("shows the last thing said, so a list of threads reads as a list of things", async () => {
    const one = await thread({ body: "First message" });
    await recordMessage.call(
      {
        contactId: one.contactId,
        direction: "inbound",
        channel: "email",
        body: "Actually, make that two kitchens",
      },
      OWNER,
    );
    const listed = await searchInbox.call({}, OWNER);
    expect(listed[0]!.preview).toContain("two kitchens");
  });

  it("narrows to what is mine, what is nobody's and what is unread", async () => {
    const mine = await thread();
    await assignConversation.call({ id: mine.id, userId: STAFF.userId }, OWNER);
    await recordMessage.call(
      { email: "sam@example.test", direction: "inbound", channel: "email", body: "Hello" },
      OWNER,
    );

    expect(await searchInbox.call({ assigneeUserId: STAFF.userId }, OWNER)).toHaveLength(1);
    expect(await searchInbox.call({ unassigned: true }, OWNER)).toHaveLength(1);
    expect(await searchInbox.call({ unreadOnly: true }, OWNER)).toHaveLength(2);
    expect(await searchInbox.call({ openOnly: true }, OWNER)).toHaveLength(2);
  });

  it("counts what is waiting", async () => {
    const one = await thread();
    await recordMessage.call(
      { email: "sam@example.test", direction: "inbound", channel: "email", body: "Hello" },
      OWNER,
    );
    await assignConversation.call({ id: one.id, userId: OWNER.userId }, OWNER);

    const counted = await inboxCounts.call({}, OWNER);
    expect(counted).toMatchObject({ open: 2, unread: 2, unassigned: 1, mine: 1 });
  });

  // Bulk is the same services in a loop, so the rules cannot diverge.
  it("does one thing to several threads at once", async () => {
    const first = await thread();
    const { conversation: second } = await recordMessage.call(
      { email: "sam@example.test", direction: "inbound", channel: "email", body: "Hello" },
      OWNER,
    );

    const done = await bulkConversations.call(
      { ids: [first.id, second.id], action: "close" },
      OWNER,
    );
    expect(done.affected).toBe(2);
    expect(await searchInbox.call({ openOnly: true }, OWNER)).toHaveLength(0);

    const handed = await bulkConversations.call(
      { ids: [first.id, second.id], action: "assign", userId: STAFF.userId },
      OWNER,
    );
    expect(handed.affected).toBe(2);
    expect(await searchInbox.call({ assigneeUserId: STAFF.userId }, OWNER)).toHaveLength(2);
  });

  it("refuses a bulk snooze with no date", async () => {
    const one = await thread();
    const refused = await failure(
      bulkConversations.call({ ids: [one.id], action: "snooze" }, OWNER),
    );
    expect(refused.message).toContain("when they should come back");
  });

  it("applies the same rules in bulk as one at a time", async () => {
    const one = await thread();
    const refused = await failure(
      bulkConversations.call(
        {
          ids: [one.id],
          action: "snooze",
          until: new Date(Date.now() - 60_000).toISOString(),
        },
        OWNER,
      ),
    );
    // A bulk snooze that skipped the past-date check is how an inbox ends up
    // with threads in states nothing else expects.
    expect(refused.message).toContain("future");
  });
});
