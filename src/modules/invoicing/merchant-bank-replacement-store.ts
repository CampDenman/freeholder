// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { createHash } from "node:crypto";
import { merchantTaxDigest } from "./merchant-tax-store";
import { moneyStateEvents, refunds } from "./schema";
import { merchantRefundRequests, merchantRefundReservationRetirements, merchantRefundDispatches } from "./merchant-refund-schema";
import { merchantRefundCurrentReceipts, merchantRefundStateReads, merchantRefundStateReadFinishes, merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { merchantRefundObservations, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { originalMerchantRefundCurrentStates } from "./merchant-refund-current-state";
import { BANK_REPLACEMENT_PROTOCOL, BANK_REPLACEMENT_REASON, BANK_REPLACEMENT_STATE, bankReplacementKey, bankReplacementReason,
  verifyBankReplacement, type BankReplacementBody } from "./merchant-bank-replacement-proof";
type Request = typeof merchantRefundRequests.$inferSelect;
const MAX = 5000;
export function bankReplacementSigningKey(): string {
  const configured = env(), key = configured.CREDENTIAL_KEY ?? configured.SESSION_SECRET;
  if (!key) throw new Error("Restore the bank-replacement evidence key before changing money.");
  return key;
}
export function verifyBankReplacementJournalRow(row: typeof moneyStateEvents.$inferSelect): BankReplacementBody | null {
  const configured = env();
  return verifyBankReplacement(row, [...new Set([configured.CREDENTIAL_KEY, configured.CREDENTIAL_KEY_PREVIOUS, configured.SESSION_SECRET].filter((key): key is string => Boolean(key)))]);
}
function sameCash(a: Request, b: Request): boolean {
  return a.purpose === "invoice_refund" && b.purpose === a.purpose && a.paymentId === b.paymentId
    && a.providerPlatformAccountId === b.providerPlatformAccountId && a.chargeAccountId === b.chargeAccountId
    && a.originalPaymentRef === b.originalPaymentRef && a.originalCashAmountMinor === b.originalCashAmountMinor
    && a.amountMinor === b.amountMinor && a.currency === b.currency && a.providerApiVersion === b.providerApiVersion;
}
export interface BankReplacementChain { root: Request; nodes: Request[]; links: BankReplacementBody[]; incomplete: boolean }

/** Current/previous keys verify old causal evidence; no missing record is an
 * unsubmitted/negative proof. Existing immutable child keys expose a pruned or
 * corrupted journal instead of authorizing a newly signed historical link. */
export async function readBankReplacementChain(tx: Tx, target: Request): Promise<BankReplacementChain> {
  const bad = (): BankReplacementChain => ({ root: target, nodes: [target], links: [], incomplete: true });
  const requests = await tx.select().from(merchantRefundRequests).where(and(eq(merchantRefundRequests.providerPlatformAccountId, target.providerPlatformAccountId),
    sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${target.chargeAccountId}`, eq(merchantRefundRequests.originalPaymentRef, target.originalPaymentRef))).limit(MAX + 1);
  if (requests.length > MAX) return bad();
  if (requests.some(request => merchantTaxDigest(request.originalRequest) !== request.requestDigest)) return bad();
  const ids = new Map(requests.map(row => [row.id, row])), refundIds = requests.flatMap(row => row.refundId ? [row.refundId] : []);
  const rows = refundIds.length ? await tx.select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType, "refund"), inArray(moneyStateEvents.subjectId, refundIds),
    or(eq(moneyStateEvents.reason, BANK_REPLACEMENT_REASON), eq(moneyStateEvents.toState, BANK_REPLACEMENT_STATE), sql`${moneyStateEvents.metadata}->>'protocol'=${BANK_REPLACEMENT_PROTOCOL}`))).limit(MAX + 1) : [];
  if (rows.length + requests.length > MAX) return bad();
  const outgoing = new Map<string, BankReplacementBody>(), incoming = new Map<string, BankReplacementBody>();
  for (const row of rows) {
    const body = verifyBankReplacementJournalRow(row);
    const root = body && ids.get(body.rootRequestId), parent = body && ids.get(body.parentRequestId), child = body && ids.get(body.replacementRequestId);
    if (!body || !root || !parent || !child || !sameCash(root, parent) || !sameCash(root, child)
      || root.requestDigest !== body.rootRequestDigest || parent.requestDigest !== body.parentRequestDigest || child.requestDigest !== body.replacementRequestDigest
      || parent.refundId !== body.parentRefundId || child.refundId !== body.replacementRefundId || parent.paymentId !== body.paymentId
      || parent.providerPlatformAccountId !== body.providerPlatformAccountId || parent.chargeAccountId !== body.chargeAccountId
      || parent.originalPaymentRef !== body.originalPaymentRef || parent.amountMinor !== body.amountMinor || parent.currency !== body.currency
      || child.idempotencyKey !== bankReplacementKey(parent.id) || child.reasonDigest !== merchantTaxDigest(bankReplacementReason(parent.id))
      || outgoing.has(parent.id) || incoming.has(child.id)) return bad();
    outgoing.set(parent.id, body); incoming.set(child.id, body);
  }
  for (const request of requests) {
    if (request.idempotencyKey.startsWith("bank-replacement:") && !incoming.has(request.id)) return bad();
  }
  let root = target;
  const seen = new Set<string>();
  while (incoming.has(root.id)) {
    if (seen.has(root.id)) return bad(); seen.add(root.id);
    root = ids.get(incoming.get(root.id)!.parentRequestId)!;
  }
  const nodes = [root], links: BankReplacementBody[] = []; seen.clear();
  let evidenceCount = rows.length + requests.length;
  while (outgoing.has(nodes.at(-1)!.id)) {
    const parent = nodes.at(-1)!;
    if (seen.has(parent.id)) return bad(); seen.add(parent.id);
    const body = outgoing.get(parent.id)!;
    evidenceCount += body.terminalReads.length + body.retiredRequestIds.length;
    if (evidenceCount > MAX) return bad();
    if (body.rootRequestId !== root.id || body.terminalReads.length + body.retiredRequestIds.length !== nodes.length
      || new Set([...body.terminalReads.map(read => read.requestId), ...body.retiredRequestIds]).size !== nodes.length
      || nodes.some(node => !body.terminalReads.some(read => read.requestId === node.id) && !body.retiredRequestIds.includes(node.id))) return bad();
    const historical = await historicalAuthorization(tx, body, ids);
    if (!historical) return bad();
    links.push(body); nodes.push(ids.get(body.replacementRequestId)!);
    if (nodes.length > MAX) return bad();
  }
  return nodes.some(node => node.id === target.id) ? { root, nodes, links, incomplete: false } : bad();
}

async function historicalAuthorization(tx: Tx, body: BankReplacementBody, requests: Map<string, Request>): Promise<boolean> {
  for (const read of body.terminalReads) {
    const request = requests.get(read.requestId);
    const [evidence] = await tx.select({ receipt: merchantRefundCurrentReceipts, read: merchantRefundStateReads, finish: merchantRefundStateReadFinishes,
      captured: merchantRefundObservationCaptures, observation: merchantRefundObservations, binding: merchantRefundResourceBindings })
      .from(merchantRefundCurrentReceipts).innerJoin(merchantRefundStateReads, eq(merchantRefundStateReads.id, merchantRefundCurrentReceipts.readId))
      .innerJoin(merchantRefundStateReadFinishes, eq(merchantRefundStateReadFinishes.readId, merchantRefundStateReads.id))
      .innerJoin(merchantRefundObservationCaptures, eq(merchantRefundObservationCaptures.id, merchantRefundCurrentReceipts.captureId))
      .innerJoin(merchantRefundObservations, eq(merchantRefundObservations.id, merchantRefundObservationCaptures.observationId))
      .innerJoin(merchantRefundResourceBindings, eq(merchantRefundResourceBindings.id, merchantRefundStateReads.resourceBindingId))
      .where(eq(merchantRefundCurrentReceipts.id, read.receiptId));
    if (!request || !evidence || evidence.receipt.requestId !== request.id || evidence.receipt.resolvedRevision !== read.resolvedRevision
      || evidence.read.requestId !== request.id || evidence.read.requestDigest !== request.requestDigest
      || evidence.finish.outcome !== "returned" || evidence.finish.callerInstanceId !== evidence.read.caller.id
      || evidence.finish.captureId !== evidence.captured.id || evidence.binding.requestId !== request.id
      || evidence.captured.captureKey !== createHash("sha256").update(`refund-state-read:${evidence.read.id}`).digest("hex")
      || evidence.observation.requestId !== request.id || !evidence.observation.bindingVerified
      || !["failed", "canceled"].includes(evidence.observation.status ?? "unknown")
      || evidence.observation.providerRef !== evidence.binding.providerRef || evidence.observation.providerPlatformAccountId !== request.providerPlatformAccountId
      || evidence.observation.chargeAccountId !== request.chargeAccountId || evidence.observation.paymentProviderRef !== request.originalPaymentRef
      || evidence.observation.providerApiVersion !== request.providerApiVersion || evidence.observation.amountMinor !== request.amountMinor || evidence.observation.currency !== request.currency) return false;
  }
  for (const id of body.retiredRequestIds) {
    const request = requests.get(id);
    const [retired] = await tx.select().from(merchantRefundReservationRetirements).where(eq(merchantRefundReservationRetirements.requestId, id));
    const [dispatch] = await tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, id)).limit(1);
    if (!request || !retired || retired.requestDigest !== request.requestDigest || dispatch) return false;
  }
  return true;
}

export async function bankReplacementFinancialState(ctx: ServiceContext, chain: BankReplacementChain) {
  const result = { fulfilled: false, review: chain.incomplete, overReturned: false, returnedMinor: 0 as number | null, states: [] as Array<{ request: Request; state: "returned" | "failed" | "retired" | "unsubmitted" | "pending" }>,
    terminalReads: [] as BankReplacementBody["terminalReads"], retiredRequestIds: [] as string[] };
  if (chain.incomplete) return result;
  const ids = chain.nodes.map(node => node.id), current = await originalMerchantRefundCurrentStates(ctx, ids);
  if (current.unresolvedRequestIds.length) result.review = true;
  let returned = 0n;
  for (const request of chain.nodes) {
    const [refund] = request.refundId ? await ctx.tx.select().from(refunds).where(eq(refunds.id, request.refundId)) : [];
    const [safe] = await ctx.tx.execute<{ success: boolean; failed: boolean; callers: boolean }>(sql`select
      freeholder_original_refund_resolved(${request.id}::uuid,'succeeded',${refund?.providerRef ?? null}) as success,
      freeholder_original_refund_resolved(${request.id}::uuid,'failed') as failed,
      freeholder_refund_current_creators_quiesced(${request.id}::uuid) as callers`);
    const [dispatch] = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, request.id)).limit(1);
    const [retired] = await ctx.tx.select().from(merchantRefundReservationRetirements).where(eq(merchantRefundReservationRetirements.requestId, request.id));
    const state = current.states.find(row => row.requestId === request.id);
    let outcome: "returned" | "failed" | "retired" | "unsubmitted" | "pending" = "pending";
    if (safe?.success === true) {
      returned += BigInt(request.amountMinor);
      if (refund?.status === "succeeded" && safe.callers === true) outcome = "returned";
    } else if (safe?.failed === true && safe.callers === true && state && ["failed", "canceled"].includes(state.status ?? "unknown") && refund?.status === "failed") {
      outcome = "failed";
      const [receipt] = await ctx.tx.select().from(merchantRefundCurrentReceipts).where(eq(merchantRefundCurrentReceipts.id, state.receiptId));
      if (!receipt) result.review = true;
      else result.terminalReads.push({ requestId: request.id, receiptId: receipt.id, resolvedRevision: receipt.resolvedRevision });
    } else if (retired?.requestDigest === request.requestDigest && !dispatch && refund?.status === "cancelled") {
      outcome = "retired"; result.retiredRequestIds.push(request.id);
    } else if (!dispatch && refund?.status === "created" && !retired) outcome = "unsubmitted";
    if (outcome === "pending" || !refund) result.review = true;
    result.states.push({ request, state: outcome });
  }
  result.overReturned = returned > BigInt(chain.root.amountMinor);
  result.returnedMinor = returned <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(returned) : null;
  result.fulfilled = returned === BigInt(chain.root.amountMinor) && !result.review && result.states.every(row => ["returned", "failed", "retired"].includes(row.state));
  result.review ||= result.overReturned;
  return result;
}

/** Called inside the existing original-cash admission lock. A reserved key
 * supplied to an ordinary API cannot impersonate a signed causal receipt. */
export async function assertBankReplacementDispatch(ctx: ServiceContext, request: Request): Promise<void> {
  if (!request.idempotencyKey.startsWith("bank-replacement:")) return;
  const chain = await readBankReplacementChain(ctx.tx, request);
  const state = await bankReplacementFinancialState(ctx, chain);
  const index = chain.nodes.findIndex(row => row.id === request.id);
  if (chain.incomplete || state.review || index !== chain.nodes.length - 1 || index < 1
    || state.states[index]?.state !== "unsubmitted"
    || state.states.slice(0, index).some(row => row.state !== "failed" && row.state !== "retired")) {
    throw new ServiceError("conflict", "Restore this exact replacement chain and current failed original refunds before any new physical request.");
  }
}

export async function bankReplacementPromiseState(ctx: ServiceContext, request: Request) {
  const chain = await readBankReplacementChain(ctx.tx, request);
  if (chain.incomplete) return { hasChain: true, fulfilled: false, review: true, returnedMinor: null, fulfilledRequestId: null, canReplace: false, rootRequestId: null };
  if (!chain.links.length) return { hasChain: false, fulfilled: false, review: false, returnedMinor: 0, fulfilledRequestId: null, canReplace: false, rootRequestId: request.id };
  const state = await bankReplacementFinancialState(ctx, chain);
  return { hasChain: true, fulfilled: state.fulfilled, review: state.review || !state.fulfilled, returnedMinor: state.returnedMinor,
    fulfilledRequestId: state.fulfilled ? state.states.find(row => row.state === "returned")?.request.id ?? null : null,
    canReplace: !state.review && state.returnedMinor === 0 && state.terminalReads.length > 0 && state.states.every(row => row.state === "failed" || row.state === "retired"), rootRequestId: chain.root.id };
}
