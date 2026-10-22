// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27 (MASTER.md §44.8): paying sellers through the site's payout
// provider — Stripe Connect, PayPal Payouts or Razorpay Route.
//
// The ledger (payouts.ts) decides what each seller is owed and when it is
// due. Here a seller sets up their account with the provider, and a job
// pays each due payout through it. Every provider call happens between two
// short transactions: claim, call, apply. A payout is claimed once (one
// transfer row per payout), the provider receives the payout id as its
// idempotency key, and a payout that keeps failing goes to the site owner
// to review instead of being retried for ever. A refund after payment queues
// a reversal where the provider can make one.
//
// Only a payout that is still due is sent. An attempt the provider may have
// seen (a timeout, or a result that could not be recorded) is retried with
// the same idempotency key, which returns the original transfer rather than
// paying twice; if the payout stops being due meanwhile, the owner checks
// with the provider. Money that reaches a seller after a refund queues a
// reversal or goes to review — never silently.
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { okResult, row, uuid, listed } from "@/core/contract";
import { env } from "@/core/env";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { users } from "@/core/auth/schema";
import { payoutProvider } from "@/adapters/payouts";
import { AdapterError } from "@/adapters/types";
import type { OnboardingField, PayoutWebhookEvent } from "@/adapters/payouts/types";
import { marketRules } from "./payouts";
import { memberPayoutAccounts, memberPayouts, memberPayoutTransfers, memberProfiles } from "./schema";

const MAX_ATTEMPTS = 5;
/** Marks a transfer whose last attempt may have reached the provider. */
const UNKNOWN = "Outcome unknown: ";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONBOARDING_FIELDS = ["paypalEmail", "legalName", "phone", "street", "city", "state", "postalCode", "beneficiaryName", "accountNumber", "ifsc"] as const satisfies readonly OnboardingField[];

function self(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return ctx.actor.userId;
}

export const payoutSetup = defineService({
  name: "members.payoutSetup",
  summary: "How you set up payouts with this site's payout provider, if it uses one.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({
    provider: z.string().nullable(),
    kind: z.enum(["hosted", "form"]).nullable(),
    fields: listed(z.enum(ONBOARDING_FIELDS)),
    configured: z.boolean(),
  }),
  handler: async (_input, ctx) => {
    self(ctx);
    const rules = await marketRules(ctx);
    const provider = payoutProvider(rules.adapter);
    if (!provider) return { provider: null, kind: null, fields: [], configured: false };
    return {
      provider: provider.id,
      kind: provider.onboarding.kind,
      fields: provider.onboarding.kind === "form" ? [...provider.onboarding.fields] : [],
      configured: provider.missing().length === 0,
    };
  },
});

export const payoutSetupSource = defineService({
  name: "members.payoutSetupSource",
  summary: "Who is setting up payouts, and with which provider account so far.",
  kind: "query",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  input: z.object({}),
  output: z.object({ adapter: z.string(), userId: uuid, email: z.string(), displayName: z.string(), externalAccountId: z.string().nullable() }),
  handler: async (_input, ctx) => {
    const userId = self(ctx);
    const rules = await marketRules(ctx);
    if (!rules.enabled) throw new ServiceError("permission", "This site does not have a member market.");
    const [person] = await ctx.tx
      .select({ email: users.email, displayName: memberProfiles.displayName, status: memberProfiles.status })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId));
    if (!person || person.status !== "active") throw new ServiceError("permission", "Join the site first.");
    const [account] = await ctx.tx.select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, userId));
    return { adapter: rules.adapter, userId, email: person.email, displayName: person.displayName, externalAccountId: account?.adapter === rules.adapter ? account.externalAccountId : null };
  },
});

export const applyPayoutAccount = defineService({
  name: "members.applyPayoutAccount",
  summary: "Record your account with the payout provider and whether it can be paid.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "money",
  input: z.object({ adapter: z.string(), externalAccountId: z.string().min(1).max(200), status: z.enum(["pending", "ready", "disabled"]) }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = self(ctx);
    await ctx.tx
      .insert(memberPayoutAccounts)
      .values({ userId, adapter: input.adapter, status: input.status, externalAccountId: input.externalAccountId })
      .onConflictDoUpdate({ target: memberPayoutAccounts.userId, set: { adapter: input.adapter, status: input.status, externalAccountId: input.externalAccountId, updatedAt: new Date() } });
    ctx.setSubject("member_payout_account", userId);
    return { ok: true as const };
  },
});

