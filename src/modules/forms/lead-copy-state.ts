// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.34: frozen provider request and physical caller evidence.
import { randomUUID } from "node:crypto";
import { eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { ParadiseSite } from "@/adapters/paradise/config";
import { paradiseLeadBody } from "@/adapters/lead-sink/paradise";
import { db } from "@/core/db";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { mailReceiptKeys } from "@/core/mail/schema";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { and } from "drizzle-orm";
import { mailReceipts, type MailReceipts } from "@/core/mail/receipts";
import { decryptMailOutbox, encryptMailOutbox } from "@/core/mail/outbox-crypto";
import { ServiceError, type Tx } from "@/core/service";
import { leadCopy } from "./lead-sink";
import { leadCredentialFingerprint, type LeadNotice } from "./lead-notice";
import { formLeadCopies, formSubmissions, type LeadCopyAttempt } from "./schema";
import type { FormField } from "./fields";
export async function leadCopyReceipts(tx: Tx) {
  await tx.execute(sql`select set_config('freeholder.lead_copy_v1','1',true)`);
  const [key] = await tx.select({ id: mailReceiptKeys.id }).from(mailReceiptKeys).limit(1);
  if (!key) {
    const [witness] = await tx.select({ id: formLeadCopies.id }).from(formLeadCopies).where(or(isNotNull(formLeadCopies.resourceDigest), isNotNull(formLeadCopies.requestDigest), isNotNull(formLeadCopies.noticeDigest), isNotNull(formLeadCopies.reviewDigest), isNotNull(formLeadCopies.providerRefDigest))).limit(1);
    if (witness) throw new ServiceError("conflict", "Restore the exact original receipt key before using retained lead witnesses.");
  }
  return mailReceipts(tx);
}
export async function stageLeadCopy(tx: Tx, input: { submissionId: string; form: { slug: string; fields: FormField[] }; data: Record<string, unknown>; sourceUrl: string | null; notice: LeadNotice }): Promise<string> {
  const receipts = await leadCopyReceipts(tx), id = randomUUID();
  const body = JSON.stringify(paradiseLeadBody(leadCopy(input.form, { id: input.submissionId, data: input.data, sourceUrl: input.sourceUrl })));
  await tx.insert(formLeadCopies).values({ id, submissionId: input.submissionId, kind: "site_notice", originalBaseUrl: input.notice.baseUrl, resourceDigest: receipts.digest("provider:lead-resource", JSON.stringify([input.notice.baseUrl, input.notice.credentialFingerprint])), requestDigest: receipts.digest("provider:lead-request", body), noticeDigest: receipts.digest("provider:lead-notice", JSON.stringify(input.notice)), encryptedRequest: encryptMailOutbox(body, `lead-copy:${id}`), state: "ready" });
  return id;
}
export function effectiveLeadAttempt(attempt: LeadCopyAttempt) {
  if (attempt.humanOutcome) {
    if (["copied", "not_copied"].includes(attempt.observed) && attempt.observed !== attempt.humanOutcome) return "unknown" as const;
    return attempt.humanOutcome;
  }
  return attempt.observed === "running" ? "unknown" as const : attempt.observed;
}
/** A final removal proof covers exact current facts, never just an old timestamp. */
export function leadCopyEvidenceDigest(copy: Pick<typeof formLeadCopies.$inferSelect, "kind" | "legacyOutcome" | "attempts">, receipts: MailReceipts) {
  return receipts.digest("provider:lead-erasure-coverage", JSON.stringify({ kind: copy.kind, legacyOutcome: copy.legacyOutcome, attempts: copy.attempts.map(({ id, attempt, observed, responseDigest, httpStatus, humanOutcome }) => ({ id, attempt, observed, responseDigest, httpStatus, humanOutcome })) }));
}
export function leadCopyErasureConfirmed(copy: typeof formLeadCopies.$inferSelect, receipts: MailReceipts) {
  return Boolean(copy.remoteErasedAt && copy.remoteErasureDigest === leadCopyEvidenceDigest(copy, receipts));
}
export function leadCopyUnknown(copy: typeof formLeadCopies.$inferSelect) {
  return (copy.kind === "legacy_review" && !copy.legacyOutcome) || copy.attempts.some(attempt => effectiveLeadAttempt(attempt) === "unknown");
}
export function leadCopyCopied(copy: typeof formLeadCopies.$inferSelect) {
  return copy.legacyOutcome === "copied" || copy.attempts.some(attempt => effectiveLeadAttempt(attempt) === "copied");
}
export async function claimLeadCopy(copyId: string, site: ParadiseSite) {
  return db().transaction(async tx => {
    await lockContactIdentityForRead(tx);
    const receipts = await leadCopyReceipts(tx);
    const [copy] = await tx.select().from(formLeadCopies).where(eq(formLeadCopies.id, copyId)).for("update");
    if (!copy) throw new ServiceError("conflict", "The original lead-copy witness is missing.");
    if (copy.state === "cancelled" || (["copied", "not_copied"].includes(copy.state) && copy.admittedAttempt <= copy.attempts.length)) return null;
    if (copy.kind !== "site_notice" || copy.retiredAt || !copy.encryptedRequest || !copy.submissionId || !site.apiKey || copy.originalBaseUrl !== site.baseUrl || copy.resourceDigest !== receipts.digest("provider:lead-resource", JSON.stringify([site.baseUrl, leadCredentialFingerprint(site.baseUrl, site.apiKey)]))) throw new ServiceError("conflict", "Restore the evidenced original lead account; today's replacement or a legacy destination cannot be used.");
    const [parent] = await tx.select({ id: formSubmissions.id, status: formSubmissions.status }).from(formSubmissions).where(eq(formSubmissions.id, copy.submissionId)).for("update");
    if (!parent || copy.attempts.some(attempt => effectiveLeadAttempt(attempt) !== "not_copied") || copy.admittedAttempt !== copy.attempts.length + 1 || copy.admittedAttempt > 20) throw new ServiceError("conflict", "The original lead-copy outcome needs provider and stopped-caller review before another request.");
    if (parent.status !== "received") { await tx.update(formLeadCopies).set({ state: "cancelled", updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id)); return null; }
    const plaintext = decryptMailOutbox(copy.encryptedRequest, `lead-copy:${copy.id}`);
    if (receipts.digest("provider:lead-request", plaintext) !== copy.requestDigest) throw new ServiceError("conflict", "The original lead request no longer matches its private receipt.");
    const operationId = randomUUID();
    await tx.update(formLeadCopies).set({ state: "running", attempts: [...copy.attempts, { id: operationId, attempt: copy.admittedAttempt, observed: "running" }], updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id));
    return { id: copy.id, operationId, body: JSON.parse(plaintext) as unknown };
  });
}
export async function finishLeadCopy(copyId: string, operationId: string, result: { observed: "copied" | "not_copied" | "unknown"; providerRef?: string; response?: unknown; httpStatus?: number; retry?: boolean }) {
  await db().transaction(async tx => {
    const receipts = await leadCopyReceipts(tx);
    const [copy] = await tx.select().from(formLeadCopies).where(eq(formLeadCopies.id, copyId)).for("update");
    if (!copy) throw new ServiceError("conflict", "Restore the original lead-copy witness.");
    const original = copy.attempts.find(attempt => attempt.id === operationId);
    if (!original) throw new ServiceError("conflict", "The original physical lead operation is missing.");
    if (["copied", "not_copied"].includes(original.observed)) {
      if (original.observed !== result.observed) throw new ServiceError("conflict", "The observed original provider outcome cannot be replaced.");
      return;
    }
    const attempts = copy.attempts.map(attempt => attempt.id === operationId ? { ...attempt, observed: result.observed, ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}), ...(result.response !== undefined ? { responseDigest: receipts.digest("provider:lead-reply", JSON.stringify(result.response)) } : {}) } : attempt);
    const conflict = attempts.some(attempt => effectiveLeadAttempt(attempt) === "unknown"), copied = attempts.some(attempt => effectiveLeadAttempt(attempt) === "copied");
    const privacyPending = Boolean(copy.retiredAt && (conflict || (copied && !leadCopyErasureConfirmed({ ...copy, attempts }, receipts))));
    await tx.update(formLeadCopies).set({ attempts, privacyPending, state: conflict ? "unknown" : copied ? "copied" : "not_copied", ...(result.retry && !copy.retiredAt ? { admittedAttempt: copy.admittedAttempt + 1, state: "ready" as const } : {}), ...(result.providerRef ? { providerRef: copy.retiredAt ? copy.providerRef : result.providerRef, providerRefDigest: receipts.digest("provider:lead-reference", result.providerRef) } : {}), lastError: result.observed === "unknown" ? "The original provider outcome is unknown; verify it and stop its caller before retrying." : result.observed === "not_copied" ? "The original provider refused this copy." : null, updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id));
  });
  // The physical reply is already durable even if original privacy recovery fails.
  const { reconcileLeadErasureForCopy } = await import("./lead-copy-privacy");
  await reconcileLeadErasureForCopy(copyId);
}
/** Stop unstarted work before a subject is forgotten; active callers retain their evidence. */
export async function retireLeadCopies(tx: Tx, ids: string[], requestId?: string) {
  if (!ids.length) return [];
  await lockContactIdentityForRead(tx);
  const receipts = await leadCopyReceipts(tx);
  const holds = await tx.select({ contactId: dataRequests.contactId }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(inArray(privacyRetentionExceptions.scope, ["forms.leadCopies", "forms.submissions", "privacy.records"]), sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`));
  const held = new Set(holds.map(row => row.contactId));
  const rows = await tx.select().from(formLeadCopies).where(inArray(formLeadCopies.submissionId, ids)).orderBy(formLeadCopies.id).for("update");
  const pending: string[] = [];
  for (const row of rows) {
    const [parent] = row.submissionId ? await tx.select({ contactId: formSubmissions.contactId }).from(formSubmissions).where(eq(formSubmissions.id, row.submissionId)) : [];
    const [request] = row.erasureRequestId ? await tx.select({ contactId: dataRequests.contactId }).from(dataRequests).where(eq(dataRequests.id, row.erasureRequestId)) : [];
    const owners = [parent?.contactId, request?.contactId].filter((id): id is string => Boolean(id));
    const heldNow = (held.size > 0 && !owners.length) || owners.some(id => held.has(id));
    const unresolved = heldNow || leadCopyUnknown(row) || (leadCopyCopied(row) && !leadCopyErasureConfirmed(row, receipts));
    await tx.update(formLeadCopies).set({ retiredAt: row.retiredAt ?? new Date(), privacyPending: unresolved, ...(requestId && !row.erasureRequestId ? { erasureRequestId: requestId } : {}), ...(requestId && !row.erasureRequests.includes(requestId) ? { erasureRequests: [...row.erasureRequests, requestId] } : {}), ...(heldNow ? {} : { providerRef: null, encryptedRequest: null }), state: row.state === "ready" ? "cancelled" as const : row.state, ...(row.providerRef ? { providerRefDigest: receipts.digest("provider:lead-reference", row.providerRef) } : {}), updatedAt: new Date() }).where(eq(formLeadCopies.id, row.id));
    if (unresolved) pending.push(row.id);
  }
  return pending;
}
