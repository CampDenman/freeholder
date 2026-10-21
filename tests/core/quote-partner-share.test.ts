// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// View-only quote partner links (MASTER.md C9.34, §34).
//
// The rules:
//
//   1. The prospect who holds the quote token may invite a partner.
//   2. The partner link is view-only: no accept, decline, options or messages.
//   3. A partner view does not mark the quote viewed.
//   4. Invites call contacts.resolve, never contacts.create.
//   5. Merge repoints both contact columns; erasure deletes the links.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { quotePartnerLinks, quotes } from "@/modules/quotes/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createContact, mergeContacts } from "@/core/contacts/service";
import {
  acceptQuote,
  chooseQuoteOptions,
  createQuote,
  inviteQuotePartner,
  quoteByPartnerToken,
  quoteByToken,
  revokeQuotePartner,
  sendQuote,
  setQuoteItems,
} from "@/modules/quotes/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;

describe.runIf(hasDatabase)("quote partner sharing", { timeout: 90_000 }, () => {
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

  async function contactId(email = "rae@example.test", name = "Rae Lane"): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email, name, source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function sent() {
    const quote = await createQuote.call(
      { contactId: await contactId(), title: "Kitchen refit", currency: "GBP" },
      OWNER,
    );
    await setQuoteItems.call(
      {
        id: quote.id,
        items: [{ description: "Units and worktop", unitPriceMinor: 400_000 }],
      },
      OWNER,
    );
    const live = await sendQuote.call({ id: quote.id }, OWNER);
    return { quote, token: live.viewToken };
  }

  it("lets the prospect issue a view-only partner link", async () => {
    const { token } = await sent();
    const seen = await quoteByToken.call({ token }, ANON);
    expect(seen?.canInvitePartner).toBe(true);
    expect(seen?.viewOnly).toBe(false);
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test", name: "Sam Partner" },
      ANON,
    );
    expect(guest.token).toBeTruthy();
    const partner = await quoteByPartnerToken.call({ token: guest.token }, ANON);
    expect(partner).toMatchObject({
      title: "Kitchen refit",
      viewOnly: true,
      canInvitePartner: false,
    });
    expect(partner?.invitedPartners).toEqual([]);
    const people = await db().select().from(contacts);
    expect(people.filter((row) => row.email === "partner@example.test")).toHaveLength(1);
  });

  it("resolves a partner onto an existing contact", async () => {
    const { token } = await sent();
    const existing = await createContact.call(
      { name: "Sam Partner", email: "partner@example.test" },
      OWNER,
    );
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test" },
      ANON,
    );
    expect(guest.contactId).toBe(existing.id);
  });

  it("will not let a partner accept, choose options, or invite someone else", async () => {
    const { token } = await sent();
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test" },
      ANON,
    );
    expect(
      (await failure(
        acceptQuote.call({ token: guest.token, acceptedName: "Sam Partner" }, ANON),
      )).message,
    ).toContain("no longer valid");
    expect(
      (await failure(
        chooseQuoteOptions.call({ token: guest.token, selectedItemIds: [] }, ANON),
      )).message,
    ).toContain("no longer valid");
    expect(
      (await failure(
        inviteQuotePartner.call({ token: guest.token, email: "third@example.test" }, ANON),
      )).message,
    ).toContain("no longer valid");
  });

  it("will not let the prospect invite themselves", async () => {
    const { token } = await sent();
    expect(
      (await failure(
        inviteQuotePartner.call({ token, email: "rae@example.test" }, ANON),
      )).message,
    ).toContain("already yours");
  });

  it("does not mark the quote viewed when a partner opens it", async () => {
    const { quote, token } = await sent();
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test" },
      ANON,
    );
    await quoteByPartnerToken.call({ token: guest.token }, ANON);
    const [row] = await db().select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row!.status).toBe("sent");
    expect(row!.firstViewedAt).toBeNull();
  });

  it("lets the prospect revoke a partner they invited", async () => {
    const { token } = await sent();
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test" },
      ANON,
    );
    const listed = await quoteByToken.call({ token }, ANON);
    expect(listed?.invitedPartners.map((row) => row.id)).toEqual([guest.id]);
    await revokeQuotePartner.call({ token, id: guest.id }, ANON);
    expect(await quoteByPartnerToken.call({ token: guest.token }, ANON)).toBeNull();
    const after = await quoteByToken.call({ token }, ANON);
    expect(after?.invitedPartners).toEqual([]);
  });

  it("repoints partner links on merge", async () => {
    const { quote, token } = await sent();
    const guest = await inviteQuotePartner.call(
      { token, email: "partner@example.test" },
      ANON,
    );
    const keep = await createContact.call({ name: "Keep", email: "keep@example.test" }, OWNER);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: guest.contactId }, OWNER);
    const [row] = await db()
      .select()
      .from(quotePartnerLinks)
      .where(eq(quotePartnerLinks.id, guest.id));
    expect(row!.contactId).toBe(keep.id);
    expect(row!.quoteId).toBe(quote.id);
  });

  it("forgets partner links when the prospect is erased", async () => {
    const { quote, token } = await sent();
    await inviteQuotePartner.call({ token, email: "partner@example.test" }, ANON);
    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter((entry) => entry.scope === "contact.quotes")) {
      await db().transaction((tx) => source.erase(tx, quote.contactId, { requestId: "erase-quote-partner" }));
    }
    expect(await db().select().from(quotePartnerLinks)).toHaveLength(0);
  });
});
