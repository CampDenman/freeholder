// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading a mailbox for who is in it (C4.18, MASTER.md §41).
//
// The rules that matter are all about restraint: one door into the spine, no
// bodies, no subjects from a mailbox nobody shared, and a display name that a
// stranger chose never overwriting one the owner typed.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import { encryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { parseAddresses } from "@/core/connections/mail-providers";
import { importMail } from "@/core/connections/mail-import";
import { createContact } from "@/core/contacts/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/**
 * Only the rows this import wrote.
 *
 * `contacts.resolve` writes its own `contact.created` entry, which is correct
 * and is not what any of these assertions are about.
 */
async function mailEvents() {
  return db()
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.subjectType, "mail_message"));
}

const ACCOUNT = "00000000-0000-4000-8000-00000000ab01";
const MAILBOX = "owner@example.test";

describe("reading an address header", () => {
  it("takes the address and keeps the name as a suggestion", () => {
    expect(parseAddresses('"Rae Lane" <Rae@Example.test>')).toEqual([
      { email: "rae@example.test", name: "Rae Lane" },
    ]);
    expect(parseAddresses("plain@example.test")).toEqual([
      { email: "plain@example.test" },
    ]);
  });

  it("splits on the commas that separate people, not the ones inside a name", () => {
    // "Surname, Firstname" is routine, and splitting on every comma turns one
    // correspondent into two contacts that do not exist.
    expect(
      parseAddresses('"Lane, Rae" <rae@example.test>, sam@example.test'),
    ).toEqual([
      { email: "rae@example.test", name: "Lane, Rae" },
      { email: "sam@example.test" },
    ]);
  });

  it("drops what is not an address rather than resolving it", () => {
    expect(parseAddresses("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddresses(undefined)).toEqual([]);
  });
});

/** A Gmail holding exactly these messages. */
function gmailHolding(
  messages: {
    id: string;
    from: string;
    to: string;
    subject: string;
    at?: number;
  }[],
) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      return Response.json({ messages: messages.map((message) => ({ id: message.id })) });
    }
    const id = url.pathname.split("/").pop()!;
    const message = messages.find((candidate) => candidate.id === id)!;
    return Response.json({
      id: message.id,
      internalDate: String(message.at ?? Date.now()),
      payload: {
        headers: [
          { name: "From", value: message.from },
          { name: "To", value: message.to },
          { name: "Subject", value: message.subject },
        ],
      },
    });
  });
}

async function connect(options: { shared?: boolean; capability?: boolean } = {}) {
  await db()
    .insert(connectedAccounts)
    .values({
      id: ACCOUNT,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "mailbox-account",
      email: MAILBOX,
      status: "active",
      sharedWithBusiness: options.shared ?? true,
      credentials: encryptSecret(
        JSON.stringify({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          tokenType: "Bearer",
        }),
        ACCOUNT,
      ),
    });
  if (options.capability !== false) {
    await db().insert(connectionCapabilities).values({
      connectedAccountId: ACCOUNT,
      capability: "mail_read",
      enabled: true,
    });
  }
}