/** Start or continue setting up payouts: a hosted page to visit, or the form's answers sent on. */
export const startPayoutSetup = defineOrchestratedService({
  name: "members.startPayoutSetup",
  summary: "Set up, or continue setting up, how this site's payout provider pays you.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "money",
  rateLimit: { limit: 20, windowSeconds: 3600, message: "Please wait a little before trying again.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ fields: z.partialRecord(z.enum(ONBOARDING_FIELDS), z.string().max(200)).default({}) }),
  output: z.object({ url: z.string().nullable(), status: z.enum(["pending", "ready", "disabled"]) }),
  handler: async (input, actor) => {
    const source = await payoutSetupSource.call({}, actor);
    const provider = payoutProvider(source.adapter);
    if (!provider) throw new ServiceError("validation", "This site pays sellers by hand; add your details instead.");
    if (provider.missing().length) throw new ServiceError("validation", "The site owner has not finished setting up payouts yet.");
    const base = env().APP_URL.replace(/\/+$/, "");
    const result = await provider
      .onboard({ userId: source.userId, email: source.email, displayName: source.displayName }, input.fields, { returnUrl: `${base}/portal/payouts?setup=done`, refreshUrl: `${base}/portal/payouts?setup=again` }, source.externalAccountId)
      .catch((error: unknown) => {
        throw new ServiceError("validation", error instanceof Error ? error.message : "The payout provider refused that.");
      });
    await applyPayoutAccount.call({ adapter: provider.id, externalAccountId: result.externalAccountId, status: result.status }, actor);
    return { url: result.url ?? null, status: result.status };
  },
});

export const refreshPayoutAccount = defineOrchestratedService({
  name: "members.refreshPayoutAccount",
  summary: "Ask the payout provider whether your account can be paid yet.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "money",
  input: z.object({}),
  output: z.object({ status: z.enum(["pending", "ready", "disabled"]) }),
  handler: async (_input, actor) => {
    const source = await payoutSetupSource.call({}, actor);
    const provider = payoutProvider(source.adapter);
    if (!provider || !source.externalAccountId) throw new ServiceError("validation", "Set up payouts first.");
    const status = await provider.accountStatus(source.externalAccountId);
    await applyPayoutAccount.call({ adapter: provider.id, externalAccountId: source.externalAccountId, status }, actor);
    return { status };
  },
});

const claimed = row({ id: uuid, payoutId: uuid, kind: z.enum(["transfer", "reversal"]), provider: z.string(), amountMinor: z.number().int(), currency: z.string(), externalAccountId: z.string().nullable(), reference: z.string().nullable(), attempts: z.number().int() });

/** Due payouts, and reversals, ready to send through their provider. */
export const claimProviderTransfers = defineService({
  name: "members.claimProviderTransfers",
  summary: "Claim payouts and reversals due to go through the payout provider.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  output: z.object({ transfers: listed(claimed) }),
  handler: async (input, ctx) => {
    const rules = await marketRules(ctx);
    if (payoutProvider(rules.adapter)) {
      // Each due payout to a ready provider account gets its one transfer row.
      const due = await ctx.tx
        .select({ payout: memberPayouts })
        .from(memberPayouts)
        .innerJoin(memberPayoutAccounts, and(eq(memberPayoutAccounts.userId, memberPayouts.sellerId), eq(memberPayoutAccounts.adapter, rules.adapter), eq(memberPayoutAccounts.status, "ready"), isNotNull(memberPayoutAccounts.externalAccountId)))
        .where(and(eq(memberPayouts.state, "due"), sql`not exists (select 1 from ${memberPayoutTransfers} t where t.payout_id = ${memberPayouts.id} and t.kind = 'transfer')`))
        .limit(input.limit);
      if (due.length) {
        await ctx.tx
          .insert(memberPayoutTransfers)
          .values(due.map(({ payout }) => ({ payoutId: payout.id, kind: "transfer" as const, provider: rules.adapter, amountMinor: payout.netMinor, currency: payout.currency })))
          .onConflictDoNothing();
      }
    }
    const found = await ctx.tx
      .select({ t: memberPayoutTransfers, payoutState: memberPayouts.state, externalAccountId: memberPayoutAccounts.externalAccountId })
      .from(memberPayoutTransfers)
      .innerJoin(memberPayouts, eq(memberPayouts.id, memberPayoutTransfers.payoutId))
      .leftJoin(memberPayoutAccounts, eq(memberPayoutAccounts.userId, memberPayouts.sellerId))
      .where(and(eq(memberPayoutTransfers.state, "pending"), lte(memberPayoutTransfers.nextAttemptAt, new Date())))
      .limit(input.limit)
      .for("update", { of: memberPayoutTransfers, skipLocked: true });
    // Only a payout still due is sent. One refunded, disputed or paid by hand
    // since its transfer was queued is dropped; if an earlier attempt may
    // have reached the provider, the owner checks there instead.
    const ready: typeof found = [];
    const now = new Date();
    for (const r of found) {
      if (r.t.kind !== "transfer" || r.payoutState === "due") {
        ready.push(r);
      } else if (r.t.lastError?.startsWith(UNKNOWN)) {
        await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", lastError: `${r.t.lastError} Not retried: the payout was ${r.payoutState} meanwhile.`.slice(0, 500), updatedAt: now }).where(eq(memberPayoutTransfers.id, r.t.id));
        await ctx.tx
          .update(memberPayouts)
          .set({ state: "review", note: `The payout was ${r.payoutState} while an attempt to pay it through ${r.t.provider} had an unknown outcome. Check with ${r.t.provider} whether the seller was paid before settling it.` })
          .where(eq(memberPayouts.id, r.t.payoutId));
      } else {
        await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", lastError: `Not sent: the payout was ${r.payoutState} before it was paid.`, updatedAt: now }).where(eq(memberPayoutTransfers.id, r.t.id));
      }
    }
    // Claimed rows are pushed back while in flight, so an overlapping run
    // skips them, and are marked as possibly seen by the provider until the
    // result is recorded.
    if (ready.length) {
      await ctx.tx
        .update(memberPayoutTransfers)
        .set({ attempts: sql`${memberPayoutTransfers.attempts} + 1`, lastError: `${UNKNOWN}sent to the provider; no result recorded yet.`, nextAttemptAt: new Date(now.getTime() + 10 * 60_000), updatedAt: now })
        .where(inArray(memberPayoutTransfers.id, ready.map((r) => r.t.id)));
    }
    return {
      transfers: ready.map(({ t, externalAccountId }) => ({ id: t.id, payoutId: t.payoutId, kind: t.kind, provider: t.provider, amountMinor: t.amountMinor, currency: t.currency, externalAccountId, reference: t.reference, attempts: t.attempts + 1 })),
    };
  },
});

export const applyProviderTransfer = defineService({
  name: "members.applyProviderTransfer",
  summary: "Record what the payout provider did with one transfer or reversal.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({
    id: uuid,
    outcome: z.enum(["settled", "sent", "failed", "unsupported"]),
    reference: z.string().max(200).optional(),
    error: z.string().max(500).optional(),
    /** The provider may have acted despite the error (a timeout, an outage). */
    uncertain: z.boolean().default(false),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [t] = await ctx.tx.select().from(memberPayoutTransfers).where(eq(memberPayoutTransfers.id, input.id)).for("update");
    // A webhook may already have settled or failed it while the call was in flight.
    if (!t || t.state !== "pending") return { ok: true as const };
    const now = new Date();
    if (input.outcome === "failed") {
      // Claiming counted the attempt.
      const giveUp = t.attempts >= MAX_ATTEMPTS;
      const error = input.error ?? "unknown error";
      await ctx.tx
        .update(memberPayoutTransfers)
        .set({ state: giveUp ? "failed" : "pending", lastError: `${input.uncertain ? UNKNOWN : ""}${error}`.slice(0, 500), nextAttemptAt: new Date(now.getTime() + Math.min(2 ** t.attempts, 360) * 60_000), updatedAt: now })
        .where(eq(memberPayoutTransfers.id, t.id));
      if (giveUp) {
        const note = input.uncertain
          ? `The payout provider never confirmed this ${t.kind} (${error}). Check with ${t.provider} whether it went through before settling it.`
          : `The payout provider kept refusing this ${t.kind}: ${error}.`;
        await ctx.tx.update(memberPayouts).set({ state: "review", note }).where(and(eq(memberPayouts.id, t.payoutId), inArray(memberPayouts.state, t.kind === "transfer" ? ["due"] : ["review", "paid", "cancelled"])));
      }
      return { ok: true as const };
    }
    if (input.outcome === "unsupported") {
      await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", lastError: input.error ?? null, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
      await ctx.tx.update(memberPayouts).set({ state: "review", note: input.error ?? "The payout provider cannot reverse this payout." }).where(eq(memberPayouts.id, t.payoutId));
      return { ok: true as const };
    }
    const reference = input.reference ?? t.reference;
    await ctx.tx.update(memberPayoutTransfers).set({ state: input.outcome, reference, lastError: null, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
    if (input.outcome === "settled") await settle(ctx, t, reference);
    return { ok: true as const };
  },
});

async function settle(ctx: ServiceContext, t: typeof memberPayoutTransfers.$inferSelect, reference: string | null) {
  if (t.kind === "reversal") {
    await ctx.tx.update(memberPayouts).set({ state: "cancelled", note: "Buyer refunded; the transfer to the seller was reversed." }).where(eq(memberPayouts.id, t.payoutId));
    return;
  }
  const [payout] = await ctx.tx.select().from(memberPayouts).where(eq(memberPayouts.id, t.payoutId)).for("update");
  if (!payout) return;
  if (payout.state === "due") {
    await ctx.tx.update(memberPayouts).set({ state: "paid", paidAt: new Date(), reference }).where(eq(memberPayouts.id, payout.id));
    return;
  }
  // The money reached the seller after the payout stopped being due — a
  // refund, a dispute, or the owner paying by hand. That is never silent.
  const ref = reference ? ` (${t.provider} ${reference})` : "";
  if (payout.state === "cancelled") {
    // As for a refund after payment: ask the provider for the money back.
    await ctx.tx.update(memberPayouts).set({ state: "review", reference, note: `The payout provider paid the seller${ref} after this payout was cancelled; asking it to reverse the transfer.` }).where(eq(memberPayouts.id, payout.id));
    await ctx.tx.insert(memberPayoutTransfers).values({ payoutId: payout.id, kind: "reversal", provider: t.provider, amountMinor: t.amountMinor, currency: t.currency, reference }).onConflictDoNothing();
    return;
  }
  const was = payout.state === "paid" ? "already recorded as paid" : `${payout.state}`;
  await ctx.tx.update(memberPayouts).set({ state: "review", note: `The payout provider paid the seller${ref} while this payout was ${was}; recover or absorb the difference.` }).where(eq(memberPayouts.id, payout.id));
}

/** C12.26: a refund after a provider paid the seller asks the provider for the money back. */
export async function queueReversals(ctx: ServiceContext, payoutIds: string[]): Promise<number> {
  if (!payoutIds.length) return 0;
  const paid = await ctx.tx
    .select()
    .from(memberPayoutTransfers)
    .where(and(inArray(memberPayoutTransfers.payoutId, payoutIds), eq(memberPayoutTransfers.kind, "transfer"), inArray(memberPayoutTransfers.state, ["sent", "settled"])));
  if (!paid.length) return 0;
  await ctx.tx
    .insert(memberPayoutTransfers)
    .values(paid.map((t) => ({ payoutId: t.payoutId, kind: "reversal" as const, provider: t.provider, amountMinor: t.amountMinor, currency: t.currency, reference: t.reference })))
    .onConflictDoNothing();
  await ctx.tx.update(memberPayouts).set({ note: "Buyer refunded after the seller was paid; asking the payout provider to reverse the transfer." }).where(inArray(memberPayouts.id, paid.map((t) => t.payoutId)));
  return paid.length;
}

export const applyPayoutWebhook = defineService({
  name: "members.applyPayoutWebhook",
  summary: "Apply verified payout provider events: accounts becoming payable, transfers settling or failing.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({
    provider: z.string(),
    events: z.array(z.union([
      z.object({ kind: z.literal("account"), externalAccountId: z.string(), status: z.enum(["pending", "ready", "disabled"]) }),
      z.object({ kind: z.literal("transfer"), reference: z.string(), payoutId: z.string().optional(), state: z.enum(["settled", "failed"]), error: z.string().optional() }),
    ])).max(50),
  }),
  output: z.object({ applied: z.number().int(), unmatched: z.number().int() }),
  handler: async (input, ctx) => {
    let applied = 0;
    let unmatched = 0;
    for (const event of input.events as PayoutWebhookEvent[]) {
      if (event.kind === "account") {
        const rows = await ctx.tx
          .update(memberPayoutAccounts)
          .set({ status: event.status, updatedAt: new Date() })
          .where(and(eq(memberPayoutAccounts.adapter, input.provider), eq(memberPayoutAccounts.externalAccountId, event.externalAccountId)))
          .returning({ userId: memberPayoutAccounts.userId });
        applied += rows.length;
        continue;
      }
      // By the provider's reference, or by the payout id the transfer carried:
      // the event can arrive before the reference is recorded here.
      const ours = and(eq(memberPayoutTransfers.provider, input.provider), eq(memberPayoutTransfers.kind, "transfer"));
      let [t] = await ctx.tx.select().from(memberPayoutTransfers).where(and(ours, eq(memberPayoutTransfers.reference, event.reference))).for("update");
      if (!t && event.payoutId && UUID.test(event.payoutId)) {
        [t] = await ctx.tx.select().from(memberPayoutTransfers).where(and(ours, eq(memberPayoutTransfers.payoutId, event.payoutId))).for("update");
      }
      if (!t) {
        // A payout of this site's that cannot be matched is not acknowledged
        // as handled; the provider is asked to deliver it again.
        if (event.payoutId) unmatched++;
        continue;
      }
      if (t.state === "settled" || t.state === "failed") continue;
      const reference = t.reference ?? event.reference;
      if (event.state === "settled") {
        await ctx.tx.update(memberPayoutTransfers).set({ state: "settled", reference, lastError: null, updatedAt: new Date() }).where(eq(memberPayoutTransfers.id, t.id));
        await settle(ctx, t, reference);
      } else {
        await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", reference, lastError: event.error ?? null, updatedAt: new Date() }).where(eq(memberPayoutTransfers.id, t.id));
        await ctx.tx.update(memberPayouts).set({ state: "review", note: `The payout provider could not pay this (${event.error ?? "failed"}).` }).where(and(eq(memberPayouts.id, t.payoutId), eq(memberPayouts.state, "due")));
      }
      applied++;
    }
    return { applied, unmatched };
  },
});

