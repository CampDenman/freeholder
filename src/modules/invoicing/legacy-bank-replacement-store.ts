// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: authenticated original legacy lineage and bounded debt.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { moneyStateEvents, refunds } from "./schema";
import { legacyBankReads, legacyBankReadFinishes, legacyBankCurrentReceipts } from "./legacy-bank-read-schema";
import { originalLegacyBankRefund } from "./legacy-refund-dispatch";
import { legacyRefundBankState } from "./legacy-bank-current-state";
import { merchantTaxDigest } from "./merchant-tax-store";
import { LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_REASON, LEGACY_REPLACEMENT_STATE, legacyReplacementKey, verifyLegacyReplacement, type LegacyReplacementBody } from "./legacy-bank-replacement-proof";
type Refund = typeof refunds.$inferSelect;
export interface LegacyReplacementChain { root: Refund; nodes: Refund[]; links: LegacyReplacementBody[]; incomplete: boolean }
export function legacyReplacementSigningKey() { const e = env(); const key = e.CREDENTIAL_KEY ?? e.SESSION_SECRET; if (!key) throw Error("Restore the original legacy replacement signing key."); return key; }
export function verifyLegacyReplacementJournalRow(row: typeof moneyStateEvents.$inferSelect) { const e = env(); return verifyLegacyReplacement(row, [...new Set([e.CREDENTIAL_KEY, e.CREDENTIAL_KEY_PREVIOUS, e.SESSION_SECRET].filter((key): key is string => Boolean(key)))]); }
export async function assertLegacyBankRecoveryGuards(ctx: ServiceContext) {
  const [guard] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=5 ready from pg_trigger where not tgisinternal and tgenabled in ('O','A')
    and (tgrelid,tgname) in ((to_regclass('public.legacy_bank_read_stops'),'legacy_bank_read_stops_guard'),
      (to_regclass('public.legacy_bank_read_facts'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.legacy_bank_read_finishes'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.payment_provider_events'),'legacy_bank_signed_event_lock'),
      (to_regclass('public.money_state_events'),'legacy_bank_physical_event_lock'))`);
  if (!guard?.ready) throw new ServiceError("conflict", "Restore the complete original legacy recovery and signed-feedback guards before admitting or retiring a caller.");
}
export async function readLegacyReplacementChain(tx: Tx, target: Refund): Promise<LegacyReplacementChain> {
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
      || child.idempotencyKey !== legacyReplacementKey(parent.id)
      || [parent, child].some(row => row.paymentId !== root.paymentId || row.invoiceId !== root.invoiceId || row.provider !== root.provider || row.amountMinor !== root.amountMinor || row.currency !== root.currency)
      || body.amountMinor !== root.amountMinor || body.currency !== root.currency) return bad();
    try {
      const originalRoot = await originalLegacyBankRefund(tx, root), originalParent = await originalLegacyBankRefund(tx, parent);
      if (merchantTaxDigest(originalRoot) !== body.rootOriginalDigest || merchantTaxDigest(originalParent) !== body.parentOriginalDigest
        || originalRoot.originalPaymentRef !== body.originalPaymentRef || originalParent.originalPaymentRef !== body.originalPaymentRef
        || originalRoot.originalChargeAccountId !== body.originalChargeAccountId || originalParent.originalChargeAccountId !== body.originalChargeAccountId) return bad();
    } catch (error) { if (!(error instanceof ServiceError)) throw error; return bad(); }
    incoming.set(child.id, body); outgoing.set(parent.id, body);
  }
  if (rows.some(row => row.idempotencyKey.startsWith("legacy-bank-replacement:") && !incoming.has(row.id))) return bad();
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
  return { states, terminalReads, review, overReturned, returnedMinor: returned > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(returned),
    fulfilled: !review && returned === BigInt(chain.root.amountMinor) && states.every(row => row.state === "returned" || row.state === "failed"),
    canReplace: !review && returned === 0n && terminalReads.length === states.length && states.length > 0 };
}
export async function legacyBankPromiseState(ctx: ServiceContext, refund: Refund) {
  const chain = await readLegacyReplacementChain(ctx.tx, refund), state = await legacyReplacementFinancialState(ctx, chain);
  return { chain, ...state, canReplace: state.canReplace && chain.root.id === refund.id,
    replaced: chain.links.length > 0 && state.fulfilled && state.states.find(row => row.state === "returned")?.refund.id !== refund.id, owed: !state.fulfilled };
}
/** SQL settings are a compatibility ABI. This service proof checks every
 * actual affected original promise and authenticated chain before setting it. */
export async function legacyBankReplacementCapacity(ctx: ServiceContext, paymentId: string, key?: string, refundId?: string) {
  await assertLegacyBankRecoveryGuards(ctx);
  const [grant] = await ctx.tx.execute<{ parent: string | null }>(sql`select nullif(current_setting('freeholder.legacy_bank_replacement_parent',true),'') parent`);
  const rows = await ctx.tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).limit(5001);
  const readRows = await ctx.tx.select({ refundId: legacyBankReads.refundId }).from(legacyBankReads).innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId)).where(eq(refunds.paymentId, paymentId)).limit(5001);
  if (rows.length > 5000 || readRows.length > 5000) return false;
  const reservedKey = key?.startsWith("legacy-bank-replacement:") === true;
  const target = refundId ? rows.find(row => row.id === refundId) : grant?.parent ? rows.find(row => row.id === grant.parent) : undefined;
  let authorizedTarget = !reservedKey; const checked = new Set<string>();
  for (const id of [...new Set(readRows.map(row => row.refundId))]) {
    const refund = rows.find(row => row.id === id); if (!refund) return false;
    const chain = await readLegacyReplacementChain(ctx.tx, refund); if (chain.incomplete) return false;
    if (checked.has(chain.root.id)) continue; checked.add(chain.root.id);
    const state = await legacyReplacementFinancialState(ctx, chain);
    if (reservedKey && target && chain.nodes.some(node => node.id === target.id)) {
      if (refundId) {
        const leaf = chain.nodes.at(-1)!;
        if (leaf.id !== refundId || leaf.idempotencyKey !== key || !chain.links.length || state.review || state.returnedMinor !== 0
          || state.states.at(-1)?.state !== "unsubmitted" || state.states.slice(0, -1).some(row => row.state !== "failed")) return false;
      } else if (chain.nodes.at(-1)!.id !== grant?.parent || key !== legacyReplacementKey(grant.parent) || !state.canReplace) return false;
      authorizedTarget = true;
    } else if (!state.fulfilled) return false;
  }
  if (!authorizedTarget) return false;
  await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_capacity_payment',${paymentId},true)`);
  return true;
}

/** The replacement uses today's caller to reach the exact authentic original
 * payment/account. A changed current routing setting cannot rebind that cash. */
export async function assertLegacyReplacementOriginalScope(ctx: ServiceContext, refund: Refund, paymentRef: string | null, accountId: string | null, platformId: string | null) {
  if (!refund.idempotencyKey.startsWith("legacy-bank-replacement:")) return;
  const chain = await readLegacyReplacementChain(ctx.tx, refund);
  if (chain.incomplete || !chain.links.length || chain.nodes.at(-1)?.id !== refund.id) throw new ServiceError("conflict", "Restore this exact original legacy causal chain before physical admission.");
  const original = await originalLegacyBankRefund(ctx.tx, chain.root);
  if (platformId || original.originalPaymentRef !== paymentRef || original.originalChargeAccountId !== accountId) throw new ServiceError("conflict", "Restore the authentic original legacy payment/account scope; today's route cannot replace it.");
}
