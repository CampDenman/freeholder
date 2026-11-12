// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06/C11.10: original refund admission and physical observations, no clock unlock.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { isHostedPaymentProvider } from "@/adapters/payments/providers";
import { env } from "@/core/env";
import { moneyStateEvents, payments, paymentMerchantRoutes, refunds } from "./schema";

type Refund = typeof refunds.$inferSelect;
const version = "freeholder.refund-physical.v1";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function journalKeys() {
  const configured = env();
  // SESSION_SECRET is required by the existing server contract. No embedded
  // key or unkeyed compatibility fallback can authenticate new evidence.
  return [...new Set([configured.CREDENTIAL_KEY, configured.CREDENTIAL_KEY_PREVIOUS, configured.SESSION_SECRET]
    .filter((key): key is string => Boolean(key)))];
}
function unsigned(metadata: Record<string, unknown>) {
  const { authentication: _authentication, ...body } = metadata;
  return body;
}
function sign(metadata: Record<string, unknown>) {
  const configured = env();
  const key = configured.CREDENTIAL_KEY ?? configured.SESSION_SECRET;
  if (!key) throw new ServiceError("conflict", "Configure the original refund evidence key before dispatch.");
  const body = unsigned(metadata);
  const purposeKey = createHmac("sha256", key).update("freeholder/legacy-refund-journal/signing-key/v1").digest();
  return { ...body, authentication: createHmac("sha256", purposeKey).update(`freeholder/legacy-refund-journal/v1\0${canonical(body)}`).digest("hex") };
}
function authentic(metadata: Record<string, unknown>) {
  if (typeof metadata.authentication !== "string" || !/^[a-f0-9]{64}$/.test(metadata.authentication)) return false;
  const actual = Buffer.from(metadata.authentication, "hex");
  return journalKeys().some(key => timingSafeEqual(actual, createHmac("sha256", createHmac("sha256", key).update("freeholder/legacy-refund-journal/signing-key/v1").digest())
    .update(`freeholder/legacy-refund-journal/v1\0${canonical(unsigned(metadata))}`).digest()));
}
export const legacyRefundRequest = z.object({ paymentId: z.uuid(), providerRef: z.string().min(1).max(500), currency: z.string(),
  amountMinor: z.number().int().positive(), reason: z.string(), idempotencyKey: z.string(), providerAccountId: z.string().optional(), refundApplicationFee: z.boolean().optional() });
export const legacyRefundDispatch = z.object({ refundId: z.uuid(), invoiceId: z.uuid(), paymentAmountMinor: z.number().int().positive(), paymentRequestHash: z.string(),
  dispatchId: z.uuid(), completionNonce: z.uuid(), requestHash: z.string(),
  requestDigest: z.string(), provider: z.string(), request: legacyRefundRequest });
export type LegacyRefundDispatch = z.infer<typeof legacyRefundDispatch>;
export const legacyRefundObservation = z.object({ status: z.enum(["succeeded", "pending", "failed", "unknown"]), providerRef: z.string().trim().min(1).max(500).optional(),
  providerAccountId: z.string().max(500).optional(), failureCode: z.string().max(100).optional() });
type ObservedResult = z.infer<typeof legacyRefundObservation>;
type Completed = { dispatch: LegacyRefundDispatch; result: ObservedResult };
// Only the actual promise wrapper can populate this capability. It is not a
// negative/absence witness; a restart leaves the durable processing debt open.
const completed = new Map<string, Completed>();
function originalReceipt(dispatch: LegacyRefundDispatch) {
  return { refundId: dispatch.refundId, invoiceId: dispatch.invoiceId, paymentId: dispatch.request.paymentId, provider: dispatch.provider,
    paymentAmountMinor: dispatch.paymentAmountMinor, paymentRequestHash: dispatch.paymentRequestHash,
    providerPaymentRef: dispatch.request.providerRef, providerAccountId: dispatch.request.providerAccountId ?? null,
    amountMinor: dispatch.request.amountMinor, currency: dispatch.request.currency, idempotencyKey: dispatch.request.idempotencyKey,
    refundApplicationFee: dispatch.request.refundApplicationFee ?? false };
}
function originalRefundMatches(original: Record<string, unknown>, refund: Refund) {
  return original.refundId === refund.id && original.invoiceId === refund.invoiceId && original.paymentId === refund.paymentId
    && original.provider === refund.provider && original.amountMinor === refund.amountMinor && original.currency === refund.currency && original.idempotencyKey === refund.idempotencyKey;
}
async function originalPaymentMatches(tx: Tx, original: Record<string, unknown>) {
  if (typeof original.paymentId !== "string") return false;
  const [parent] = await tx.select({ invoiceId: payments.invoiceId, provider: payments.provider, providerRef: payments.providerRef, status: payments.status,
    amountMinor: payments.amountMinor, requestHash: payments.requestHash,
    currency: payments.currency, providerAccountId: paymentMerchantRoutes.providerAccountId, applicationFeeMinor: paymentMerchantRoutes.applicationFeeMinor })
    .from(payments).leftJoin(paymentMerchantRoutes, eq(paymentMerchantRoutes.paymentId, payments.id)).where(eq(payments.id, original.paymentId));
  return Boolean(parent && parent.status === "succeeded" && parent.amountMinor === original.paymentAmountMinor && parent.requestHash === original.paymentRequestHash
    && parent.invoiceId === original.invoiceId && parent.provider === original.provider && (parent.providerRef ?? original.paymentId) === original.providerPaymentRef
    && parent.currency === original.currency && (parent.providerAccountId ?? null) === original.providerAccountId
    && Boolean(parent.providerAccountId && parent.applicationFeeMinor && parent.applicationFeeMinor > 0) === original.refundApplicationFee);
}

