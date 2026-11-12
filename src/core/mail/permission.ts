// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Freeholder's consent ledger, as a permission-checking mail provider needs
// to see it (C3.31, MASTER.md §12).
//
// Some mail adapters (`requiresPermission`) refuse campaign mail unless they
// hold a direct opt-in for the recipient, and keep their own record of every
// grant and withdrawal. The proof is Freeholder's: `consent_records` is
// immutable evidence of each decision. This file translates that evidence,
// never invents it.
//
// - A grant is offered only from a method a provider can accept as direct
//   permission: a confirmed double opt-in, a person's own preference-centre
//   choice (an affirmative, unticked-by-default control), or a signed form.
//   Imports, verbal notes and system records stay here; they are not proof a
//   provider can accept, so a campaign to those people is refused.
// - Grants Freeholder records at a carrier are remembered
//   (`mail_provider_grants`), with the address each was recorded under.
// - A withdrawal is mirrored as soon as it commits, and only for those
//   grants: a contact who denied, never opted in, or was never mailed there
//   has nothing at the carrier to withdraw. The address is the grant's, so a
//   contact whose email has changed since is withdrawn where the carrier
//   actually holds them.
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type MarketingConsentEvidence } from "@/adapters/mail/types";
import { db } from "@/core/db";
import { ServiceError, type Tx } from "@/core/service";
import { assertParadiseWithdrawalReply } from "@/adapters/mail/paradise";
import { paradiseSite } from "@/adapters/paradise/config";
import { paradiseRequest } from "@/adapters/paradise/http";
import { carrierResource, carrierOperationOutcome, lockCarrierAddress } from "./carrier-operations";
import { minimizeCarrierGrants } from "./carrier-retention";
import { mailReceipts } from "./receipts";
import { playgroundBlocksExternalDelivery } from "@/core/demo/playground-policy";
import { env } from "@/core/env";
import { mailProviderGrants, type CarrierOperation } from "@/core/mail/schema";
import { consentRecords } from "@/core/privacy/schema";

type ConsentRecord = typeof consentRecords.$inferSelect;

const DIRECT_PERMISSION_METHODS: Partial<Record<ConsentRecord["method"], MarketingConsentEvidence["method"]>> = {
  double_opt_in: "double_opt_in",
  preference_center: "unchecked_checkbox",
  written: "signed_form",
  contract: "signed_form",
};

function wording(evidence: unknown): string | undefined {
  if (!evidence || typeof evidence !== "object") return undefined;
  const record = evidence as Record<string, unknown>;
  for (const key of ["statement", "wording", "label", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length >= 10) return value.trim().slice(0, 4000);
  }
  return undefined;
}

/**
 * The grant evidence for one retained Freeholder record, or null when the
 * record is not proof a provider can accept.
 *
 * When the words shown at collection were not retained, the statement says
 * what the record is rather than reconstructing wording nobody kept.
 */
export function consentEvidenceFromRecord(
  record: Pick<ConsentRecord, "id" | "state" | "method" | "termsVersion" | "sourceUrl" | "ip" | "evidence" | "occurredAt">,
  appUrl: string,
): MarketingConsentEvidence | null {
  if (record.state !== "granted") return null;
  const method = DIRECT_PERMISSION_METHODS[record.method];
  if (!method) return null;
  const origin = new URL(appUrl).origin;
  let source = origin;
  if (record.sourceUrl) {
    try {
      // The page, not whatever rode along in its address: a query string or
      // fragment can carry tokens or a visitor's own details.
      const url = new URL(record.sourceUrl, origin);
      url.search = "";
      url.hash = "";
      source = url.href.slice(0, 2000);
    } catch {
      source = origin;
    }
  }
  const statement =
    wording(record.evidence) ??
    `Marketing email permission recorded by ${record.method.replace("_", " ")}` +
      `${record.termsVersion ? ` under terms version ${record.termsVersion}` : ""}` +
      ` (Freeholder consent record ${record.id}).`;
  return {
    collectedAt: record.occurredAt.toISOString(),
    method,
    statement,
    source,
    evidenceRef: `freeholder-consent:${record.id}`,
    ...(record.ip && isIP(record.ip) ? { recipientIp: record.ip } : {}),
  };
}

