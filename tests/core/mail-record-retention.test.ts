// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: retention removes personal fields without reopening send/event receipts.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { mailDeliveries, mailOutbox, mailProviderEvents, mailRecordSubjects, mailSuppressions } from "@/core/mail/schema";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { mergeContacts, resolveContact, undoContactMerge } from "@/core/contacts/service";
import { addRetentionException, contactPrivacySources, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { getJob, stopJobs } from "@/core/jobs";
import { eraseMailRecords } from "@/core/mail/record-privacy";
import { reviewLegacyMailOwnership } from "@/core/mail/record-services";
import { deliverQueuedMail, mailStatus, pruneExpiredMailOutbox, recordMailProviderEvent, sendMail } from "@/core/mail/service";
import { mailReceiptKeys } from "@/core/mail/schema";
import { mailReceipts, sealMailReceipts } from "@/core/mail/receipts";
import { resetEnvForTests } from "@/core/env";
import { auditLog, outboxEvents } from "@/core/events/schema";
import { notificationDeliveries, notifications } from "@/core/notifications/schema";
import { applyRetentionPolicies, listRetentionPolicies } from "@/core/retention/service";
import { retentionPolicies } from "@/core/retention/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const EMAIL = "retention-subject@example.test";
const PAST = new Date("2020-01-01T00:00:00Z");
describe.runIf(hasDatabase)("legacy mail-record retention (C3.31)", { timeout: 60_000 }, () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => { await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  async function erasure(contactId: string, held = false) {
    const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Fictional fixture identity verified" }, OWNER);
    if (held) await addRetentionException.call({ dataRequestId: request.id, scope: "mail.records", reason: "legal_obligation", legalBasis: "Fictional open dispute requiring these exact mail facts" }, OWNER);
    return fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
  }
  it("offers explicit retention policies for all three address-bearing stores", async () => {
    const result = await listRetentionPolicies.call({}, OWNER);
    expect(result.kinds.map(item => item.kind)).toEqual(expect.arrayContaining(["mail_deliveries", "mail_provider_events", "mail_suppressions"]));
  });
  it("removes old terminal personal fields while preserving send and webhook idempotency", async () => {
    const sendKey = `fixture-mail:${randomUUID()}`;
    const [oneOff] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Private source subject", status: "failed", requestedBy: "system", idempotencyKey: sendKey, attempts: 0, createdAt: PAST, updatedAt: PAST }).returning();
    const [delivery] = await db().insert(mailDeliveries).values({ purpose: "bulk", provider: "resend", recipient: EMAIL, subject: "Private source subject", status: "bounced", requestedBy: "system", providerRef: "fixture-provider-reference", attempts: 1, providerStatusAt: PAST, createdAt: PAST, updatedAt: PAST }).returning();
    const eventInput = { provider: "resend" as const, externalEventId: `fixture-event:${randomUUID()}`, providerRef: "fixture-provider-reference", recipient: EMAIL, eventType: "hard_bounce" as const, detail: "Private source detail", rawDigest: "a".repeat(64), occurredAt: PAST.toISOString() };
    const [event] = await db().insert(mailProviderEvents).values({ ...eventInput, deliveryId: delivery!.id, occurredAt: PAST, createdAt: PAST }).returning();
    await db().insert(mailSuppressions).values({ email: EMAIL, reason: "hard_bounce", provider: "resend", sourceEventId: event!.id, detail: "Private source detail", active: false, releasedAt: PAST, createdAt: PAST, updatedAt: PAST });
    await db().insert(retentionPolicies).values(["mail_deliveries", "mail_provider_events", "mail_suppressions"].map(kind => ({ kind, ttlDays: 1 })));
    await applyRetentionPolicies();
    const current = { deliveries: await db().select().from(mailDeliveries), events: await db().select().from(mailProviderEvents), suppressions: await db().select().from(mailSuppressions) };
    expect(JSON.stringify(current)).not.toContain(EMAIL);
    expect(JSON.stringify(current)).not.toContain("Private source");
    const replay = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Retry", text: "Synthetic retry" }, { idempotencyKey: sendKey }));
    expect(replay).toMatchObject({ id: oneOff!.id, duplicate: true });
    expect(await recordMailProviderEvent.call(eventInput, { kind: "system" })).toEqual({ duplicate: true });
    expect((await db().select().from(mailSuppressions)).some(row => row.active)).toBe(false);
  });
  it("keeps active suppressions and unresolved queued/submitted records off the retention clock", async () => {
    await db().insert(mailDeliveries).values(["queued", "submitted"].map(status => ({ purpose: "transactional" as const, provider: "smtp" as const, recipient: EMAIL, subject: "Still owed", status: status as "queued" | "submitted", requestedBy: "system", attempts: 1, createdAt: PAST, updatedAt: PAST })));
    await db().insert(mailSuppressions).values({ email: EMAIL, reason: "manual", provider: "manual", active: true, createdAt: PAST, updatedAt: PAST });
    await db().insert(retentionPolicies).values(["mail_deliveries", "mail_suppressions"].map(kind => ({ kind, ttlDays: 1 })));
    await applyRetentionPolicies();
    expect((await db().select().from(mailDeliveries)).map(row => row.recipient)).toEqual([EMAIL, EMAIL]);
    expect((await db().select().from(mailSuppressions))[0]).toMatchObject({ email: EMAIL, active: true });
  });
  it("preserves the only original event reference for multiple or unresolved physical attempts", async () => {
    for (const [index, attempts] of [2, 1].entries()) {
      const [delivery] = await db().insert(mailDeliveries).values({ purpose: "bulk", provider: "resend", recipient: EMAIL, subject: "Unresolved original evidence", status: "delivered", deliveredAt: PAST, requestedBy: "system", attempts, providerRef: `latest-reference-${index}`, providerStatusAt: PAST, createdAt: PAST, updatedAt: PAST }).returning();
      if (attempts === 1) await db().insert(mailOutbox).values({ deliveryId: delivery!.id, encryptedMessage: "synthetic-unresolved-encrypted-envelope", createdAt: PAST, updatedAt: PAST });
      await db().insert(mailProviderEvents).values({ provider: "resend", externalEventId: `terminal-looking-${index}`, providerRef: `only-original-reference-${index}`, recipient: EMAIL, eventType: "delivered", rawDigest: "b".repeat(64), deliveryId: delivery!.id, occurredAt: PAST, createdAt: PAST });
    }
    await db().insert(retentionPolicies).values(["mail_deliveries", "mail_provider_events"].map(kind => ({ kind, ttlDays: 1 })));
    await applyRetentionPolicies();
    expect((await db().select().from(mailProviderEvents)).map(row => row.providerRef).sort()).toEqual(["only-original-reference-0", "only-original-reference-1"]);
    expect((await db().select().from(mailDeliveries)).every(row => row.recipient === EMAIL)).toBe(true);
  });
  it("reactivates a retained suppression from a new fact without restoring its old plaintext address", async () => {
    await db().insert(mailSuppressions).values({ email: EMAIL, reason: "manual", provider: "manual", active: false, releasedAt: PAST, createdAt: PAST, updatedAt: PAST });
    await db().insert(retentionPolicies).values({ kind: "mail_suppressions", ttlDays: 1 });
    await applyRetentionPolicies();
    expect((await db().select().from(mailSuppressions))[0]?.email).not.toBe(EMAIL);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: `new-fact:${randomUUID()}`, providerRef: "new-provider-fact", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "c".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    const [suppression] = await db().select().from(mailSuppressions);
    expect(suppression?.active).toBe(true);
    expect(suppression?.email).not.toBe(EMAIL);
    expect(suppression?.redactedAt).not.toBeNull();
  });
  it("erases an active suppression's plaintext while preserving the effective block and late-callback refusal to unredact", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: "owned-first-bounce", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "d".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    expect((await db().select().from(mailRecordSubjects)).map(row => row.contactId)).toEqual([contact.id, contact.id]);
    const erased = await erasure(contact.id);
    expect(erased.request.status).toBe("completed");
    expect((await db().select().from(mailSuppressions))[0]).toMatchObject({ active: true });
    expect((await db().select().from(mailSuppressions))[0]?.email).not.toBe(EMAIL);
    await expect(db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Never dispatch this fixture", text: "Fixture" }))).rejects.toThrow(/suppressed/);
    expect((await db().select().from(mailOutbox))).toHaveLength(0);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: "owned-late-bounce", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "e".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    expect((await db().select().from(mailSuppressions))[0]?.email).not.toBe(EMAIL);
    expect((await db().select().from(mailProviderEvents)).every(row => row.recipient !== EMAIL)).toBe(true);
  });
  it("exports a minimal owned receipt for a minimized active block without exposing its private address lookup", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: "export-retained-block", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "3".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    await erasure(contact.id);
    const [block] = await db().select().from(mailSuppressions);
    const source = contactPrivacySources().find(item => item.scope === "mail.records")!;
    const exported = await db().transaction(tx => source.exportData(tx, contact.id)) as { suppressions: Array<{ id: string; active: boolean; redactedAt: Date }> };
    expect(exported.suppressions).toEqual(expect.arrayContaining([expect.objectContaining({ id: block!.id, active: true, redactedAt: expect.any(Date) })]));
    expect(JSON.stringify(exported)).not.toContain(EMAIL);
    expect(JSON.stringify(exported)).not.toMatch(/Digest|encryptedKey|contactId|verifiedBy|evidence/);
  });
  it("exports every owned record beyond the bounded query page without truncating the privacy subject", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    await db().transaction(async tx => {
      const receipts = await mailReceipts(tx), ids = Array.from({ length: 5_001 }, () => randomUUID());
      await tx.insert(mailDeliveries).values(ids.map(id => ({ id, purpose: "transactional" as const, provider: "console" as const, recipient: EMAIL, recipientDigest: receipts.digest("address", EMAIL), subject: "Owned page fixture", status: "failed" as const, requestedBy: "system" })));
      await tx.insert(mailRecordSubjects).values(ids.map(recordId => ({ kind: "delivery" as const, recordId, contactId: contact.id })));
    });
    const source = contactPrivacySources().find(item => item.scope === "mail.records")!;
    const exported = await db().transaction(tx => source.exportData(tx, contact.id)) as { deliveries: Array<{ id: string }> };
    expect(exported.deliveries).toHaveLength(5_001);
    expect(new Set(exported.deliveries.map(row => row.id)).size).toBe(5_001);
  });
  it("keeps a named hold attached after the contact's address is anonymized", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const queued = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Held fact", text: "Fixture" }));
    await db().update(mailDeliveries).set({ status: "failed", updatedAt: PAST }).where(eq(mailDeliveries.id, queued.id));
    await db().delete(mailOutbox);
    await erasure(contact.id, true);
    expect((await db().select().from(contacts).where(eq(contacts.id, contact.id)))[0]?.email).toBeNull();
    await db().insert(retentionPolicies).values({ kind: "mail_deliveries", ttlDays: 1 });
    await applyRetentionPolicies();
    expect((await db().select().from(mailDeliveries))[0]?.recipient).toBe(EMAIL);
    expect((await db().select().from(mailRecordSubjects))[0]?.contactId).toBe(contact.id);
  });
  it("keeps unresolved physical sends pending and cancels only never-dispatched mail", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const unsent = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Unsent fact", text: "Fixture" }));
    const unknown = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Unknown fact", text: "Fixture" }));
    expect((await db().select().from(mailRecordSubjects)).map(row => row.contactId)).toEqual([contact.id, contact.id]);
    await db().update(mailDeliveries).set({ status: "submitted", attempts: 1 }).where(eq(mailDeliveries.id, unknown.id));
    const erased = await erasure(contact.id);
    expect(erased.request.status).toBe("in_progress");
    const receipt = erased.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const jobId = receipt.outcomes.find(row => row.scope === "mail.records")!.pendingJobs![0]!;
    const job = await getJob("core.eraseMailRecords", jobId);
    expect(JSON.stringify(job?.data)).not.toContain(EMAIL);
    await expect(eraseMailRecords(job!.data)).rejects.toThrow(/Unresolved/);
    await expect(deliverQueuedMail(unknown.id)).resolves.toEqual({ status: "missing" });
    const rows = await db().select().from(mailDeliveries);
    expect(rows.find(row => row.id === unsent.id)?.redactedAt).not.toBeNull();
    expect(rows.find(row => row.id === unknown.id)?.recipient).toBe(EMAIL);
    expect((await db().select().from(mailOutbox))).toHaveLength(1);
  });
  it("requires explicit historical ownership review before minimizing an unbound legacy record", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const [legacy] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Unknown history", status: "failed", requestedBy: "system", createdAt: PAST, updatedAt: PAST }).returning();
    const erased = await erasure(contact.id);
    expect(erased.request.status).toBe("in_progress");
    const receipt = erased.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const job = await getJob("core.eraseMailRecords", receipt.outcomes.find(row => row.scope === "mail.records")!.pendingJobs![0]!);
    await expect(eraseMailRecords(job!.data)).rejects.toThrow(/verified review/);
    await reviewLegacyMailOwnership.call({ kind: "delivery", id: legacy!.id, expectedRecipient: EMAIL, contactId: contact.id, evidence: "Owner checked the original account correspondence and record date.", confirmation: "VERIFIED" }, OWNER);
    await eraseMailRecords(job!.data);
    expect((await db().select().from(mailDeliveries))[0]?.recipient).not.toBe(EMAIL);
  });
  it("keeps receipt joins, address digests and review evidence out of exact-key DTOs and audit inputs", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const [legacy] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Legacy fact", status: "failed", requestedBy: "system" }).returning();
    const evidence = "Synthetic private correspondence proving original ownership.";
    const input = { kind: "delivery" as const, id: legacy!.id, expectedRecipient: EMAIL, contactId: contact.id, evidence, confirmation: "VERIFIED" as const };
    await expect(reviewLegacyMailOwnership.call(input, { kind: "agent", keyName: "mail-only", scopes: ["mail.reviewLegacyOwnership", "contacts.get"] })).rejects.toMatchObject({ code: "permission" });
    await reviewLegacyMailOwnership.call(input, OWNER);
    const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.reviewLegacyOwnership"));
    expect(audit).toMatchObject({ actor: `user:${OWNER.userId}`, diff: { kind: "delivery", id: legacy!.id } });
    expect(JSON.stringify(audit)).not.toContain(evidence);
    const output = await mailStatus.call({}, { kind: "agent", keyName: "mail-read", scopes: ["mail.status"] });
    const encoded = JSON.stringify(output);
    expect(encoded).not.toMatch(/Digest|encryptedKey|wrappingFingerprint|verifiedBy|evidence|contactId/);
    expect((await db().select().from(mailRecordSubjects))[0]?.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps ownership through merge and restores the exact original join on undo", async () => {
    const a = (await resolveContact.call({ email: "mail-merge-a@example.test" }, OWNER)).contact;
    const b = (await resolveContact.call({ email: EMAIL }, OWNER)).contact;
    await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Original owner", text: "Fixture" }));
    const before = await db().select().from(mailRecordSubjects);
    const merged = await mergeContacts.call({ survivingId: a.id, duplicateId: b.id }, OWNER);
    expect((await db().select().from(mailRecordSubjects))[0]?.contactId).toBe(a.id);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect(await db().select().from(mailRecordSubjects)).toEqual(before);
  });
  it("allows removal of a reviewer's login reference without dropping original contact ownership", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const [legacy] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Reviewed fact", status: "failed", requestedBy: "system" }).returning();
    await reviewLegacyMailOwnership.call({ kind: "delivery", id: legacy!.id, expectedRecipient: EMAIL, contactId: contact.id, evidence: "Synthetic independent original correspondence establishes ownership.", confirmation: "VERIFIED" }, OWNER);
    await db().delete(users).where(eq(users.id, OWNER.userId));
    expect((await db().select().from(mailRecordSubjects))[0]).toMatchObject({ contactId: contact.id, verifiedBy: null, basis: "owner_review" });
  });
  it("preserves random site receipt identity across credential rotation and fails closed after key loss", async () => {
    const digest = await db().transaction(async tx => (await mailReceipts(tx)).digest("address", EMAIL));
    const prior = process.env.CREDENTIAL_KEY;
    vi.stubEnv("CREDENTIAL_KEY", "11".repeat(32)); vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", prior); resetEnvForTests();
    expect(await db().transaction(async tx => (await mailReceipts(tx)).digest("address", EMAIL))).toBe(digest);
    await db().transaction(async tx => { const r = await mailReceipts(tx); await tx.insert(mailSuppressions).values({ email: EMAIL, emailDigest: r.digest("address", EMAIL), reason: "manual", provider: "manual" }); });
    await db().delete(mailReceiptKeys);
    await expect(db().transaction(tx => mailReceipts(tx))).rejects.toThrow(/exact database backup/);
    expect(await db().select().from(mailReceiptKeys)).toHaveLength(0);
  });
  it("refuses legacy database writers after irreversible minimization is sealed", async () => {
    await db().transaction(tx => sealMailReceipts(tx));
    await expect(db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Old writer", requestedBy: "system" })).rejects.toThrow();
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
    await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Current guarded writer", text: "Synthetic fixture" }));
    await expect(db().delete(mailOutbox)).rejects.toThrow();
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
  });
  it("keeps an expired unsent private body under its named hold after anonymization", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const queued = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Held original", text: "Synthetic private fixture" }));
    await db().update(mailOutbox).set({ createdAt: PAST }).where(eq(mailOutbox.deliveryId, queued.id));
    const erased = await erasure(contact.id, true);
    expect(erased.request.status).toBe("partially_completed");
    expect(await pruneExpiredMailOutbox()).toBe(0);
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
  });
  it("minimizes linked historical staff notices but waits for their outstanding delivery", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    const event = await recordMailProviderEvent.call({ provider: "resend", externalEventId: "notice-original", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "f".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    expect(event.duplicate).toBe(false);
    const [source] = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, "mail.deliveryUpdated"));
    const [notice] = await db().insert(notifications).values({ recipientUserId: OWNER.userId, topic: "mail.delivery", priority: "warning", locale: "fr", title: "Ancien signalement", body: `Private ${EMAIL}`, dedupeKey: `mail:${EMAIL}:hard_bounce`, sourceEventName: "mail.deliveryUpdated", sourceEventId: source!.id, idempotencyKey: "notice-original" }).returning();
    const [attempt] = await db().insert(notificationDeliveries).values({ notificationId: notice!.id, channel: "sms", status: "processing", attempts: 1 }).returning();
    const erased = await erasure(contact.id);
    expect(erased.request.status).toBe("in_progress");
    expect(JSON.stringify(await db().select().from(notifications))).not.toContain(EMAIL);
    const receipt = erased.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const job = await getJob("core.eraseMailRecords", receipt.outcomes.find(row => row.scope === "mail.records")!.pendingJobs![0]!);
    await expect(eraseMailRecords(job!.data)).rejects.toThrow(/Unresolved/);
    await db().update(notificationDeliveries).set({ status: "delivered", deliveredAt: new Date() }).where(eq(notificationDeliveries.id, attempt!.id));
    await eraseMailRecords(job!.data);
    expect((await db().select().from(mailProviderEvents))[0]?.redactedAt).not.toBeNull();
  });
  for (const ambiguous of ["submitted", "multiple"] as const) it(`keeps a derived ${ambiguous} physical mail copy pending even after its outbox disappeared`, async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: `derived-${ambiguous}`, recipient: EMAIL, eventType: "hard_bounce", rawDigest: "1".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    const [source] = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, "mail.deliveryUpdated"));
    const [notice] = await db().insert(notifications).values({ recipientUserId: OWNER.userId, topic: "mail.delivery", priority: "warning", title: "Old mail notice", body: `Old reader ${EMAIL}`, dedupeKey: `old-mail:${EMAIL}`, sourceEventName: "mail.deliveryUpdated", sourceEventId: source!.id, idempotencyKey: `derived-${ambiguous}` }).returning();
    const [attempt] = await db().insert(notificationDeliveries).values({ notificationId: notice!.id, channel: "email", status: "delivered", attempts: 1, deliveredAt: new Date(), lastError: `Old provider detail ${EMAIL}` }).returning();
    const [copy] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "smtp", recipient: "owner@example.test", subject: `Old rendered subject ${EMAIL}`, status: ambiguous === "submitted" ? "submitted" : "delivered", deliveredAt: ambiguous === "multiple" ? new Date() : null, attempts: ambiguous === "multiple" ? 2 : 1, requestedBy: "system:notifications", idempotencyKey: `notification-delivery:${attempt!.id}`, providerRef: "only-original-derived-reference", lastError: `Old rendered error ${EMAIL}` }).returning();
    const erased = await erasure(contact.id);
    expect(erased.request.status).toBe("in_progress");
    expect((await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, copy!.id)))[0]?.providerRef).toBe("only-original-derived-reference");
  });
  it("minimizes address-bearing fields of a positively settled derived mail copy", async () => {
    const { contact } = await resolveContact.call({ email: EMAIL }, OWNER);
    await recordMailProviderEvent.call({ provider: "resend", externalEventId: "derived-settled", recipient: EMAIL, eventType: "hard_bounce", rawDigest: "2".repeat(64), occurredAt: new Date().toISOString() }, { kind: "system" });
    const [source] = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, "mail.deliveryUpdated"));
    const [notice] = await db().insert(notifications).values({ recipientUserId: OWNER.userId, topic: "mail.delivery", priority: "warning", title: "Old mail notice", body: `Old reader ${EMAIL}`, sourceEventName: "mail.deliveryUpdated", sourceEventId: source!.id, idempotencyKey: "derived-settled" }).returning();
    const [attempt] = await db().insert(notificationDeliveries).values({ notificationId: notice!.id, channel: "email", status: "delivered", attempts: 1, deliveredAt: new Date(), lastError: `Old provider detail ${EMAIL}` }).returning();
    await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: "owner@example.test", subject: `Old rendered subject ${EMAIL}`, status: "failed", attempts: 0, requestedBy: "system:notifications", idempotencyKey: `notification-delivery:${attempt!.id}`, lastError: `Old rendered error ${EMAIL}` });
    expect((await erasure(contact.id)).request.status).toBe("completed");
    expect(JSON.stringify(await db().select().from(mailDeliveries))).not.toContain(EMAIL);
    expect(JSON.stringify(await db().select().from(notificationDeliveries))).not.toContain(EMAIL);
  });
});