export function refundReservationMarker(refund: Pick<Refund, "id" | "paymentId" | "invoiceId" | "provider" | "amountMinor" | "currency" | "idempotencyKey" | "requestHash">) {
  return sign({ protocol: version, physicalState: "unsubmitted", refundId: refund.id, paymentId: refund.paymentId,
    invoiceId: refund.invoiceId, provider: refund.provider, amountMinor: refund.amountMinor, currency: refund.currency,
    idempotencyKey: refund.idempotencyKey, requestHash: refund.requestHash });
}
async function rawEvents(tx: Tx, refundId: string) {
  return tx.select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType, "refund"), eq(moneyStateEvents.subjectId, refundId)))
    .orderBy(asc(moneyStateEvents.occurredAt), asc(moneyStateEvents.id)).limit(501);
}
async function events(tx: Tx, refundId: string) {
  const rows = await rawEvents(tx, refundId);
  if (rows.length > 500) throw new ServiceError("conflict", "The original refund evidence needs reconciliation before another transition.");
  return rows;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function originalReservationMatches(rows: Awaited<ReturnType<typeof rawEvents>>, refund: Refund) {
  const created = rows.filter(row => row.fromState === null && row.toState === "created");
  if (created.length !== 1) return false;
  const metadata = record(created[0]!.metadata);
  return authentic(metadata) && canonical(unsigned(metadata)) === canonical(unsigned(refundReservationMarker(refund)));
}
export async function refundIsProvenUnsubmitted(tx: Tx, refund: Refund): Promise<boolean> {
  if (refund.status !== "created") return false;
  const rows = await events(tx, refund.id);
  return originalReservationMatches(rows, refund)
    && !rows.some(row => row.toState === "processing" || record(row.metadata).protocol === version && record(row.metadata).physicalState === "admitted");
}
export async function admitLegacyRefundDispatch(ctx: ServiceContext, refund: Refund, request: z.infer<typeof legacyRefundRequest>, payment: { amountMinor: number; requestHash: string }): Promise<LegacyRefundDispatch> {
  if (!await refundIsProvenUnsubmitted(ctx.tx, refund)) throw new ServiceError("conflict", "This original refund may already have a physical caller. Reconcile it before refunding again.");
  const actual = legacyRefundRequest.parse(request);
  const dispatch = legacyRefundDispatch.parse({ refundId: refund.id, invoiceId: refund.invoiceId, paymentAmountMinor: payment.amountMinor, paymentRequestHash: payment.requestHash,
    dispatchId: randomUUID(), completionNonce: randomUUID(), requestHash: refund.requestHash,
    requestDigest: digest(canonical(actual)), provider: refund.provider, request: actual });
  await ctx.tx.update(refunds).set({ status: "processing" }).where(eq(refunds.id, refund.id));
  await ctx.tx.insert(moneyStateEvents).values({ subjectType: "refund", subjectId: refund.id, fromState: "created", toState: "processing", actor: actorString(ctx.actor),
    reason: "Original provider refund admitted", metadata: sign({ protocol: version, physicalState: "admitted", refundId: refund.id, dispatchId: dispatch.dispatchId,
      requestHash: dispatch.requestHash, requestDigest: dispatch.requestDigest, completionNonceHash: digest(dispatch.completionNonce), original: originalReceipt(dispatch) }) });
  return dispatch;
}

/** A physical promise finishes before this holder can be created. The phase
 * below reads this holder rather than accepting caller-supplied money facts. */
export async function performLegacyRefundDispatch<T extends { status: string; providerRef?: string; providerAccountId?: string; failureCode?: string }>(
  dispatch: LegacyRefundDispatch, work: () => Promise<T>, persist: () => Promise<unknown>,
): Promise<T> {
  const original = structuredClone(dispatch);
  let answer: T;
  try { answer = await work(); }
  catch (error) {
    completed.set(original.dispatchId, { dispatch: original, result: { status: "unknown" } });
    await persist();
    throw error;
  }
  const result = legacyRefundObservation.safeParse({ status: answer.status, providerRef: answer.providerRef,
    providerAccountId: answer.providerAccountId, failureCode: answer.failureCode });
  completed.set(original.dispatchId, { dispatch: original, result: result.success ? result.data : { status: "unknown" } });
  await persist();
  return answer;
}

function admissionMatches(metadata: Record<string, unknown>, dispatch: LegacyRefundDispatch) {
  return authentic(metadata) && metadata.protocol === version && metadata.physicalState === "admitted" && metadata.refundId === dispatch.refundId
    && metadata.dispatchId === dispatch.dispatchId && metadata.requestHash === dispatch.requestHash && metadata.requestDigest === dispatch.requestDigest
    && metadata.completionNonceHash === digest(dispatch.completionNonce) && canonical(metadata.original) === canonical(originalReceipt(dispatch));
}
export function completedLegacyRefundFor(refund: Pick<Refund, "id">): LegacyRefundDispatch | null {
  const matches = [...completed.values()].filter(holder => holder.dispatch.refundId === refund.id);
  if (matches.length > 1) throw new ServiceError("conflict", "The original refund has conflicting retained caller evidence; reconcile it before application.");
  return matches[0] ? structuredClone(matches[0].dispatch) : null;
}
export async function retainLegacyRefundCaller(ctx: ServiceContext, input: { dispatchId: string; completionNonce: string }): Promise<{ recoveryRequired: boolean; result: ObservedResult }> {
  const holder = completed.get(input.dispatchId);
  if (!holder || holder.dispatch.completionNonce !== input.completionNonce) throw new ServiceError("permission", "Only the completed original physical caller can record its result.");
  const { dispatch, result } = holder;
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${dispatch.refundId}`}))`);
  const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, dispatch.refundId)).for("update");
  if (!refund) {
    await ctx.tx.insert(moneyStateEvents).values({ subjectType: "refund", subjectId: dispatch.refundId, fromState: null, toState: "provider_result_observed",
      actor: actorString(ctx.actor), reason: "Original physical refund receipt requires recovery",
      metadata: sign({ protocol: version, physicalState: "finished", dispatchId: dispatch.dispatchId, refundId: dispatch.refundId,
        requestHash: dispatch.requestHash, requestDigest: dispatch.requestDigest, original: originalReceipt(dispatch), result, recoveryRequired: true }) });
    ctx.setSubject("refund", dispatch.refundId);
    return { recoveryRequired: true, result };
  }
  const rows = await rawEvents(ctx.tx, refund.id);
  const admissions = rows.filter(row => admissionMatches(record(row.metadata), dispatch));
  const prior = rows.filter(row => record(row.metadata).protocol === version && record(row.metadata).physicalState === "finished" && record(row.metadata).dispatchId === dispatch.dispatchId);
  const refConflict = Boolean(result.providerRef && refund.providerRef && result.providerRef !== refund.providerRef);
  const original = originalReceipt(dispatch);
  const bindingsMatch = originalRefundMatches(original, refund) && await originalPaymentMatches(ctx.tx, original);
  const recoveryRequired = rows.length > 500 || !originalReservationMatches(rows, refund) || admissions.length !== 1 || refund.requestHash !== dispatch.requestHash || refConflict
    || !bindingsMatch
    || !["processing", "succeeded"].includes(refund.status)
    || (result.providerAccountId ?? "") !== (dispatch.request.providerAccountId ?? "") || prior.length > 1;
  // Even a missing/corrupt admission cannot discard this actually completed
  // caller's positive answer. Keep it as recovery evidence, never manufacture
  // a replacement admission or treat it as authority to release capacity.
  const metadata = sign({ protocol: version, physicalState: "finished", dispatchId: dispatch.dispatchId, refundId: refund.id,
    requestHash: dispatch.requestHash, requestDigest: dispatch.requestDigest, original, result, recoveryRequired });
  if (!prior.some(row => authentic(record(row.metadata)) && canonical(unsigned(record(row.metadata))) === canonical(unsigned(metadata)))) {
    await ctx.tx.insert(moneyStateEvents).values({ subjectType: "refund", subjectId: refund.id, fromState: null, toState: "provider_result_observed",
      actor: actorString(ctx.actor), reason: "Original physical refund caller finished", metadata });
  }
  if (bindingsMatch && result.providerRef && !refund.providerRef) await ctx.tx.update(refunds).set({ providerRef: result.providerRef }).where(eq(refunds.id, refund.id));
  ctx.setSubject("refund", refund.id);
  return { recoveryRequired, result };
}
export function forgetCompletedLegacyRefund(dispatchId: string) { completed.delete(dispatchId); }

