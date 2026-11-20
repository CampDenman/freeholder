// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: authenticated original legacy lineage and bounded debt.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { getService, ServiceError, type ServiceContext } from "@/core/service";
import { moneyStateEvents, payments, refunds } from "./schema";
import { legacyBankReads, legacyBankReadFinishes, legacyBankCurrentReceipts } from "./legacy-bank-read-schema";
import { originalLegacyBankRefund } from "./legacy-refund-dispatch";
import { legacyRefundBankState } from "./legacy-bank-current-state";
import { legacyReturnBankOwnerResult } from "./legacy-bank-return-contract";
import { merchantTaxDigest } from "./merchant-tax-store";
import { LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_REASON, LEGACY_REPLACEMENT_STATE, legacyReplacementKey, isLegacyReplacementKey, verifyLegacyReplacement, type LegacyReplacementBody } from "./legacy-bank-replacement-proof";
type Refund = typeof refunds.$inferSelect;
export interface LegacyReplacementChain { root: Refund; nodes: Refund[]; links: LegacyReplacementBody[]; incomplete: boolean }
export function legacyReplacementSigningKey() { const e = env(); const key = e.CREDENTIAL_KEY ?? e.SESSION_SECRET; if (!key) throw Error("Restore the original legacy replacement signing key."); return key; }
export function verifyLegacyReplacementJournalRow(row: typeof moneyStateEvents.$inferSelect) { const e = env(); return verifyLegacyReplacement(row, [...new Set([e.CREDENTIAL_KEY, e.CREDENTIAL_KEY_PREVIOUS, e.SESSION_SECRET].filter((key): key is string => Boolean(key)))]); }
export async function assertLegacyBankRecoveryGuards(ctx: ServiceContext) {
  const [guard] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=6 and to_regprocedure('public.freeholder_legacy_bank_feedback_review(uuid)') is not null ready from pg_trigger where not tgisinternal and tgenabled in ('O','A')
    and (tgrelid,tgname) in ((to_regclass('public.legacy_bank_read_stops'),'legacy_bank_read_stops_guard'),
      (to_regclass('public.legacy_bank_read_facts'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.legacy_bank_read_finishes'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.payment_provider_events'),'legacy_bank_signed_event_lock'),
      (to_regclass('public.money_state_events'),'legacy_bank_physical_event_lock'),
      (to_regclass('public.legacy_bank_feedback'),'legacy_bank_feedback_guard'))`);
  if (!guard?.ready) throw new ServiceError("conflict", "Restore the complete original legacy recovery and signed-feedback guards before admitting or retiring a caller.");
}
export async function legacyBankReturnOwner(ctx: ServiceContext, refundId: string) {
  const [bound] = await ctx.tx.execute<{ prepared: boolean }>(sql`select freeholder_refund_is_prepared_return(${refundId}::uuid) prepared`);
  if (!bound?.prepared) {
    const [refund] = await ctx.tx.select({ key: refunds.idempotencyKey }).from(refunds).where(eq(refunds.id, refundId));
    if (refund?.key.startsWith("return:")) throw new ServiceError("conflict", "Restore the actual original return allocation before legacy replacement; an old return key cannot manufacture its missing owner.");
    return { owner: null, refundIds: [], cashRefundIds: [], confirmedRefundIds: [], unresolvedRefundIds: [], allocationMinor: 0, allCurrent: false, confirmedMinor: 0, partFulfilled: false, needsReview: true };
  }
  const source = legacyReturnBankOwnerResult.parse(await ctx.callAsSystem(getService("catalog.legacyReturnBankRefundOwner"), { refundId }));
  if (!source.owner) throw new ServiceError("conflict", "Restore the original prepared return's actual allocation and issued credit; never infer its owner from an equal refund.");
  return source;
}
export async function readLegacyReplacementChain(ctx: ServiceContext, target: Refund): Promise<LegacyReplacementChain> {
  const tx = ctx.tx;
  const bad = (): LegacyReplacementChain => ({ root: target, nodes: [target], links: [], incomplete: true });
  const rows = await tx.select().from(refunds).where(eq(refunds.paymentId, target.paymentId)).limit(5001);
  if (rows.length > 5000) return bad();
  const ids = new Map(rows.map(row => [row.id, row]));
  const journal = rows.length ? await tx.select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType, "refund"), inArray(moneyStateEvents.subjectId, rows.map(row => row.id)),
    or(eq(moneyStateEvents.reason, LEGACY_REPLACEMENT_REASON), eq(moneyStateEvents.toState, LEGACY_REPLACEMENT_STATE), sql`${moneyStateEvents.metadata}->>'protocol'=${LEGACY_REPLACEMENT_PROTOCOL}`))).limit(5001) : [];
  if (rows.length + journal.length > 5000) return bad();
  const incoming = new Map<string, LegacyReplacementBody>(), outgoing = new Map<string, LegacyReplacementBody>();
  for (const entry of journal) {
    const body = verifyLegacyReplacementJournalRow(entry), root = body && ids.get(body.rootRefundId), parent = body && ids.get(body.parentRefundId), child = body && ids.get(body.replacementRefundId);
    if (!body || !root || !parent || !child || outgoing.has(parent.id) || incoming.has(child.id)
      || body.paymentId !== target.paymentId || body.invoiceId !== root.invoiceId || body.replacementRequestHash !== child.requestHash
      || child.idempotencyKey !== legacyReplacementKey(parent.id, body.returnPart)
      || [parent, child].some(row => row.paymentId !== root.paymentId || row.invoiceId !== root.invoiceId || row.provider !== root.provider || row.amountMinor !== root.amountMinor || row.currency !== root.currency)
      || body.amountMinor !== root.amountMinor || body.currency !== root.currency) return bad();
    try {
      const [rootOwner, parentOwner, childOwner] = await Promise.all([legacyBankReturnOwner(ctx, root.id), legacyBankReturnOwner(ctx, parent.id), legacyBankReturnOwner(ctx, child.id)]);
      if ([rootOwner, parentOwner, childOwner].some(source => merchantTaxDigest(source.owner) !== merchantTaxDigest(body.returnPart ?? null))) return bad();
      const originalRoot = await originalLegacyBankRefund(tx, root), originalParent = await originalLegacyBankRefund(tx, parent);
      if (merchantTaxDigest(originalRoot) !== body.rootOriginalDigest || merchantTaxDigest(originalParent) !== body.parentOriginalDigest
        || originalRoot.originalPaymentRef !== body.originalPaymentRef || originalParent.originalPaymentRef !== body.originalPaymentRef
        || originalRoot.originalChargeAccountId !== body.originalChargeAccountId || originalParent.originalChargeAccountId !== body.originalChargeAccountId) return bad();
    } catch (error) { if (!(error instanceof ServiceError)) throw error; return bad(); }
    incoming.set(child.id, body); outgoing.set(parent.id, body);
  }
  if (rows.some(row => isLegacyReplacementKey(row.idempotencyKey) && !incoming.has(row.id))) return bad();
  let root = target; const seen = new Set<string>();
  while (incoming.has(root.id)) { if (seen.has(root.id)) return bad(); seen.add(root.id); root = ids.get(incoming.get(root.id)!.parentRefundId)!; }
  const nodes = [root], links: LegacyReplacementBody[] = []; seen.clear(); let count = rows.length + journal.length;
  while (outgoing.has(nodes.at(-1)!.id)) {
    const parent = nodes.at(-1)!, body = outgoing.get(parent.id)!;
    if (seen.has(parent.id) || body.rootRefundId !== root.id || body.terminalReads.length !== nodes.length
      || new Set(body.terminalReads.map(read => read.refundId)).size !== nodes.length || nodes.some(node => !body.terminalReads.some(read => read.refundId === node.id))) return bad();
    seen.add(parent.id); count += body.terminalReads.length; if (count > 5000) return bad();
    for (const promised of body.terminalReads) {
      const [actual] = await tx.select({ receipt: legacyBankCurrentReceipts, read: legacyBankReads, finish: legacyBankReadFinishes }).from(legacyBankCurrentReceipts)
        .innerJoin(legacyBankReads, eq(legacyBankReads.id, legacyBankCurrentReceipts.readId)).innerJoin(legacyBankReadFinishes, eq(legacyBankReadFinishes.readId, legacyBankReads.id))
        .where(eq(legacyBankCurrentReceipts.id, promised.receiptId));
      const refund = ids.get(promised.refundId);
      if (!actual || !refund || actual.receipt.refundId !== refund.id || actual.read.refundId !== refund.id || actual.receipt.resolvedRevision !== promised.resolvedRevision
        || !actual.receipt.replacementEligible || !["failed", "canceled"].includes(actual.receipt.status ?? "unknown")
        || actual.finish.outcome !== "returned" || actual.finish.callerInstanceId !== actual.read.caller.id || merchantTaxDigest(actual.read.original) !== actual.read.originalDigest) return bad();
      try { if (merchantTaxDigest(await originalLegacyBankRefund(tx, refund)) !== actual.read.originalDigest) return bad(); }
      catch (error) { if (!(error instanceof ServiceError)) throw error; return bad(); }
    }
    links.push(body); nodes.push(ids.get(body.replacementRefundId)!);
  }
  return nodes.some(node => node.id === target.id) ? { root, nodes, links, incomplete: false } : bad();
}
export async function legacyReplacementFinancialState(ctx: ServiceContext, chain: LegacyReplacementChain) {
  const states: Array<{ refund: Refund; state: "returned" | "failed" | "unsubmitted" | "pending" }> = [];
  const terminalReads: LegacyReplacementBody["terminalReads"] = []; let returned = 0n, review = chain.incomplete;
  for (const refund of chain.nodes) {
    const current = await legacyRefundBankState(ctx, refund.id); let state: "returned" | "failed" | "unsubmitted" | "pending" = "pending";
    if (current.verified && current.status === "succeeded") {
      returned += BigInt(refund.amountMinor); if (!current.requiresReview && refund.status === "succeeded") state = "returned";
    } else if (current.verified && (current.status === "failed" || current.status === "canceled") && current.replacementEligible && refund.status === "failed") {
      const [receipt] = await ctx.tx.select().from(legacyBankCurrentReceipts).where(eq(legacyBankCurrentReceipts.id, current.receiptId!));
      if (receipt) { state = "failed"; terminalReads.push({ refundId: refund.id, receiptId: receipt.id, resolvedRevision: receipt.resolvedRevision }); }
    } else if (!refund.providerRef && refund.status === "created" && !current.hasRead) state = "unsubmitted";
    if (state === "pending") review = true; states.push({ refund, state });
  }
  const overReturned = returned > BigInt(chain.root.amountMinor); review ||= overReturned;
  let fulfilled = !review && returned === BigInt(chain.root.amountMinor) && states.every(row => row.state === "returned" || row.state === "failed");
  let fulfilledRefundId = fulfilled ? states.find(row => row.state === "returned")?.refund.id ?? null : null;
  try {
    const source = await legacyBankReturnOwner(ctx, chain.root.id);
    const resumableLeaf = chain.links.length && states.at(-1)?.state === "unsubmitted" ? states.at(-1)!.refund.id : null;
    if (source.owner && (source.confirmedMinor > source.allocationMinor || source.unresolvedRefundIds.some(id => id !== resumableLeaf))) { review = true; fulfilled = false; }
    if (source.owner && source.partFulfilled && !chain.incomplete && !overReturned) { fulfilled = true; review = false; fulfilledRefundId ??= source.confirmedRefundIds[0] ?? null; }
  } catch (error) { if (!(error instanceof ServiceError)) throw error; review = true; fulfilled = false; }
  return { states, terminalReads, review, overReturned, fulfilled, fulfilledRefundId, returnedMinor: returned > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(returned),
    canReplace: !fulfilled && !review && returned === 0n && terminalReads.length === states.length && states.length > 0 };
}
export async function legacyBankPromiseState(ctx: ServiceContext, refund: Refund) {
  const chain = await readLegacyReplacementChain(ctx, refund), state = await legacyReplacementFinancialState(ctx, chain);
  try { await legacyBankReturnOwner(ctx, chain.root.id); }
  catch (error) { if (!(error instanceof ServiceError)) throw error; state.review = true; state.fulfilled = false; state.canReplace = false; }
  const canResume = chain.links.length > 0 && !state.review && !state.fulfilled && state.returnedMinor === 0
    && state.states.at(-1)?.state === "unsubmitted" && state.states.slice(0, -1).every(row => row.state === "failed");
  return { chain, ...state, canReplace: (state.canReplace || canResume) && chain.root.id === refund.id,
    replaced: chain.links.length > 0 && state.fulfilled && state.fulfilledRefundId !== refund.id, owed: !state.fulfilled };
}
/** SQL settings are a compatibility ABI. This service proof checks every
 * actual affected original promise and authenticated chain before setting it. */
export function legacyReplacementBudgetAllows(active: readonly number[], owed: readonly number[], newMinor: number, paidMinor: number) {
  const values = [...active, ...owed, newMinor, paidMinor];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) return false;
  return [...active, ...owed, newMinor].reduce((sum, value) => sum + BigInt(value), 0n) <= BigInt(paidMinor);
}
export async function legacyBankReplacementCapacity(ctx: ServiceContext, paymentId: string, key?: string, refundId?: string) {
  await assertLegacyBankRecoveryGuards(ctx);
  const [grant] = await ctx.tx.execute<{ parent: string | null }>(sql`select nullif(current_setting('freeholder.legacy_bank_replacement_parent',true),'') parent`);
  const rows = await ctx.tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).limit(5001);
  const readRows = await ctx.tx.select({ refundId: legacyBankReads.refundId }).from(legacyBankReads).innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId)).where(eq(refunds.paymentId, paymentId)).limit(5001);
  const feedback = await ctx.tx.execute<{ refund_id: string }>(sql`select r.id refund_id from refunds r where r.payment_id=${paymentId}::uuid and freeholder_legacy_bank_feedback_review(r.id) limit 5001`);
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment || rows.length > 5000 || readRows.length + feedback.length > 5000) return false;
  const reservedKey = key !== undefined && isLegacyReplacementKey(key);
  const target = refundId ? rows.find(row => row.id === refundId) : grant?.parent ? rows.find(row => row.id === grant.parent) : undefined;
  let authorizedTarget = !reservedKey, newMinor = 0, targetPart: string | null = null;
  const checked = new Set<string>(), owed: number[] = [], returnParts = new Map<string, { allocationMinor: number; refundIds: string[] }>();
  for (const id of [...new Set([...readRows.map(row => row.refundId), ...feedback.map(row => row.refund_id)])]) {
    const refund = rows.find(row => row.id === id); if (!refund) return false;
    const chain = await readLegacyReplacementChain(ctx, refund); if (chain.incomplete) return false;
    if (checked.has(chain.root.id)) continue; checked.add(chain.root.id);
    const state = await legacyReplacementFinancialState(ctx, chain);
    const ownership = await legacyBankReturnOwner(ctx, chain.root.id);
    const partKey = ownership.owner ? `${ownership.owner.returnId}:${ownership.owner.allocationId}:${ownership.owner.creditNoteId}` : null;
    if (partKey && !state.fulfilled) {
      const prior = returnParts.get(partKey);
      if (prior && (prior.allocationMinor !== ownership.allocationMinor || merchantTaxDigest(prior.refundIds) !== merchantTaxDigest(ownership.refundIds))) return false;
      returnParts.set(partKey, { allocationMinor: ownership.allocationMinor, refundIds: ownership.refundIds });
    }
    if (reservedKey && target && chain.nodes.some(node => node.id === target.id)) {
      if (refundId) {
        const leaf = chain.nodes.at(-1)!;
        if (leaf.id !== refundId || leaf.idempotencyKey !== key || !chain.links.length || state.review || state.returnedMinor !== 0
          || state.states.at(-1)?.state !== "unsubmitted" || state.states.slice(0, -1).some(row => row.state !== "failed")) return false;
      } else {
        if (chain.nodes.at(-1)!.id !== grant?.parent || key !== legacyReplacementKey(grant.parent, (await legacyBankReturnOwner(ctx, chain.root.id)).owner) || !state.canReplace) return false;
        newMinor = chain.root.amountMinor;
      }
      authorizedTarget = true; targetPart = partKey;
    } else if (!state.fulfilled) {
      if (!reservedKey || state.review) return false;
      if (state.canReplace) { if (!partKey) owed.push(chain.root.amountMinor); }
      else if (!chain.links.length || state.returnedMinor !== 0 || state.states.at(-1)?.state !== "unsubmitted" || state.states.slice(0, -1).some(row => row.state !== "failed")) return false;
      // A signed, actually unsubmitted child already holds this whole promise
      // in active reservations. It is not counted a second time as owed cash.
    }
  }
  // Historical failed attempts of the same frozen return allocation are one
  // business promise. Identity, never equal amounts, groups that obligation.
  // Every actual active reservation/positive cash row remains in the payment
  // budget; only the uncovered remainder of each original part is added.
  for (const [partKey, part] of returnParts) {
    const active = rows.filter(row => part.refundIds.includes(row.id) && ["created", "processing", "succeeded"].includes(row.status)).map(row => row.amountMinor);
    const covered = active.reduce((sum, amount) => sum + BigInt(amount), 0n) + BigInt(partKey === targetPart ? newMinor : 0);
    const remaining = BigInt(part.allocationMinor) - covered;
    if (remaining > 0n) owed.push(Number(remaining));
  }
  if (!authorizedTarget || !legacyReplacementBudgetAllows(rows.filter(row => ["created", "processing", "succeeded"].includes(row.status)).map(row => row.amountMinor), owed, newMinor, payment.amountMinor)) return false;
  await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_capacity_payment',${paymentId},true)`);
  return true;
}