describe.runIf(hasDatabase)("importing mail", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: MAILBOX, role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await truncateSpine();
    await closeDb();
  });

  it("resolves a correspondent into the spine and puts the message on their timeline", async () => {
    await connect();
    vi.stubGlobal(
      "fetch",
      gmailHolding([
        {
          id: "m1",
          from: '"Rae Lane" <rae@example.test>',
          to: MAILBOX,
          subject: "Quote for the extension",
        },
      ]),
    );

    const result = await importMail.call({ id: ACCOUNT }, OWNER);
    expect(result).toMatchObject({ messages: 1, contactsCreated: 1, timelineEvents: 1 });

    const [contact] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(contact?.name).toBe("Rae Lane");
    expect(contact?.source).toBe("mail:google");

    const [event] = (await mailEvents()).filter(
      (row) => row.contactId === contact!.id,
    );
    expect(event).toMatchObject({ eventType: "mail.received", subjectType: "mail_message" });
    // The enquiry from three months ago, on the same timeline as the invoice.
    expect(event?.payload).toMatchObject({
      subject: "Quote for the extension",
      // Marked where it is stored, so anything reading a timeline knows this
      // text was written by somebody outside the business.
      trust: "untrusted",
      direction: "in",
    });
  });

  it("never lets a stranger rename somebody the owner has named", async () => {
    // The header is a string somebody else chose. `contacts.resolve` fills
    // blanks and never overwrites, and this is the case that proves it.
    await createContact.call({ name: "Rae Lane (builder)", email: "rae@example.test" }, OWNER);
    await connect();
    vi.stubGlobal(
      "fetch",
      gmailHolding([
        {
          id: "m1",
          from: '"YOUR ACCOUNT IS SUSPENDED" <rae@example.test>',
          to: MAILBOX,
          subject: "Hello",
        },
      ]),
    );
    await importMail.call({ id: ACCOUNT }, OWNER);

    const [contact] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));
    expect(contact?.name).toBe("Rae Lane (builder)");
    // One row, not two: import is a merge, not an insert.
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  it("keeps the subject out of a mailbox nobody shared with the business", async () => {
    await connect({ shared: false });
    vi.stubGlobal(
      "fetch",
      gmailHolding([
        {
          id: "m1",
          from: "doctor@example.test",
          to: MAILBOX,
          subject: "Your test results",
        },
      ]),
    );
    await importMail.call({ id: ACCOUNT }, OWNER);

    const [event] = await mailEvents();
    // Somebody who connected their own mail so the CRM knows who they talk to
    // has not handed over what they talked about.
    expect(event?.payload).not.toHaveProperty("subject");
    expect(JSON.stringify(event)).not.toContain("test results");
    // The correspondent still resolved: who, without what.
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  it("knows which way a message went and leaves the mailbox out of its own contacts", async () => {
    await connect();
    vi.stubGlobal(
      "fetch",
      gmailHolding([
        { id: "m1", from: MAILBOX, to: "sam@example.test", subject: "Following up" },
      ]),
    );
    await importMail.call({ id: ACCOUNT }, OWNER);

    const all = await db().select().from(contacts);
    expect(all.map((contact) => contact.email)).toEqual(["sam@example.test"]);
    const [event] = await mailEvents();
    expect(event?.eventType).toBe("mail.sent");
  });

  it("does not add the same message to a timeline twice", async () => {
    await connect();
    const inbox = gmailHolding([
      { id: "m1", from: "rae@example.test", to: MAILBOX, subject: "Hello" },
    ]);
    vi.stubGlobal("fetch", inbox);
    await importMail.call({ id: ACCOUNT }, OWNER);
    // A coarse "since" window re-reads messages; a timeline that gained an
    // entry every hour would be worse than no timeline.
    const second = await importMail.call({ id: ACCOUNT }, OWNER);
    expect(second.timelineEvents).toBe(0);
    expect(await mailEvents()).toHaveLength(1);
  });

  it("refuses when mail reading is switched off, and when it was never granted", async () => {
    await connect({ capability: false });
    const refused = await failure(importMail.call({ id: ACCOUNT }, OWNER));
    expect(refused.code).toBe("conflict");
    expect(refused.message).toContain("switched off");
  });

  it("is the holder's mailbox to read, not an administrator's", async () => {
    await connect();
    const stranger = "00000000-0000-4000-8000-00000000ab02";
    await db()
      .insert(users)
      .values({ id: stranger, email: "manager@example.test", role: "staff" });

    // §41 keeps "reading a connected account on behalf of anyone but its
    // holder" out of v1, and a manage grant is not a way around that.
    const refused = await failure(
      importMail.call(
        { id: ACCOUNT },
        {
          kind: "user",
          userId: stranger,
          role: "staff",
          grants: [{ module: "connections", access: "manage" }],
        },
      ),
    );
    expect(refused.code).toBe("permission");
    expect(refused.message).toContain("not the same as reading their mail");
    expect(await mailEvents()).toHaveLength(0);
  });

  it("never asks a provider for a message body", async () => {
    await connect();
    const inbox = gmailHolding([
      { id: "m1", from: "rae@example.test", to: MAILBOX, subject: "Hello" },
    ]);
    vi.stubGlobal("fetch", inbox);
    await importMail.call({ id: ACCOUNT }, OWNER);

    const asked = inbox.mock.calls.map((call) => String(call[0]));
    const detail = asked.find((url) => url.includes("/messages/m1"));
    // A client that never downloads a body cannot leak one.
    expect(detail).toContain("format=metadata");
    expect(asked.every((url) => !url.includes("format=full"))).toBe(true);
  });

  it("leaves a mailbox alone when nothing came in", async () => {
    await connect();
    vi.stubGlobal("fetch", gmailHolding([]));
    const result = await importMail.call({ id: ACCOUNT }, OWNER);
    expect(result).toMatchObject({ messages: 0, contactsCreated: 0 });
    expect(await db().select().from(contacts)).toHaveLength(0);

    // The sync still happened, so the next run asks from here rather than
    // ninety days ago all over again.
    const [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.id, ACCOUNT)));
    expect(account?.lastSyncAt).not.toBeNull();
  });
});