/** Exact accepted/failed facts remain independent from logical settlement. */
export async function legacyRefundFinishedResult(tx: Tx, refund: Refund): Promise<ObservedResult | null> {
  const rows = await events(tx, refund.id);
  const admissions = rows.filter(row => record(row.metadata).protocol === version && record(row.metadata).physicalState === "admitted");
  const finishes = rows.filter(row => record(row.metadata).protocol === version && record(row.metadata).physicalState === "finished");
  if (!originalReservationMatches(rows, refund) || admissions.length !== 1 || finishes.length !== 1) return null;
  const admission = record(admissions[0]!.metadata), finish = record(finishes[0]!.metadata);
  if (!authentic(admission) || !authentic(finish) || admission.refundId !== refund.id || finish.refundId !== refund.id || admission.requestHash !== refund.requestHash || finish.requestHash !== refund.requestHash
    || admission.dispatchId !== finish.dispatchId || admission.requestDigest !== finish.requestDigest || finish.recoveryRequired !== false) return null;
  if (canonical(admission.original) !== canonical(finish.original) || !originalRefundMatches(record(finish.original), refund)
    || !await originalPaymentMatches(tx, record(finish.original))) return null;
  const parsed = legacyRefundObservation.safeParse(finish.result);
  return parsed.success ? parsed.data : null;
}
/** Called only after processRefundEvent has authenticated and matched the
 * exact original resource/payment/account/amount/currency. A terminal event
 * cannot finish a still-live physical caller. */