/** The current marketing-email grant for a contact, as provider evidence. */
export async function marketingEvidence(contactId: string): Promise<MarketingConsentEvidence | null> {
  const { canContact } = await import("@/core/privacy/service");
  const consent = await canContact.call(
    { contactId, purpose: "marketing", channel: "email" },
    { kind: "system" },
  );
  if (!consent.allowed || !consent.evidenceId) return null;
  const [record] = await db()
    .select()
    .from(consentRecords)
    .where(and(eq(consentRecords.id, consent.evidenceId), eq(consentRecords.contactId, contactId)))
    .limit(1);
  return record ? consentEvidenceFromRecord(record, env().APP_URL) : null;
}

const EVIDENCE_PREFIX = "freeholder-consent:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remember a grant a carrier recorded while sending, from its evidence
 * reference. An explicit original-resource binding may accompany a new
 * observation; omitted historical provenance remains missing. Production
 * Paradise sends reserve the grant before HTTP in carrier-operations.ts.
 */
export async function rememberProviderGrant(
  executor: Pick<Tx, "insert">,
  provider: string,
  grant: { email: string; evidenceRef: string; resourceDigest?: string; resourceBaseUrl?: string },
): Promise<void> {
  if (provider !== "paradise" || !grant.evidenceRef.startsWith(EVIDENCE_PREFIX)) return;
  const consentRecordId = grant.evidenceRef.slice(EVIDENCE_PREFIX.length);
  if (!UUID.test(consentRecordId)) return;
  await executor
    .insert(mailProviderGrants)
    .values({ provider, email: grant.email.trim().toLowerCase(), consentRecordId, resourceDigest: grant.resourceDigest, resourceBaseUrl: grant.resourceBaseUrl })
    .onConflictDoNothing();
}

/** Detached grants remain pending until a positive original-resource withdrawal. */
export async function grantsAwaitingWithdrawal(): Promise<number> {
  const [row] = await db().select({ count: sql<number>`count(*)::int` }).from(mailProviderGrants).where(and(sql`(${mailProviderGrants.consentRecordId} is null or ${mailProviderGrants.withdrawalError} is not null)`, or(isNull(mailProviderGrants.withdrawnAt), eq(mailProviderGrants.recoveryPending, true))));
  return row?.count ?? 0;
}

