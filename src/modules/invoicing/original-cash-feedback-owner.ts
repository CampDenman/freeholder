// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: raw feedback owns an actual original payment OR receipt.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import type { legacyBankFeedback } from "./legacy-bank-feedback-schema";
import { verifyLegacyBankFeedback } from "./legacy-bank-feedback-proof";
import { legacyFeedbackVerificationKeys, legacyBankFeedbackReviewOwned } from "./legacy-bank-feedback-store";
import { originalLegacyBankAdmissionNamespace } from "./legacy-refund-dispatch";
import { merchantRefundDispatches, merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { originalCashRecoveries, originalCashRecoveryFacts } from "./original-cash-recovery-schema";
import { recoveryOwnerBody, recoveryFactBody } from "./original-cash-recovery-store";
import { cashNamespaceKey, verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
import { moneyStateEvents, payments, refunds } from "./schema";

export interface OriginalFeedbackOwnerCandidate {
  paymentId: string | null; subscriptionChargeReceiptId: string | null;
  platform: string | null; account: string | null; paymentRef: string;
  kind: "legacy_admission" | "payment_observation" | "charge_receipt";
  id: string; fingerprint: string;
}
export interface OriginalFeedbackReceiptAlias { paymentId: string; receiptId: string }
export type OriginalFeedbackOwner = ({ kind: "payment"; paymentId: string; subscriptionChargeReceiptId: null }
  | { kind: "subscription"; paymentId: null; subscriptionChargeReceiptId: string }) & { namespace:{platform:string|null;account:string|null;paymentRef:string;observedPlatform?:string|null};lineageDigest: string };
const unresolved = () => new ServiceError("conflict", "Restore the exact authentic original feedback owner; missing, contradictory or ambiguous financial identity remains repair debt.");

/** A retained foreign-platform positive fact is still real cash, but it
 * cannot borrow this local payment's unrelated frozen merchant profile. */
export function originalFeedbackMatchesFrozenSource(namespace:OriginalFeedbackOwner["namespace"],source:{platform:string;account:string|null}) {
  return namespace.account===source.account&&(namespace.platform===null||namespace.platform===source.platform)
    &&(namespace.observedPlatform===undefined||namespace.observedPlatform===null||namespace.observedPlatform===source.platform);
}

/** Only the database resolver supplies these actual receipt aliases. No raw
 * event field, current account, amount, email or absence supplies ownership. */
export function uniqueOriginalFeedbackOwner(candidates: readonly OriginalFeedbackOwnerCandidate[], aliases: readonly OriginalFeedbackReceiptAlias[]): OriginalFeedbackOwner {
  if (!candidates.length || candidates.length + aliases.length > 5000) throw unresolved();
  const aliasByReceipt = new Map<string, string>();
  for (const alias of aliases) {
    const previous = aliasByReceipt.get(alias.receiptId);
    if (previous && previous !== alias.paymentId) throw unresolved();
    aliasByReceipt.set(alias.receiptId, alias.paymentId);
  }
  const owners = new Set<string>(), namespaces = new Set<string>(), platforms = new Set<string>();
  for (const source of candidates) {
    if ((source.paymentId === null) === (source.subscriptionChargeReceiptId === null) || source.platform===null&&source.kind!=="legacy_admission") throw unresolved();
    const paymentId = source.paymentId ?? aliasByReceipt.get(source.subscriptionChargeReceiptId!);
    owners.add(paymentId ? `payment:${paymentId}` : `subscription:${source.subscriptionChargeReceiptId!}`);
    namespaces.add(merchantTaxDigest({ account: source.account, paymentRef: source.paymentRef }));
    if (source.platform !== null) platforms.add(source.platform);
  }
  // A legacy admission retains unknown creator platform. It may corroborate
  // the same original local owner/PI/account without backfilling that platform.
  if (owners.size !== 1 || namespaces.size !== 1 || platforms.size > 1) throw unresolved();
  const namespace={platform:[...platforms][0]??null,account:candidates[0]!.account,paymentRef:candidates[0]!.paymentRef};
  const owner = [...owners][0]!, lineageDigest = merchantTaxDigest({ candidates: [...candidates].sort((a,b) => merchantTaxDigest(a).localeCompare(merchantTaxDigest(b))),
    aliases: [...aliases].sort((a,b) => a.receiptId.localeCompare(b.receiptId) || a.paymentId.localeCompare(b.paymentId)) });
  return owner.startsWith("payment:") ? { kind: "payment", paymentId: owner.slice(8), subscriptionChargeReceiptId: null, namespace,lineageDigest }
    : { kind: "subscription", paymentId: null, subscriptionChargeReceiptId: owner.slice(13), namespace,lineageDigest };
}

export async function originalBankFeedbackOwner(tx: Tx, raw: typeof legacyBankFeedback.$inferSelect): Promise<OriginalFeedbackOwner> {
  const keys = legacyFeedbackVerificationKeys(), evidence = verifyLegacyBankFeedback(raw, keys);
  if (!evidence) throw unresolved();
  let count = 0;
  const bounded = <T>(rows: T[]): T[] => { count += rows.length; if (rows.length > 5000 || count > 5000) throw unresolved(); return rows; };
  const candidates: OriginalFeedbackOwnerCandidate[] = [];
  const originalRefundId=sql`${refunds}.${sql.identifier("id")}`;
  const original = bounded(await tx.select({ refund: refunds }).from(refunds).innerJoin(payments, eq(payments.id, refunds.paymentId)).where(and(eq(refunds.provider, "stripe"),
    or(eq(refunds.providerRef, evidence.observedRefundRef), evidence.observedPaymentRef ? eq(payments.providerRef, evidence.observedPaymentRef) : undefined,
      evidence.observedPaymentRef ? sql`exists(select 1 from ${moneyStateEvents} e where e.subject_type='refund' and e.subject_id=${originalRefundId} and e.metadata->>'protocol'='freeholder.refund-physical.v1' and e.metadata->'original'->>'providerPaymentRef'=${evidence.observedPaymentRef})` : undefined)))
    .orderBy(asc(refunds.id)).limit(5001));
  const checkedRefunds=new Set<string>();
  async function addLegacyOwners(rows: Array<typeof refunds.$inferSelect>) {
    const fresh=rows.filter(refund=>!checkedRefunds.has(refund.id));
    for(const refund of fresh)checkedRefunds.add(refund.id);
    const originalEvents = fresh.length ? bounded(await tx.select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType,"refund"),
      inArray(moneyStateEvents.subjectId,fresh.map(refund=>refund.id)))).orderBy(asc(moneyStateEvents.id)).limit(5001)) : [];
    for (const refund of fresh) {
    const admissions = originalEvents.filter(row=>row.subjectId===refund.id&&(["Original provider refund admitted","Original physical refund caller finished","Original physical refund receipt requires recovery"].includes(row.reason??"")
      ||row.metadata!==null&&typeof row.metadata==="object"&&"physicalState" in row.metadata&&row.metadata.physicalState==="admitted"));
    const namespace = await originalLegacyBankAdmissionNamespace(tx, refund);
    // A bad retained old admission cannot be bypassed by a newer positive row.
    if (!namespace) { if (admissions.length || await legacyBankFeedbackReviewOwned(tx,refund.id)) throw unresolved(); continue; }
    if (namespace.originalChargeAccountId === evidence.observedChargeAccountId && (namespace.originalPaymentRef === evidence.observedPaymentRef || namespace.originalRefundRef === evidence.observedRefundRef))
      candidates.push({ paymentId: namespace.paymentId, subscriptionChargeReceiptId: null, platform: null, account: namespace.originalChargeAccountId,
        paymentRef: namespace.originalPaymentRef, kind: "legacy_admission", id: refund.id, fingerprint: namespace.admissionDigest });
    }
  }
  await addLegacyOwners(original.map(row=>row.refund));
  // An exact actual resource binding also owns contradictory observed PI
  // feedback. Its immutable request and real dispatch retain the old source.
  const bindings = bounded(await tx.select({ binding: merchantRefundResourceBindings, request: merchantRefundRequests, dispatch: merchantRefundDispatches }).from(merchantRefundResourceBindings)
    .innerJoin(merchantRefundRequests,eq(merchantRefundRequests.id,merchantRefundResourceBindings.requestId))
    .leftJoin(merchantRefundDispatches,eq(merchantRefundDispatches.id,merchantRefundResourceBindings.dispatchId))
    .where(and(eq(merchantRefundResourceBindings.providerRef,evidence.observedRefundRef),sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${evidence.observedChargeAccountId}`,
      evidence.observedPlatformAccountId ? eq(merchantRefundRequests.providerPlatformAccountId,evidence.observedPlatformAccountId) : undefined)).orderBy(asc(merchantRefundResourceBindings.id)).limit(5001));
  type Scope = { paymentId: string | null; receiptId: string | null; platform: string; account: string | null; intent: string };
  const scopes: Scope[] = [];
  for (const { request, dispatch } of bindings) {
    if (!dispatch || dispatch.requestId !== request.id || dispatch.requestDigest !== request.requestDigest || merchantTaxDigest(request.originalRequest) !== request.requestDigest
      || request.originalRequest.refundAttemptId !== request.id || request.originalRequest.providerRef !== request.originalPaymentRef
      || request.originalRequest.providerPlatformAccountId !== request.providerPlatformAccountId || (request.originalRequest.providerAccountId ?? null) !== request.chargeAccountId
      || (request.originalRequest.paymentId ?? null) !== request.paymentId || (request.originalRequest.subscriptionChargeReceiptId ?? null) !== request.subscriptionChargeReceiptId) throw unresolved();
    scopes.push({ paymentId:request.paymentId,receiptId:request.subscriptionChargeReceiptId,platform:request.providerPlatformAccountId,account:request.chargeAccountId,intent:request.originalPaymentRef });
  }
  const observedResources = bounded(await tx.select({ owner: originalCashRecoveries, fact: originalCashRecoveryFacts }).from(originalCashRecoveryFacts)
    .innerJoin(originalCashRecoveries,eq(originalCashRecoveries.id,originalCashRecoveryFacts.recoveryId)).where(and(eq(originalCashRecoveryFacts.kind,"refund"),
      sql`${originalCashRecoveryFacts.evidence}->>'providerRef'=${evidence.observedRefundRef}`,sql`${originalCashRecoveries.owner}->'cash'->>'chargeAccountId' is not distinct from ${evidence.observedChargeAccountId}`,
      evidence.observedPlatformAccountId ? sql`${originalCashRecoveries.owner}->'cash'->>'providerPlatformAccountId'=${evidence.observedPlatformAccountId}` : undefined)).orderBy(asc(originalCashRecoveryFacts.id)).limit(5001));
  for (const { owner, fact } of observedResources) {
    if (!verifyOriginalCashRecovery("owner",owner,recoveryOwnerBody(owner),keys) || owner.namespaceKey !== cashNamespaceKey(owner.owner.cash)
      || !verifyOriginalCashRecovery("fact",fact,recoveryFactBody(fact),keys) || fact.evidence.paymentProviderRef !== owner.owner.cash.providerRef
      || owner.paymentId !== owner.owner.cash.paymentId || owner.subscriptionChargeReceiptId !== owner.owner.cash.subscriptionChargeReceiptId) throw unresolved();
    scopes.push({ paymentId:owner.paymentId,receiptId:owner.subscriptionChargeReceiptId,platform:owner.owner.cash.providerPlatformAccountId,account:owner.owner.cash.chargeAccountId,intent:owner.owner.cash.providerRef });
  }
  const intentRefs = [...new Set([...(evidence.observedPaymentRef ? [evidence.observedPaymentRef] : []),...scopes.map(scope=>scope.intent)])];
  const positive = intentRefs.length ? bounded(await tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.status,"succeeded"),sql`${merchantPaymentObservations.amountMinor}>0`,
    inArray(merchantPaymentObservations.providerRef,intentRefs),sql`${merchantPaymentObservations.chargeAccountId} is not distinct from ${evidence.observedChargeAccountId}`,
    evidence.observedPlatformAccountId ? eq(merchantPaymentObservations.providerPlatformAccountId,evidence.observedPlatformAccountId) : undefined)).orderBy(asc(merchantPaymentObservations.id)).limit(5001)) : [];
  const receipts = intentRefs.length ? bounded(await tx.select().from(subscriptionProviderChargeReceipts).where(and(inArray(subscriptionProviderChargeReceipts.providerPaymentIntentRef,intentRefs),
    sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${evidence.observedChargeAccountId}`,
    evidence.observedPlatformAccountId ? eq(subscriptionProviderChargeReceipts.providerPlatformAccountId,evidence.observedPlatformAccountId) : undefined)).orderBy(asc(subscriptionProviderChargeReceipts.id)).limit(5001)) : [];
  for (const cash of positive) {
    if (cash.providerRef !== evidence.observedPaymentRef && !scopes.some(scope=>scope.paymentId===cash.paymentId&&scope.intent===cash.providerRef&&scope.platform===cash.providerPlatformAccountId&&scope.account===cash.chargeAccountId)) continue;
    candidates.push({paymentId:cash.paymentId,subscriptionChargeReceiptId:null,platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,paymentRef:cash.providerRef,
      kind:"payment_observation",id:cash.id,fingerprint:merchantTaxDigest(cash)});
  }
  for (const cash of receipts) {
    if (cash.providerPaymentIntentRef !== evidence.observedPaymentRef && !scopes.some(scope=>scope.receiptId===cash.id&&scope.intent===cash.providerPaymentIntentRef&&scope.platform===cash.providerPlatformAccountId&&scope.account===cash.chargeAccountId)) continue;
    candidates.push({paymentId:null,subscriptionChargeReceiptId:cash.id,platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,paymentRef:cash.providerPaymentIntentRef,
      kind:"charge_receipt",id:cash.id,fingerprint:merchantTaxDigest(cash)});
  }
  const receiptIds = receipts.map(receipt=>receipt.id), paymentIds = positive.map(cash=>cash.paymentId);
  const relatedLegacy = paymentIds.length ? bounded(await tx.select().from(refunds).where(and(eq(refunds.provider,"stripe"),inArray(refunds.paymentId,[...new Set(paymentIds)])))
    .orderBy(asc(refunds.id)).limit(5001)) : [];
  await addLegacyOwners(relatedLegacy);
  const routes = receiptIds.length || paymentIds.length ? bounded(await tx.select().from(merchantAgreementPaymentRoutes).where(or(
    receiptIds.length ? inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,receiptIds) : undefined,
    paymentIds.length ? inArray(merchantAgreementPaymentRoutes.paymentId,paymentIds) : undefined)).orderBy(asc(merchantAgreementPaymentRoutes.paymentId)).limit(5001)) : [];
  const aliases: OriginalFeedbackReceiptAlias[] = [];
  for (const route of routes) {
    const receipt = receipts.find(cash=>cash.id===route.originalChargeReceiptId);
    if (!receipt) continue;
    if (route.originKind!=="provider_schedule" || route.subscriptionId!==receipt.subscriptionId || route.providerPlatformAccountId!==receipt.providerPlatformAccountId
      || route.chargeAccountId!==receipt.chargeAccountId || route.providerPaymentIntentRef!==receipt.providerPaymentIntentRef || route.providerInvoiceRef!==receipt.providerInvoiceRef
      || route.providerSubscriptionRef!==receipt.providerSubscriptionRef || route.providerApiVersion!==receipt.providerApiVersion) throw unresolved();
    aliases.push({paymentId:route.paymentId,receiptId:receipt.id});
  }
  for(const scope of scopes) if(!positive.some(cash=>cash.paymentId===scope.paymentId&&cash.providerRef===scope.intent&&cash.providerPlatformAccountId===scope.platform&&cash.chargeAccountId===scope.account)
    &&!receipts.some(cash=>cash.id===scope.receiptId&&cash.providerPaymentIntentRef===scope.intent&&cash.providerPlatformAccountId===scope.platform&&cash.chargeAccountId===scope.account))throw unresolved();
  const owner=uniqueOriginalFeedbackOwner(candidates,aliases);
  return {...owner,namespace:{...owner.namespace,observedPlatform:evidence.observedPlatformAccountId},lineageDigest:merchantTaxDigest({owner:owner.lineageDigest,
    bindings:bindings.map(({binding,request,dispatch})=>({id:binding.id,requestId:request.id,dispatchId:dispatch?.id,requestDigest:request.requestDigest,evidenceDigest:binding.evidenceDigest})),
    observedResources:observedResources.map(({owner:cashOwner,fact})=>({ownerId:cashOwner.id,ownerDigest:cashOwner.digest,factId:fact.id,factDigest:fact.digest}))})};
}