/** The job: send what is due through each provider, outside any transaction. */
export async function sendProviderPayouts(): Promise<{ sent: number; failed: number }> {
  const { transfers } = await claimProviderTransfers.call({ limit: 20 }, { kind: "system" });
  let sent = 0;
  let failed = 0;
  for (const t of transfers) {
    const provider = payoutProvider(t.provider);
    let outcome: z.input<typeof applyProviderTransfer.def.input>;
    try {
      if (!provider) throw new AdapterError("payments", t.provider, "unavailable", `The payout provider ${t.provider} is not installed.`);
      if (t.kind === "transfer") {
        if (!t.externalAccountId) throw new AdapterError("payments", t.provider, "invalid_request", "The seller has no account with the payout provider.");
        const result = await provider.transfer({ externalAccountId: t.externalAccountId, amountMinor: t.amountMinor, currency: t.currency, idempotencyKey: t.payoutId, description: `Payout ${t.payoutId}` });
        outcome = { id: t.id, outcome: result.settled ? "settled" : "sent", reference: result.reference };
      } else {
        if (!t.reference) throw new AdapterError("payments", t.provider, "invalid_request", "There is no transfer to reverse.");
        const result = await provider.reverse({ reference: t.reference, amountMinor: t.amountMinor, currency: t.currency, idempotencyKey: t.payoutId });
        outcome = "unsupported" in result ? { id: t.id, outcome: "unsupported", error: result.unsupported } : { id: t.id, outcome: "settled", reference: result.reference };
      }
    } catch (error) {
      // Only a plain refusal means nothing moved. A timeout, an outage or an
      // unreadable reply may have reached the provider: the retry reuses the
      // idempotency key, and the owner is told the outcome is unknown.
      const refused = error instanceof AdapterError && !error.retryable && error.code !== "provider_failure";
      failed++;
      await applyProviderTransfer.call({ id: t.id, outcome: "failed", uncertain: !refused, error: (error instanceof Error ? error.message : "Failed.").slice(0, 500) }, { kind: "system" });
      continue;
    }
    try {
      await applyProviderTransfer.call(outcome, { kind: "system" });
      sent++;
    } catch (error) {
      // The provider acted but its result was not recorded — not a provider
      // failure. The row stays claimed and marked unknown; the next run's
      // idempotent call returns the same transfer to record.
      failed++;
      console.error(`[payouts] could not record ${t.kind} ${t.id} from ${t.provider}`, error);
    }
  }
  return { sent, failed };
}

export default [payoutSetup, payoutSetupSource, applyPayoutAccount, startPayoutSetup, refreshPayoutAccount, claimProviderTransfers, applyProviderTransfer, applyPayoutWebhook];