/** The replacement uses today's caller to reach the exact authentic original
 * payment/account. A changed current routing setting cannot rebind that cash. */
export async function assertLegacyReplacementOriginalScope(ctx: ServiceContext, refund: Refund, paymentRef: string | null, accountId: string | null, platformId: string | null) {
  if (!isLegacyReplacementKey(refund.idempotencyKey)) return;
  const chain = await readLegacyReplacementChain(ctx, refund);
  if (chain.incomplete || !chain.links.length || chain.nodes.at(-1)?.id !== refund.id) throw new ServiceError("conflict", "Restore this exact original legacy causal chain before physical admission.");
  const original = await originalLegacyBankRefund(ctx.tx, chain.root);
  if (platformId || original.originalPaymentRef !== paymentRef || original.originalChargeAccountId !== accountId) throw new ServiceError("conflict", "Restore the authentic original legacy payment/account scope; today's route cannot replace it.");
}

export async function legacyBankInspectionRefundIds(ctx: ServiceContext, chain: LegacyReplacementChain) {
  const ownership = await legacyBankReturnOwner(ctx, chain.root.id);
  const participated = await ctx.tx.select({ id: refunds.id }).from(legacyBankReads).innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId)).where(eq(refunds.paymentId, chain.root.paymentId)).limit(5001);
  const feedback = await ctx.tx.execute<{ id: string }>(sql`select id from refunds where payment_id=${chain.root.paymentId}::uuid and freeholder_legacy_bank_feedback_review(id) limit 5001`);
  const ids = [...new Set([...chain.nodes.map(row => row.id), ...participated.map(row => row.id), ...feedback.map(row => row.id), ...ownership.cashRefundIds])].sort();
  if (participated.length > 5000 || ids.length > 5000) throw new ServiceError("conflict", "Restore the complete bounded original cash and return-part resource inventory before reconciliation.");
  const actual = ids.length ? await ctx.tx.select().from(refunds).where(inArray(refunds.id, ids)).limit(5001) : [];
  if (actual.length !== ids.length || actual.some(row => row.paymentId !== chain.root.paymentId || row.invoiceId !== chain.root.invoiceId || row.provider !== chain.root.provider)) throw new ServiceError("conflict", "Restore every exact original refund's real payment and invoice owner before cash inspection.");
  return actual.filter(row => row.providerRef).sort((a, b) => a.id.localeCompare(b.id)).map(row => row.id);
}
