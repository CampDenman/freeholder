// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: fresh human evidence is distinct from each observed carrier reply.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import { carrierResource } from "@/core/mail/carrier-operations";
import { confirmCarrierWithdrawal, listCarrierGrantRecovery } from "@/core/mail/carrier-services";
import { rememberProviderGrant, withdrawDetachedGrants } from "@/core/mail/permission";
import { mailProviderGrants } from "@/core/mail/schema";
import { consentRecords } from "@/core/privacy/schema";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const saved = new Map<string, string | undefined>();
function environment() {
  for (const [key, value] of Object.entries({ PARADISEMODERN_API_KEY: "fictional-carrier-review-original-key", PARADISEMODERN_URL: "https://carrier-review.example.test" })) { saved.set(key, process.env[key]); process.env[key] = value; }
  resetEnvForTests();
}
async function grant(bound = true) {
  const [contact] = await db().insert(contacts).values({ name: "Fictional original reader", email: "reader@example.test" }).returning();
  const [consent] = await db().insert(consentRecords).values({ contactId: contact!.id, purpose: "marketing", channel: "email", state: "granted", method: "double_opt_in", actor: "system" }).returning();
  await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: "reader@example.test", evidenceRef: `freeholder-consent:${consent!.id}`, ...(bound ? await carrierResource(tx) : {}) }));
  const [row] = await db().select().from(mailProviderGrants);
  return row!;
}
function proof(row: Awaited<ReturnType<typeof grant>>) {
  return { id: row.id, expectedRevision: row.revision, expectedEmail: row.email, originalResourceEvidence: "Fictional independently verified original account and original grant reference.", finalProviderEvidence: "Fictional exact provider operation final record confirms no active grant remains.", stoppedCallerEvidence: "Fictional original callers are positively stopped and their remote operations ended.", providerOperationRef: "fictional-provider-final-123", confirmation: "ORIGINAL CARRIER WITHDRAWAL VERIFIED" as const };
}
describe.runIf(hasDatabase)("carrier final-outcome review (C3.31)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => { environment(); await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, role: "owner", email: "owner@example.test" }); });
  afterEach(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } saved.clear(); resetEnvForTests(); setParadiseFetchForTests(undefined); });
  afterAll(closeDb);
  it("requires a fresh person and never exposes keyed receipts or credentials", async () => {
    const original = await grant(), input = proof(original);
    expect((await failure(confirmCarrierWithdrawal.call(input, { ...HUMAN, security: { ...HUMAN.security, stepUpValid: false } }))).code).toBe("step_up_required");
    for (const actor of [{ kind: "system" as const }, { kind: "agent" as const, keyName: "fixture", scopes: ["*"] }, { kind: "plugin" as const, name: "fixture", grants: HUMAN.grants }, { ...HUMAN, keyScopes: ["mail.confirmCarrierWithdrawal"] }]) expect((await failure(confirmCarrierWithdrawal.call(input, actor))).code).toBe("permission");
    const listed = await listCarrierGrantRecovery.call({}, HUMAN);
    expect(listed.rows).toHaveLength(1); expect(listed.rows[0]?.originalResourceKnown).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(original.resourceDigest);
    expect(JSON.stringify(listed)).not.toContain("fictional-carrier-review-original-key");
  });
  it("records final human proof without assigning today's account to a legacy grant", async () => {
    const original = await grant(false), input = proof(original);
    expect(await confirmCarrierWithdrawal.call(input, HUMAN)).toEqual({ id: original.id, source: "human_provider_confirmation" });
    const [reviewed] = await db().select().from(mailProviderGrants);
    expect(reviewed?.withdrawnAt).toBeInstanceOf(Date); expect(reviewed?.reviewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed?.resourceDigest).toBeNull(); expect(reviewed?.resourceBaseUrl).toBeNull(); expect(reviewed?.carrierOperations).toEqual([]);
    const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.confirmCarrierWithdrawal"));
    expect(JSON.stringify(audit)).not.toContain(input.finalProviderEvidence); expect(JSON.stringify(audit)).not.toContain(input.expectedEmail);
  });
  it("rejects stale reviews after the grant's ownership changes", async () => {
    const original = await grant();
    await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, original.id));
    expect((await failure(confirmCarrierWithdrawal.call(proof(original), HUMAN))).code).toBe("conflict");
  });
  it("keeps an observed refusal intact when a human later verifies final withdrawal", async () => {
    const original = await grant(); await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, original.id));
    let calls = 0; setParadiseFetchForTests(async () => { calls++; return new Response('{"code":"SITE_KEY_FORBIDDEN"}', { status: 403 }); });
    expect(await withdrawDetachedGrants([original.id])).toEqual({ removed: 0, waiting: 1 });
    const [refused] = await db().select().from(mailProviderGrants);
    expect(refused?.carrierOperations).toMatchObject([{ kind: "withdraw", state: "refused" }]);
    await confirmCarrierWithdrawal.call(proof(refused!), HUMAN);
    expect((await db().select().from(mailProviderGrants))[0]?.carrierOperations).toEqual(refused?.carrierOperations);
    expect(await withdrawDetachedGrants([original.id])).toEqual({ removed: 1, waiting: 0 }); expect(calls).toBe(1);
  });
});