export async function retainLegacyRefundTerminal(ctx: ServiceContext, refund: Refund, event: {
  providerEventId: string; providerRef: string; paymentProviderRef: string; amountMinor?: number; currency?: string;
}) {
  if (ctx.actor.kind !== "system") throw new ServiceError("permission", "Provider refund evidence requires authenticated processing.");
  const result = await legacyRefundFinishedResult(ctx.tx, refund);
  if (result?.status !== "pending" || result.providerRef !== event.providerRef) return;
  const rows = await events(ctx.tx, refund.id);
  const admitted = rows.find(row => record(row.metadata).protocol === version && record(row.metadata).physicalState === "admitted");
  if (!admitted) return;
  const admission = record(admitted.metadata);
  const original = record(admission.original);
  if (original.providerPaymentRef !== event.paymentProviderRef || event.amountMinor !== refund.amountMinor || event.currency !== refund.currency) return;
  const metadata = sign({ protocol: version, physicalState: "terminal_resource", dispatchId: admission.dispatchId, refundId: refund.id,
    requestHash: refund.requestHash, original, providerEventId: event.providerEventId, providerRef: event.providerRef, status: "failed" });
  if (rows.some(row => canonical(unsigned(record(row.metadata))) === canonical(unsigned(metadata)) && authentic(record(row.metadata)))) return;
  await ctx.tx.insert(moneyStateEvents).values({ subjectType: "refund", subjectId: refund.id, fromState: null, toState: "provider_terminal_observed",
    actor: actorString(ctx.actor), reason: "Authenticated original refund resource failed after the caller finished", metadata });
}
export async function assertLegacyRefundRelease(ctx: ServiceContext, refund: Refund) {
  const rows = await events(ctx.tx, refund.id);
  const managed = rows.some(row => record(row.metadata).protocol === version && record(row.metadata).physicalState === "admitted");
  if (!managed && !isHostedPaymentProvider(refund.provider)) return;
  if (await refundIsProvenUnsubmitted(ctx.tx, refund)) return;
  const result = await legacyRefundFinishedResult(ctx.tx, refund);
  if (ctx.actor.kind === "system" && result?.status === "failed" && result.providerRef && result.providerRef === refund.providerRef) return;
  if (ctx.actor.kind === "system" && result?.status === "pending" && result.providerRef === refund.providerRef) {
    const terminal = rows.map(row => record(row.metadata)).filter(value => value.protocol === version && value.physicalState === "terminal_resource");
    if (terminal.length === 1 && authentic(terminal[0]!) && terminal[0]!.refundId === refund.id && terminal[0]!.requestHash === refund.requestHash
      && terminal[0]!.providerRef === refund.providerRef && terminal[0]!.status === "failed" && originalRefundMatches(record(terminal[0]!.original), refund)
      && await originalPaymentMatches(ctx.tx, record(terminal[0]!.original))) return;
  }
  throw new ServiceError("conflict", "The original provider refund is live or unresolved. Reconcile its actual result before releasing the reserved balance.");
}