/** One physical withdrawal. Neither errors nor elapsed time authorize another. */
async function withdrawGrant(grantId: string): Promise<boolean> {
  const site = paradiseSite(), id = randomUUID();
  let email = "", coveredIds: string[] = [];
  const claimed = await db().transaction(async tx => {
    const resource = await carrierResource(tx, site), receipts = await mailReceipts(tx);
    const [original] = await tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grantId));
    if (!original) return "missing";
    await lockCarrierAddress(tx, resource.resourceDigest, original.email);
    const [grant] = await tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grantId)).for("update");
    if (!grant) return "missing";
    if (grant.recoveryPending) return "pending";
    if (grant.withdrawnAt) return "done";
    if (!grant.resourceDigest || !grant.resourceBaseUrl || grant.resourceDigest !== resource.resourceDigest || grant.resourceBaseUrl !== site.baseUrl) throw new ServiceError("conflict", "The original carrier account is unavailable or unproven. Restore and review the original resource; a replacement account cannot withdraw its grants.");
    // Reserve the complete currently known set, not grants created later.
    // An uncertain physical request on one sibling blocks automatic repeats
    // through another grant row for this same original provider resource.
    const related = await tx.select().from(mailProviderGrants).where(and(eq(mailProviderGrants.provider, "paradise"), eq(mailProviderGrants.email, grant.email), eq(mailProviderGrants.resourceDigest, resource.resourceDigest), isNull(mailProviderGrants.withdrawnAt))).orderBy(mailProviderGrants.id).for("update");
    if (related.some(row => row.carrierOperations.some(op => op.kind === "consent" && op.state === "running"))) throw new ServiceError("conflict", "The original carrier consent caller is still running. Its withdrawal waits for that exact outcome.");
    if (related.some(row => row.carrierOperations.some(op => op.kind === "withdraw" || op.state === "running" || op.state === "unknown"))) return "pending";
    email = grant.email; coveredIds = related.map(row => row.id);
    const operation: CarrierOperation = { id, kind: "withdraw", key: "withdraw", resourceDigest: resource.resourceDigest, payloadDigest: receipts.digest("dispatch-payload", JSON.stringify({ email })), coveredGrantIds: coveredIds, state: "running" };
    for (const row of related) await tx.update(mailProviderGrants).set({ carrierOperations: [...row.carrierOperations, operation], updatedAt: new Date() }).where(eq(mailProviderGrants.id, row.id));
    return "claimed";
  });
  if (claimed === "done") return true;
  if (claimed !== "claimed") return false;
  let outcome: Pick<CarrierOperation, "state" | "httpStatus" | "providerCode">;
  let reply: unknown;
  try {
    const response = await paradiseRequest("/api/site-self/email/consent/withdraw", { body: { email }, site });
    assertParadiseWithdrawalReply(response);
    reply = response;
    outcome = { state: "confirmed", httpStatus: response.status };
  } catch (error) { outcome = carrierOperationOutcome(error); }
  await db().transaction(async tx => {
    await carrierResource(tx, site);
    const receipts = await mailReceipts(tx);
    const grants = await tx.select().from(mailProviderGrants).where(inArray(mailProviderGrants.id, coveredIds)).orderBy(mailProviderGrants.id).for("update");
    if (grants.length !== coveredIds.length) throw new ServiceError("conflict", "Restore the original carrier grant witnesses.");
    const completed = outcome.state === "confirmed";
    for (const grant of grants) await tx.update(mailProviderGrants).set({ carrierOperations: grant.carrierOperations.map(op => op.id === id ? { ...op, ...outcome, ...(reply !== undefined ? { responseDigest: receipts.digest("dispatch-resolution", JSON.stringify(reply)) } : {}) } : op), ...(!grant.withdrawnAt ? completed ? { withdrawnAt: new Date(), withdrawalError: null } : { withdrawalError: `Original carrier withdrawal ${outcome.state}; review this exact operation before any replacement.` } : {}), updatedAt: new Date() }).where(eq(mailProviderGrants.id, grant.id));
  });
  return outcome.state === "confirmed";
}

/**
 * Mirror a marketing-email withdrawal to the configured campaign carrier,
 * for every grant Freeholder recorded there for this contact.
 *
 * An outbox listener. Each HTTP call is claimed once. A refusal or lost
 * reply stays pending for original-provider review, never an automatic
 * repeat or a completed erasure. Freeholder's ledger stops campaigns and the
 * delivery worker rechecks consent immediately before every send.
 */
export async function mirrorMarketingWithdrawal(payload: unknown): Promise<void> {
  const event = (payload ?? {}) as {
    contactId?: string;
    purpose?: string;
    channel?: string | null;
    state?: string;
  };
  if (event.purpose !== "marketing" || event.channel !== "email") return;
  // A denial was never a grant, so the carrier holds nothing to withdraw.
  if (event.state !== "withdrawn") return;
  if (!event.contactId) return;
  if (playgroundBlocksExternalDelivery(env()) || !env().PARADISEMODERN_API_KEY) return;
  const grants = await db().select({ id: mailProviderGrants.id }).from(mailProviderGrants).innerJoin(consentRecords, eq(consentRecords.id, mailProviderGrants.consentRecordId)).where(and(eq(consentRecords.contactId, event.contactId), eq(mailProviderGrants.provider, "paradise"), or(isNull(mailProviderGrants.withdrawnAt), eq(mailProviderGrants.recoveryPending, true))));
  for (const grant of grants) await withdrawGrant(grant.id);
}

