// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Referrals and attribution (MASTER.md §4.3, §4.13, C9.09).
//
// The two tests worth reading first are the structural ones: that a touch
// recorded before anybody knew who the visitor was is still counted once they
// become somebody, and that there is no way to build a chain of referrers —
// §4.13 refuses multi-level structures "by the data model, not by policy", and
// a data model is only refusing while something checks.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { affiliateCodes, attributionTouches } from "@/modules/referrals/schema";
import {
  acceptInvitation,
  attributionFor,
  claimTouches,
  codes,
  creditsFor,
  invite,
  invitations,
  issueCode,
  recordTouch,
  saveProgram,
  withinWindow,
} from "@/modules/referrals/service";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function contact(email: string, name = "Rae") {
  const { contact: found } = await resolveContact.call({ email, name }, OWNER);
  return found;
}

async function programme(overrides: Record<string, unknown> = {}) {
  return saveProgram.call(
    { name: "Word of mouth", status: "active", cookieWindowDays: 30, ...overrides },
    OWNER,
  );
}

describe.runIf(hasDatabase)("referrals and attribution", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("counts a touch that happened before anybody knew who they were", async () => {
    // §4.13: "Attribution is first-party and survives the cookie." This is
    // what that means in practice — the click in March belongs to the contact
    // created in May, and the chain attribution reads is the real one.
    const program = await programme();
    const referrer = await contact("ref@example.test", "Ref");
    await issueCode.call(
      { programId: program.id, contactId: referrer.id, code: "IROCK" },
      OWNER,
    );

    const touched = await recordTouch.call({ code: "IROCK", anonId: "visitor-1" }, ANONYMOUS);
    expect(touched.recorded).toBe(true);

    const customer = await contact("new@example.test", "New");
    const claimed = await claimTouches.call(
      { anonId: "visitor-1", contactId: customer.id },
      { kind: "system" },
    );
    expect(claimed.claimed).toBe(1);

    const credit = await attributionFor.call(
      { contactId: customer.id, programId: program.id },
      OWNER,
    );
    expect(credit.credits).toHaveLength(1);
    expect(credit.credits[0]!.referrerContactId).toBe(referrer.id);
    expect(credit.credits[0]!.share).toBe(1);
  });

  it("refuses multi-level structures in the data model, not in a policy", async () => {
    // §4.13: "There is no parent link on AffiliateCode — and that is
    // deliberate." Asserted here so a later well-meaning change has to argue
    // with a test rather than quietly add a column.
    const columns = getTableConfig(affiliateCodes).columns.map((c) => c.name);
    expect(columns).not.toContain("parent_id");
    expect(columns).not.toContain("parent_code_id");
    expect(columns).not.toContain("upline_id");
  });

  it("lands every kind of arrival in one table", async () => {
    // A link, a QR at a market stall, a code typed at a checkout. Four entry
    // points would become four answers to one question.
    const program = await programme();
    const referrer = await contact("ref@example.test", "Ref");
    await issueCode.call({ programId: program.id, contactId: referrer.id, code: "IROCK" }, OWNER);
    const customer = await contact("new@example.test", "New");

    for (const kind of ["click", "scan", "manual"] as const) {
      await recordTouch.call({ code: "IROCK", contactId: customer.id, kind }, ANONYMOUS);
    }

    const rows = await db()
      .select()
      .from(attributionTouches)
      .where(eq(attributionTouches.contactId, customer.id));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(["click", "scan", "manual"]));
  });

  it("re-reads history when the owner changes the model", async () => {
    // §4.13: "changing the model does not require re-running history — it
    // re-reads it." Nothing is stored about who won, so the same touches give
    // a different, correct answer under a different model.
    const program = await programme({ attributionModel: "last_touch" });
    const first = await contact("first@example.test", "First");
    const last = await contact("last@example.test", "Last");
    const customer = await contact("new@example.test", "New");
    await issueCode.call({ programId: program.id, contactId: first.id, code: "FIRST" }, OWNER);
    await issueCode.call({ programId: program.id, contactId: last.id, code: "LAST" }, OWNER);

    await db().insert(attributionTouches).values([
      {
        contactId: customer.id,
        codeId: (await db().select().from(affiliateCodes).where(eq(affiliateCodes.code, "FIRST")))[0]!.id,
        kind: "click",
        at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        contactId: customer.id,
        codeId: (await db().select().from(affiliateCodes).where(eq(affiliateCodes.code, "LAST")))[0]!.id,
        kind: "click",
        at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    ]);

    const byLast = await attributionFor.call(
      { contactId: customer.id, programId: program.id },
      OWNER,
    );
    expect(byLast.credits[0]!.referrerContactId).toBe(last.id);

    await saveProgram.call(
      { id: program.id, name: "Word of mouth", status: "active", attributionModel: "first_touch" },
      OWNER,
    );
    const byFirst = await attributionFor.call(
      { contactId: customer.id, programId: program.id },
      OWNER,
    );
    // Same rows, different answer, no migration.
    expect(byFirst.credits[0]!.referrerContactId).toBe(first.id);
  });

  it("forgets a touch older than the window the owner stated", async () => {
    const program = await programme({ cookieWindowDays: 7 });
    const referrer = await contact("ref@example.test", "Ref");
    const customer = await contact("new@example.test", "New");
    const issued = await issueCode.call(
      { programId: program.id, contactId: referrer.id, code: "IROCK" },
      OWNER,
    );
    await db().insert(attributionTouches).values({
      contactId: customer.id,
      codeId: issued.id,
      kind: "click",
      at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const credit = await attributionFor.call(
      { contactId: customer.id, programId: program.id },
      OWNER,
    );
    expect(credit.touches).toBe(0);
    expect(credit.credits).toEqual([]);
  });

  it("does not let somebody refer themselves", async () => {
    const program = await programme();
    const both = await contact("both@example.test", "Both");
    const issued = await issueCode.call(
      { programId: program.id, contactId: both.id, code: "MINE" },
      OWNER,
    );
    await db()
      .insert(attributionTouches)
      .values({ contactId: both.id, codeId: issued.id, kind: "manual" });

    const credit = await attributionFor.call(
      { contactId: both.id, programId: program.id },
      OWNER,
    );
    // Refused where it is cheapest — before the number reaches an invoice.
    expect(credit.credits).toEqual([]);
  });

  it("will not issue one code twice", async () => {
    const program = await programme();
    const one = await contact("one@example.test", "One");
    const two = await contact("two@example.test", "Two");
    await issueCode.call({ programId: program.id, contactId: one.id, code: "IROCK" }, OWNER);
    const error = await failure(
      issueCode.call({ programId: program.id, contactId: two.id, code: "IROCK" }, OWNER),
    );
    expect(error.code).toBe("conflict");
  });

  it("shrugs at a code nobody has, rather than failing a page", async () => {
    // Somebody typed something off a card. The page still has to render.
    const result = await recordTouch.call(
      { code: "NOSUCH", anonId: "visitor-1" },
      ANONYMOUS,
    );
    expect(result.recorded).toBe(false);
    expect(result.codeId).toBeNull();
  });

  it("makes an invitation a touch like any other", async () => {
    const program = await programme();
    const referrer = await contact("ref@example.test", "Ref");
    const issued = await issueCode.call(
      { programId: program.id, contactId: referrer.id, code: "IROCK" },
      OWNER,
    );

    const sent = await invite.call(
      {
        referrerContactId: referrer.id,
        codeId: issued.id,
        channel: "email",
        inviteeEmail: "friend@example.test",
      },
      OWNER,
    );
    expect(sent.token).toBeTruthy();

    const accepted = await acceptInvitation.call(
      { token: sent.token, email: "friend@example.test", name: "Friend" },
      ANONYMOUS,
    );
    expect(accepted.accepted).toBe(true);

    const friend = await contact("friend@example.test", "Friend");
    const credit = await attributionFor.call(
      { contactId: friend.id, programId: program.id },
      OWNER,
    );
    expect(credit.credits[0]!.referrerContactId).toBe(referrer.id);

    const sentList = await invitations.call({ referrerContactId: referrer.id }, OWNER);
    expect(sentList[0]!.acceptedAt).not.toBeNull();
  });

  it("stores only the hash of an invitation token", async () => {
    const program = await programme();
    const referrer = await contact("ref@example.test", "Ref");
    const issued = await issueCode.call(
      { programId: program.id, contactId: referrer.id, code: "IROCK" },
      OWNER,
    );
    const sent = await invite.call(
      { referrerContactId: referrer.id, codeId: issued.id, channel: "link" },
      OWNER,
    );
    const rows = await invitations.call({ referrerContactId: referrer.id }, OWNER);
    // The token is returned once and never again, the same rule gallery
    // guests and quote links follow.
    expect(JSON.stringify(rows)).not.toContain(sent.token);
  });

  it("refuses to send an invitation on somebody else's code", async () => {
    const program = await programme();
    const mine = await contact("mine@example.test", "Mine");
    const theirs = await contact("theirs@example.test", "Theirs");
    const issued = await issueCode.call(
      { programId: program.id, contactId: theirs.id, code: "THEIRS" },
      OWNER,
    );
    const error = await failure(
      invite.call({ referrerContactId: mine.id, codeId: issued.id }, OWNER),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps a referrer's codes when two contacts merge", async () => {
    const program = await programme();
    const keep = await contact("keep@example.test", "Keep");
    const dupe = await contact("dupe@example.test", "Dupe");
    await issueCode.call({ programId: program.id, contactId: dupe.id, code: "DUPE" }, OWNER);

    const { mergeContacts } = await import("@/core/contacts/service");
    await mergeContacts.call({ duplicateId: dupe.id, survivingId: keep.id }, OWNER);

    const theirs = await codes.call({ contactId: keep.id }, OWNER);
    expect(theirs.map((c) => c.code)).toEqual(["DUPE"]);
  });

  it("splits credit the way position-based says it does", () => {
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const chain = [
      { codeId: "a", at: at(9) },
      { codeId: "b", at: at(6) },
      { codeId: "c", at: at(3) },
    ];
    const credits = creditsFor("position_based", chain);
    const share = (id: string) => credits.find((c) => c.codeId === id)!.share;
    // The click that introduced somebody and the click that closed them are
    // each worth twice everything in between, together.
    expect(share("a")).toBeCloseTo(0.4);
    expect(share("c")).toBeCloseTo(0.4);
    expect(share("b")).toBeCloseTo(0.2);
    expect(credits.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1);
  });

  it("gives both ends half when there is no middle", () => {
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const credits = creditsFor("position_based", [
      { codeId: "a", at: at(4) },
      { codeId: "b", at: at(1) },
    ]);
    // Not 40/40 with a fifth going nowhere.
    expect(credits.every((c) => c.share === 0.5)).toBe(true);
    expect(creditsFor("position_based", [{ codeId: "a", at: at(1) }])[0]!.share).toBe(1);
  });

  it("orders the chain oldest first, whatever order it was stored in", () => {
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const ordered = withinWindow(
      [
        { codeId: "late", at: at(1) },
        { codeId: "early", at: at(5) },
        { codeId: "expired", at: at(90) },
      ],
      30,
      new Date(),
    );
    expect(ordered.map((t) => t.codeId)).toEqual(["early", "late"]);
  });
});
