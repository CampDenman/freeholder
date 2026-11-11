// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.15/C11.10: legal retention is not continued login access.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users, sessions, passwordResets, totpFactors, webauthnCredentials, twoFactorRecoveryCodes, twoFactorChallenges } from "@/core/auth/schema";
import { createSession, validateSession } from "@/core/auth/sessions";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey, verifyApiKey } from "@/core/apikeys/tokens";
import { createMyKey } from "@/core/apikeys/personal";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { addRetentionException, createDataRequest, fulfillDataRequest, getDataRequest, registerContactPrivacySource, removeRetentionException, verifyDataRequest } from "@/core/privacy/service";
import { joinSite, setMemberStatus, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { savePayoutInstructions } from "@/modules/members/payouts";
import { memberConversationParticipants, memberConversations, memberGroupCallParticipants, memberGroupCalls, memberPayoutAccounts, memberProfiles } from "@/modules/members/schema";
import { outboxEvents } from "@/core/events/schema";
import { products } from "@/modules/catalog/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

let erasureBarrier: { entered: () => void; wait: Promise<void> } | undefined;
let retainedOrigins: Array<{ requestId: string; exceptionId: string }> = [];
registerContactPrivacySource({
  scope: "test.memberHoldOrigins", tables: [], retentionScopes: ["members"],
  exportData: async () => null,
  retain: async (_tx, _contactId, context) => { retainedOrigins.push({ requestId: context.requestId, exceptionId: context.exceptionId }); },
  erase: async () => ({ affected: 0 }),
});
registerContactPrivacySource({
  scope: "test.heldLoginPause", tables: [], eraseOrder: 101,
  exportData: async () => null,
  erase: async () => {
    const barrier = erasureBarrier;
    if (barrier) { erasureBarrier = undefined; barrier.entered(); await barrier.wait; }
    return { affected: 0 };
  },
});

describe.runIf(hasDatabase)("held member login (C1.08/C12.15)", () => {
  let contactId: string;
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    erasureBarrier = undefined;
    retainedOrigins = [];
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: CUSTOMER.userId, email: "held-member@example.test", role: "customer", passwordHash: "synthetic-original-password-hash", otpSecret: "synthetic-legacy-factor" },
    ]);
    await updateBusiness.call({ name: "Held member fixture", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    contactId = (await resolveContact.call({ email: "held-member@example.test", name: "Held member" }, OWNER)).contact.id;
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contactId));
    await joinSite.call({ handle: "held_member", displayName: "Held member", meetsMinimumAge: true, isAdult: true }, CUSTOMER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false }, OWNER);
    await createListing.call({ title: "Held original listing", kind: "digital", price: "10", acceptPolicy: true }, CUSTOMER);
    await savePayoutInstructions.call({ instructions: "Original held instructions" }, CUSTOMER);
  });
  afterAll(closeDb);

  async function request() {
    const row = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: row.id, method: "Synthetic held member identity verified" }, OWNER);
    return row.id;
  }
  async function hold() {
    const id = await request();
    const exception = await addRetentionException.call({ dataRequestId: id, scope: "members", reason: "legal_claim", legalBasis: "Retain original member records until this named synthetic dispute is resolved." }, OWNER);
    return { id, exception };
  }

  it("preserves held records and ownership while revoking every login route", async () => {
    const session = await db().transaction(tx => createSession(tx, CUSTOMER.userId));
    const key = mintApiKey();
    await db().insert(apiKeys).values({ name: "Synthetic personal key", tokenHash: key.tokenHash, prefix: key.prefix, actsAsUserId: CUSTOMER.userId, scopes: ["members.*"], expiresAt: new Date(Date.now() + 60_000) });
    const expiresAt = new Date(Date.now() + 60_000);
    await db().insert(passwordResets).values({ userId: CUSTOMER.userId, tokenHash: "synthetic-reset", expiresAt });
    await db().insert(totpFactors).values({ userId: CUSTOMER.userId, encryptedSecret: "synthetic-factor" });
    await db().insert(webauthnCredentials).values({ userId: CUSTOMER.userId, credentialId: "synthetic-credential", name: "Synthetic passkey", publicKey: "synthetic-public-key", deviceType: "singleDevice" });
    await db().insert(twoFactorRecoveryCodes).values({ userId: CUSTOMER.userId, codeHash: "synthetic-recovery" });
    await db().insert(twoFactorChallenges).values({ userId: CUSTOMER.userId, purpose: "login", tokenHash: "synthetic-challenge", expiresAt });
    const [originalAccount] = await db().select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId));
    const { id } = await hold();
    const result = await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    expect((await db().select().from(products).where(eq(products.sellerUserId, CUSTOMER.userId))).map(row => row.name)).toContain("Held original listing");
    expect((await db().select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId)))[0]).toEqual(originalAccount);
    expect((await db().select().from(memberProfiles).where(eq(memberProfiles.userId, CUSTOMER.userId)))[0]?.status).toBe("suspended");
    expect((await db().select().from(contacts).where(eq(contacts.id, contactId)))[0]).toMatchObject({ userId: CUSTOMER.userId, source: "privacy-erasure", email: null, name: "Erased contact" });
    expect((await db().select().from(users).where(eq(users.id, CUSTOMER.userId)))[0]).toMatchObject({ passwordHash: null, otpSecret: null });
    expect(await db().transaction(tx => validateSession(tx, session.token))).toBeUndefined();
    expect(await verifyApiKey(key.token)).toBeUndefined();
    for (const table of [sessions, passwordResets, totpFactors, webauthnCredentials, twoFactorRecoveryCodes, twoFactorChallenges]) expect(await db().select().from(table)).toHaveLength(0);
    expect(await failure(db().transaction(tx => createSession(tx, CUSTOMER.userId)))).toMatchObject({ code: "permission" });
    expect(await failure(setMemberStatus.call({ userId: CUSTOMER.userId, status: "active" }, OWNER))).toMatchObject({ code: "conflict" });
  });

  it("finds and erases the retained member after its named hold is released", async () => {
    const { id, exception } = await hold();
    await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    await removeRetentionException.call({ id: exception.id }, OWNER);
    const result = await fulfillDataRequest.call({ id: await request(), confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("completed");
    expect(await db().select().from(users).where(eq(users.id, CUSTOMER.userId))).toHaveLength(0);
    expect(await db().select().from(memberProfiles).where(eq(memberProfiles.userId, CUSTOMER.userId))).toHaveLength(0);
    expect(await db().select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId))).toHaveLength(0);
    expect((await db().select().from(contacts).where(eq(contacts.id, contactId)))[0]?.userId).toBeNull();
  });

  it("erases an unheld payout account when only the login parent is held", async () => {
    const id = await request();
    await addRetentionException.call({ dataRequestId: id, scope: "contact.credentials", reason: "legal_claim", legalBasis: "Retain only the inert original login parent for this specific identity dispute." }, OWNER);
    const result = await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    expect(await db().select().from(users).where(eq(users.id, CUSTOMER.userId))).toHaveLength(1);
    expect(await db().select().from(memberProfiles).where(eq(memberProfiles.userId, CUSTOMER.userId))).toHaveLength(0);
    expect(await db().select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId))).toHaveLength(0);
  });

  it("retains call history while removing current call and MLS entitlement", async () => {
    const [conversation] = await db().insert(memberConversations).values({ kind: "group", title: "Held historical conversation", createdBy: CUSTOMER.userId }).returning();
    await db().insert(memberConversationParticipants).values({ conversationId: conversation!.id, userId: CUSTOMER.userId, state: "active" });
    const [call] = await db().insert(memberGroupCalls).values({ conversationId: conversation!.id, media: "voice", startedBy: CUSTOMER.userId }).returning();
    await db().insert(memberGroupCallParticipants).values({ callId: call!.id, userId: CUSTOMER.userId });
    const { id } = await hold();
    await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    expect((await db().select().from(memberConversationParticipants))[0]).toMatchObject({ conversationId: conversation!.id, userId: CUSTOMER.userId, state: "left" });
    expect((await db().select().from(memberGroupCalls))[0]).toMatchObject({ id: call!.id, keyGeneration: 1 });
    expect((await db().select().from(memberGroupCallParticipants))[0]?.leftAt).toBeInstanceOf(Date);
    const lost = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, "member.callSeatLost"));
    expect(lost.map(row => row.payload)).toContainEqual({ callId: call!.id, userId: CUSTOMER.userId, deviceId: null, previousGeneration: 0 });
    const second = await hold();
    await fulfillDataRequest.call({ id: second.id, confirmation: "ERASE" }, OWNER);
    expect((await db().select().from(memberGroupCalls))[0]?.keyGeneration).toBe(1);
  });

  it("does not bypass an earlier active legal hold by creating another request", async () => {
    const first = await hold();
    await fulfillDataRequest.call({ id: first.id, confirmation: "ERASE" }, OWNER);
    const next = await request();
    const result = await fulfillDataRequest.call({ id: next, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    expect(await db().select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, CUSTOMER.userId))).toHaveLength(1);
    expect((await getDataRequest.call({ id: next }, OWNER)).exceptions.map(row => row.id)).toContain(first.exception.id);
  });

  it("refuses an already-authenticated personal-key mint after held erasure", async () => {
    const { id } = await hold();
    await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    expect(await failure(createMyKey.call({ name: "Late former member key", scopes: ["members.payoutAccount"] }, CUSTOMER))).toMatchObject({ code: "permission" });
  });

  it("passes every original hold to retained sources when two requests hold the same scope", async () => {
    const first = await hold();
    const next = await request();
    const second = await addRetentionException.call({ dataRequestId: next, scope: "members", reason: "legal_claim", legalBasis: "A second shorter hold must not replace the original continuing legal hold.", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, OWNER);
    await fulfillDataRequest.call({ id: next, confirmation: "ERASE" }, OWNER);
    expect(retainedOrigins).toHaveLength(2);
    expect(retainedOrigins).toEqual(expect.arrayContaining([{ requestId: first.id, exceptionId: first.exception.id }, { requestId: next, exceptionId: second.id }]));
  });

  it("refuses a late personal key from an older writer for the retained erased parent", async () => {
    const { id } = await hold();
    await fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    const key = mintApiKey();
    await db().insert(apiKeys).values({ name: "Synthetic late old-writer key", tokenHash: key.tokenHash, prefix: key.prefix, actsAsUserId: CUSTOMER.userId, scopes: ["members.payoutAccount"], expiresAt: new Date(Date.now() + 60_000) });
    expect(await verifyApiKey(key.token)).toBeUndefined();
  });

  it("serializes actual concurrent session and personal-key issuance behind erasure", async () => {
    const { id } = await hold();
    const otherRequest = await request();
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    erasureBarrier = { entered, wait };
    const erasure = fulfillDataRequest.call({ id, confirmation: "ERASE" }, OWNER);
    const settled = erasure.then(() => undefined);
    // Observe failure too so an unexpected early error cannot leave the test
    // waiting forever for a barrier the transaction never reached.
    await Promise.race([reached, settled]);
    const session = failure(db().transaction(tx => createSession(tx, CUSTOMER.userId)));
    const key = failure(createMyKey.call({ name: "Concurrent held key", scopes: ["members.payoutAccount"] }, CUSTOMER));
    try {
      expect(await failure(addRetentionException.call({ dataRequestId: otherRequest, scope: "members", reason: "legal_claim", legalBasis: "A competing hold must not appear after another request captured its erasure scopes." }, OWNER))).toMatchObject({ code: "conflict" });
      let blocked = 0;
      const deadline = Date.now() + 5_000;
      do {
        const [row] = await db().execute<{ blocked: number }>(sql`select count(*)::int as blocked from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%"users"%'`);
        blocked = row?.blocked ?? 0;
        if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 10));
      } while (blocked < 2 && Date.now() < deadline);
      expect(blocked).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await Promise.allSettled([settled, session, key]);
    }
    expect(await session).toMatchObject({ code: "permission" });
    expect(await key).toMatchObject({ code: "permission" });
  });
});