/**
 * Finish grants whose contact is gone — erased (detached on purpose) or
 * deleted (`consent_record_id` set null by the cascade): withdraw each at the
 * carrier, then minimize the address, keeping only the original private
 * operation receipts. The address is kept only as long as the
 * withdrawal needs it. An erasure waiting on these rows is acknowledged once
 * its last address is minimized.
 *
 * Never deleted unwithdrawn: on the playground nothing is touched, and with
 * no Paradise credentials the rows stay (doctor reports them) until the
 * original credentials are back and the next sweep can attempt them.
 * Refused, uncertain or unproven-resource grants remain pending for review.
 */
export async function withdrawDetachedGrants(
  grantIds?: readonly string[],
): Promise<{ removed: number; waiting: number }> {
  if (grantIds && grantIds.length === 0) return { removed: 0, waiting: 0 };
  const { reopenCarrierErasures, carrierRecoveryCovered } = await import("./carrier-recovery");
  await reopenCarrierErasures(grantIds);
  const grants = await db()
    .select({
      id: mailProviderGrants.id,
      email: mailProviderGrants.email,
      redactedAt: mailProviderGrants.redactedAt,
      recoveryPending: mailProviderGrants.recoveryPending,
      carrierOperations: mailProviderGrants.carrierOperations,
      withdrawalReviews: mailProviderGrants.withdrawalReviews,
      withdrawnAt: mailProviderGrants.withdrawnAt,
      withdrawalError: mailProviderGrants.withdrawalError,
      erasureRequestId: mailProviderGrants.erasureRequestId,
      erasureJobId: mailProviderGrants.erasureJobId,
    })
    .from(mailProviderGrants)
    .where(
      and(
        isNull(mailProviderGrants.consentRecordId),
        or(isNull(mailProviderGrants.redactedAt), eq(mailProviderGrants.recoveryPending, true)),
        ...(grantIds ? [inArray(mailProviderGrants.id, [...grantIds])] : []),
      ),
    );
  if (grants.length === 0) return { removed: 0, waiting: 0 };
  const receipts = await db().transaction(tx => mailReceipts(tx));
  const covered = (grant: typeof grants[number]) => !grant.recoveryPending || carrierRecoveryCovered(grant, receipts);
  const open = grants.filter((grant) => !grant.withdrawnAt || !covered(grant));
  let waiting = 0;
  const finishable = grants.filter((grant) => grant.withdrawnAt && covered(grant));
  for (const grant of open) {
    if (grant.recoveryPending || grant.redactedAt || playgroundBlocksExternalDelivery(env()) || !env().PARADISEMODERN_API_KEY) { waiting++; continue; }
    if (await withdrawGrant(grant.id)) finishable.push(grant);
    else waiting++;
  }
  if (waiting && !env().PARADISEMODERN_API_KEY) console.warn(`[mail] ${waiting} original carrier grant(s) await withdrawal. Restore the original account credentials or review their final outcomes.`);
  if (finishable.length === 0) return { removed: 0, waiting };
  const removed = await db().transaction(tx => minimizeCarrierGrants(tx, finishable.map(grant => grant.id)));
  waiting += finishable.filter(grant => !grant.redactedAt).length - removed;
  const { settleCarrierErasure } = await import("./carrier-recovery");
  for (const requestId of new Set(finishable.flatMap(grant => grant.erasureRequestId ? [grant.erasureRequestId] : []))) {
    const result = await settleCarrierErasure.call({ requestId }, { kind: "system" });
    if (!result.settled) waiting += finishable.filter(grant => grant.erasureRequestId === requestId && grant.redactedAt).length;
  }
  return { removed, waiting };
}
