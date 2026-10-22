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
// Only a payout that is still due is sent. Each provider attempt has one
// idempotency key — the payout id, then `<payout id>:<n>` — and every retry
// of it reuses that key, so the provider returns the first result rather
// than paying twice. A new attempt (a new key) is made only once the last
// one is dead at the provider: refused before money moved, or returned. An
// attempt whose outcome is unknown, or that PayPal holds unclaimed, is never
// resent automatically: the owner checks the provider and records "paid" or
// "did not pay — send again". Money that reaches a seller after a refund or
// a review queues a reversal or goes to review — never silently.
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { okResult, row, uuid, listed } from "@/core/contract";
import { env } from "@/core/env";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { users } from "@/core/auth/schema";
import { payoutProvider } from "@/adapters/payouts";
import { AdapterError } from "@/adapters/types";
import type { OnboardingField, PayoutWebhookEvent } from "@/adapters/payouts/types";
import { marketRules, PROVIDER_CHECK } from "./payouts";
import { memberPayoutAccounts, memberPayouts, memberPayoutTransfers, memberProfiles, type PayoutTransferAttempt } from "./schema";

const MAX_ATTEMPTS = 5;
/** Marks a transfer whose last attempt may have reached the provider. */
const UNKNOWN = "Outcome unknown: ";
/** Written while a claimed call is in flight; replaced by the result. */
const CLAIMED = `${UNKNOWN}sent to the provider; no result recorded yet.`;
/** The marker sticks until a result is recorded: a later refusal does not prove an earlier timeout paid nothing. */
const uncertain = (lastError: string | null) => Boolean(lastError?.startsWith(UNKNOWN));
/** Same-key retries stop short of Stripe's 24-hour idempotency key retention. */
const STALE_KEY_MS = 23 * 60 * 60_000;
/** Transfer states the owner settles by checking the provider. */
const AWAITING_CHECK = ["unknown", "unclaimed", "sent"] as const;
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

const claimed = row({ id: uuid, payoutId: uuid, kind: z.enum(["transfer", "reversal"]), provider: z.string(), amountMinor: z.number().int(), currency: z.string(), externalAccountId: z.string().nullable(), reference: z.string().nullable(), attempts: z.number().int(), attempt: z.number().int() });

type Transfer = typeof memberPayoutTransfers.$inferSelect;

/** The provider's idempotency key for an attempt: the payout id, then `<payout id>:<n>`. */
export function attemptKey(payoutId: string, attempt: number): string {
  return attempt === 1 ? payoutId : `${payoutId}:${attempt}`;
}

function parseKey(key: string | undefined): { payoutId: string; attempt: number } | undefined {
  const match = key ? /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::([1-9][0-9]{0,3}))?$/i.exec(key) : null;
  return match ? { payoutId: match[1]!.toLowerCase(), attempt: match[2] ? Number(match[2]) : 1 } : undefined;
}

/** Close the current attempt for good and open the next, under a new key. Only for an attempt that is dead at the provider. */
function nextAttempt(t: Transfer, ended: PayoutTransferAttempt["state"], note: string, now: Date) {
  const past: PayoutTransferAttempt = { attempt: t.attempt, key: attemptKey(t.payoutId, t.attempt), reference: t.reference, state: ended, lastError: note.slice(0, 500), endedAt: now.toISOString() };
  return { attempt: t.attempt + 1, previousAttempts: [...t.previousAttempts, past], state: "pending" as const, reference: null, attempts: 0, attemptStartedAt: null, lastError: null, nextAttemptAt: sql`now()`, updatedAt: now };
}

const NEEDS_CHECK = (provider: string, why: string) =>
  `${PROVIDER_CHECK}${provider} whether the seller was paid: ${why} Then record "provider paid" or "provider did not pay — send again"; nothing is sent until you do.`;

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
    const now = new Date();
    if (payoutProvider(rules.adapter)) {
      const payable = and(eq(memberPayoutAccounts.userId, memberPayouts.sellerId), eq(memberPayoutAccounts.adapter, rules.adapter), eq(memberPayoutAccounts.status, "ready"), isNotNull(memberPayoutAccounts.externalAccountId));
      // A payout due again after a review ("still owed") whose last attempt
      // is dead at the provider gets a new attempt under a new key. One whose
      // last attempt may have paid is never resent automatically.
      const returned = await ctx.tx
        .select({ t: memberPayoutTransfers, payout: memberPayouts })
        .from(memberPayoutTransfers)
        .innerJoin(memberPayouts, eq(memberPayouts.id, memberPayoutTransfers.payoutId))
        .innerJoin(memberPayoutAccounts, payable)
        .where(and(eq(memberPayouts.state, "due"), eq(memberPayoutTransfers.kind, "transfer"), inArray(memberPayoutTransfers.state, ["failed", "settled", "unknown"])))
        .limit(input.limit)
        .for("update", { of: memberPayoutTransfers, skipLocked: true });
      for (const { t, payout } of returned) {
        if (t.state === "settled") {
          await ctx.tx.update(memberPayouts).set({ state: "paid", paidAt: now, reference: t.reference }).where(eq(memberPayouts.id, payout.id));
        } else if (t.state === "unknown") {
          await ctx.tx.update(memberPayouts).set({ state: "review", note: NEEDS_CHECK(t.provider, "an earlier attempt's outcome is unknown.") }).where(eq(memberPayouts.id, payout.id));
        } else {
          await ctx.tx
            .update(memberPayoutTransfers)
            .set({ ...nextAttempt(t, "failed", t.lastError ?? "failed", now), provider: rules.adapter, amountMinor: payout.netMinor, currency: payout.currency })
            .where(eq(memberPayoutTransfers.id, t.id));
        }
      }
      // Each due payout to a ready provider account gets its one transfer row.
      const due = await ctx.tx
        .select({ payout: memberPayouts })
        .from(memberPayouts)
        .innerJoin(memberPayoutAccounts, payable)
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
      .where(and(eq(memberPayoutTransfers.state, "pending"), lte(memberPayoutTransfers.nextAttemptAt, sql`now()`)))
      .limit(input.limit)
      .for("update", { of: memberPayoutTransfers, skipLocked: true });
    const ready: typeof found = [];
    for (const r of found) {
      const maybePaid = uncertain(r.t.lastError);
      // Same-key retries stay inside the providers' key retention (Stripe
      // keeps keys 24 hours); past that, the owner checks instead.
      const stale = maybePaid && r.t.attemptStartedAt !== null && now.getTime() - r.t.attemptStartedAt.getTime() > STALE_KEY_MS;
      if (r.t.kind !== "transfer" || (r.payoutState === "due" && !stale)) {
        ready.push(r);
      } else if (maybePaid) {
        // The payout was refunded, disputed or settled by hand — or the key
        // is too old to retry — while an attempt may have reached the provider.
        await ctx.tx.update(memberPayoutTransfers).set({ state: "unknown", updatedAt: now }).where(eq(memberPayoutTransfers.id, r.t.id));
        const why = stale ? "an attempt's outcome stayed unknown for too long to retry safely." : `the payout was ${r.payoutState} while an attempt's outcome was unknown.`;
        await ctx.tx.update(memberPayouts).set({ state: "review", note: NEEDS_CHECK(r.t.provider, why) }).where(eq(memberPayouts.id, r.t.payoutId));
      } else {
        // Nothing reached the provider (never sent, or only refused).
        await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", lastError: `Not sent: the payout was ${r.payoutState} before it was paid.`, updatedAt: now }).where(eq(memberPayoutTransfers.id, r.t.id));
      }
    }
    // Claimed rows are pushed back while in flight, so an overlapping run
    // skips them, and are marked as possibly seen by the provider until the
    // result is recorded. An earlier unknown outcome keeps its own words.
    for (const { t } of ready) {
      const lastError = !uncertain(t.lastError) ? CLAIMED : t.lastError === CLAIMED ? `${UNKNOWN}an earlier run's result was not recorded.` : t.lastError;
      await ctx.tx
        .update(memberPayoutTransfers)
        .set({ attempts: sql`${memberPayoutTransfers.attempts} + 1`, attemptStartedAt: t.attemptStartedAt ?? now, lastError, nextAttemptAt: new Date(now.getTime() + 10 * 60_000), updatedAt: now })
        .where(eq(memberPayoutTransfers.id, t.id));
    }
    return {
      transfers: ready.map(({ t, externalAccountId }) => ({ id: t.id, payoutId: t.payoutId, kind: t.kind, provider: t.provider, amountMinor: t.amountMinor, currency: t.currency, externalAccountId, reference: t.reference, attempts: t.attempts + 1, attempt: t.attempt })),
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
    /** The provider may have acted despite the error (a timeout, an outage, 409). */
    uncertain: z.boolean().default(false),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [t] = await ctx.tx.select().from(memberPayoutTransfers).where(eq(memberPayoutTransfers.id, input.id)).for("update");
    // A webhook may already have settled or failed it while the call was in flight.
    if (!t || t.state !== "pending") return { ok: true as const };
    const now = new Date();
    if (input.outcome === "failed") {
      // Claiming counted the attempt. A refusal now does not clear an
      // earlier unknown outcome: only a recorded result does.
      const giveUp = t.attempts >= MAX_ATTEMPTS;
      const error = input.error ?? "unknown error";
      const unknown = input.uncertain || (uncertain(t.lastError) && t.lastError !== CLAIMED);
      const lastError = input.uncertain ? `${UNKNOWN}${error}` : unknown ? `${UNKNOWN}an earlier attempt is unconfirmed; then refused: ${error}` : error;
      await ctx.tx
        .update(memberPayoutTransfers)
        .set({ state: giveUp ? (unknown ? "unknown" : "failed") : "pending", lastError: lastError.slice(0, 500), nextAttemptAt: new Date(now.getTime() + Math.min(2 ** t.attempts, 360) * 60_000), updatedAt: now })
        .where(eq(memberPayoutTransfers.id, t.id));
      if (giveUp) {
        const note = unknown
          ? NEEDS_CHECK(t.provider, `the provider never confirmed this ${t.kind} (${error}).`)
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

async function settle(ctx: ServiceContext, t: Transfer, reference: string | null) {
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
  // refund, a dispute, a review, or the owner paying by hand. Never silent.
  const ref = reference ? ` (${t.provider} ${reference})` : "";
  if (payout.state === "cancelled") {
    // As for a refund after payment: ask the provider for the money back.
    await ctx.tx.update(memberPayouts).set({ state: "review", reference, note: `The payout provider paid the seller${ref} after this payout was cancelled; asking it to reverse the transfer.` }).where(eq(memberPayouts.id, payout.id));
    await ctx.tx.insert(memberPayoutTransfers).values({ payoutId: payout.id, kind: "reversal", provider: t.provider, amountMinor: t.amountMinor, currency: t.currency, reference }).onConflictDoNothing();
    return;
  }
  await ctx.tx.update(memberPayouts).set({ state: "review", note: paidAfterAll(payout.state, ref) }).where(eq(memberPayouts.id, payout.id));
}

function paidAfterAll(state: string, ref: string): string {
  return state === "paid"
    ? `The payout provider paid the seller${ref} although this payout was already recorded as paid: the seller may have been paid twice; recover or absorb the difference.`
    : `The payout provider paid the seller${ref} after all. Do not pay it by hand; if you already did, recover the difference.`;
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

/**
 * C12.26: the owner's answer after checking the provider for a payout whose
 * transfer outcome is unknown, unclaimed or unconfirmed. "Paid" records it
 * paid. "Not paid" closes that attempt and sends a new one under a new key —
 * the owner has confirmed the old one is dead (for PayPal, an unclaimed
 * payment must be cancelled there first).
 */
export async function resolveProviderCheck(ctx: ServiceContext, payoutIds: string[], outcome: "paid" | "not_paid", reference: string | undefined): Promise<string[]> {
  const rows = await ctx.tx
    .select({ t: memberPayoutTransfers })
    .from(memberPayoutTransfers)
    .innerJoin(memberPayouts, eq(memberPayouts.id, memberPayoutTransfers.payoutId))
    .where(and(
      inArray(memberPayoutTransfers.payoutId, payoutIds),
      eq(memberPayoutTransfers.kind, "transfer"),
      eq(memberPayouts.state, "review"),
      // "Send again" only answers the provider check: an attempt whose outcome
      // is unknown, under a review the check raised. Not a payment still in
      // flight or held unclaimed (it may yet pay), and not a review raised for
      // another reason, such as a partial refund ("still owed" covers that).
      outcome === "not_paid"
        ? and(eq(memberPayoutTransfers.state, "unknown"), sql`starts_with(${memberPayouts.note}, ${PROVIDER_CHECK})`)
        : inArray(memberPayoutTransfers.state, AWAITING_CHECK),
    ))
    .for("update", { of: memberPayoutTransfers });
  const now = new Date();
  for (const { t } of rows) {
    if (outcome === "paid") {
      const ref = reference ?? t.reference;
      await ctx.tx.update(memberPayoutTransfers).set({ state: "settled", reference: ref, lastError: null, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
      await ctx.tx.update(memberPayouts).set({ state: "paid", paidAt: now, reference: ref, note: "The site owner confirmed the payout provider paid the seller." }).where(eq(memberPayouts.id, t.payoutId));
    } else {
      await ctx.tx.update(memberPayoutTransfers).set(nextAttempt(t, "failed", "The site owner confirmed the payout provider did not pay this attempt.", now)).where(eq(memberPayoutTransfers.id, t.id));
      await ctx.tx.update(memberPayouts).set({ state: "due", note: "The site owner confirmed the provider did not pay; sending again." }).where(eq(memberPayouts.id, t.payoutId));
    }
  }
  return rows.map(({ t }) => t.payoutId);
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
      z.object({ kind: z.literal("transfer"), reference: z.string(), key: z.string().optional(), state: z.enum(["settled", "failed", "unclaimed"]), error: z.string().optional() }),
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
      // An event belongs to exactly one attempt: the one with its reference,
      // or the one sent under its key. Never the current attempt by payout
      // id alone, so a late event for attempt 1 cannot touch attempt 2.
      const ours = and(eq(memberPayoutTransfers.provider, input.provider), eq(memberPayoutTransfers.kind, "transfer"));
      const key = parseKey(event.key);
      let [t] = await ctx.tx.select().from(memberPayoutTransfers).where(and(ours, eq(memberPayoutTransfers.reference, event.reference))).for("update");
      t ??= (await ctx.tx.select().from(memberPayoutTransfers).where(and(ours, sql`${memberPayoutTransfers.previousAttempts} @> ${JSON.stringify([{ reference: event.reference }])}::jsonb`)).for("update"))[0];
      if (!t && key) [t] = await ctx.tx.select().from(memberPayoutTransfers).where(and(ours, eq(memberPayoutTransfers.payoutId, key.payoutId))).for("update");
      const current = t && (t.reference === event.reference || (key !== undefined && key.payoutId === t.payoutId && key.attempt === t.attempt));
      const past = t && !current ? t.previousAttempts.find((a) => a.reference === event.reference || (key !== undefined && key.payoutId === t.payoutId && a.attempt === key.attempt)) : undefined;
      if (!t || (!current && !past)) {
        // Not one of this site's transfers (a shared provider account
        // carries other payouts too): acknowledged and ignored.
        unmatched++;
        continue;
      }
      const now = new Date();
      if (past) {
        if (past.state === "settled" || event.state === past.state) continue;
        const previousAttempts = t.previousAttempts.map((a) => (a === past ? { ...a, state: event.state === "settled" ? ("settled" as const) : event.state, reference: a.reference ?? event.reference } : a));
        await ctx.tx.update(memberPayoutTransfers).set({ previousAttempts, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
        if (event.state === "settled") {
          const ref = ` (${t.provider} ${event.reference}, attempt ${past.attempt})`;
          const note = t.state === "settled"
            ? `The payout provider paid the seller for an earlier attempt too${ref}: the seller was paid twice; recover the difference.`
            : paidAfterAll("review", ref);
          await ctx.tx.update(memberPayouts).set({ state: "review", note }).where(eq(memberPayouts.id, t.payoutId));
        }
        applied++;
        continue;
      }
      if (t.state === "settled") continue;
      const reference = t.reference ?? event.reference;
      if (event.state === "settled") {
        await ctx.tx.update(memberPayoutTransfers).set({ state: "settled", reference, lastError: null, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
        await settle(ctx, t, reference);
      } else if (event.state === "unclaimed") {
        // PayPal holds the money for the seller to claim (up to 30 days):
        // neither paid nor dead, and never resent while it can be claimed.
        await ctx.tx.update(memberPayoutTransfers).set({ state: "unclaimed", reference, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
        await ctx.tx.update(memberPayouts).set({ note: `Waiting for the seller to claim this payment in ${t.provider}; it is returned if not claimed within 30 days.` }).where(eq(memberPayouts.id, t.payoutId));
      } else {
        // Dead at the provider: refused, returned or reversed — the money is back.
        await ctx.tx.update(memberPayoutTransfers).set({ state: "failed", reference, lastError: event.error ?? null, updatedAt: now }).where(eq(memberPayoutTransfers.id, t.id));
        await ctx.tx.update(memberPayouts).set({ state: "review", note: `The payout provider could not pay this (${event.error ?? "failed"}); mark it still owed to send it again.` }).where(and(eq(memberPayouts.id, t.payoutId), inArray(memberPayouts.state, ["due", "review"])));
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
        // Every retry of an attempt carries that attempt's key, so the
        // provider returns the first result instead of paying twice.
        const result = await provider.transfer({ externalAccountId: t.externalAccountId, amountMinor: t.amountMinor, currency: t.currency, idempotencyKey: attemptKey(t.payoutId, t.attempt), description: `Payout ${t.payoutId}` });
        outcome = { id: t.id, outcome: result.settled ? "settled" : "sent", reference: result.reference };
      } else {
        if (!t.reference) throw new AdapterError("payments", t.provider, "invalid_request", "There is no transfer to reverse.");
        const result = await provider.reverse({ reference: t.reference, amountMinor: t.amountMinor, currency: t.currency, idempotencyKey: t.payoutId });
        outcome = "unsupported" in result ? { id: t.id, outcome: "unsupported", error: result.unsupported } : { id: t.id, outcome: "settled", reference: result.reference };
      }
    } catch (error) {
      // Only a plain refusal means nothing moved. A timeout, an outage, a 409
      // or an unreadable reply may have reached the provider: the retry
      // reuses the key, and the owner is told the outcome is unknown.
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
      // call under the same key returns the same transfer to record.
      failed++;
      console.error(`[payouts] could not record ${t.kind} ${t.id} from ${t.provider}`, error);
    }
  }
  return { sent, failed };
}

export default [payoutSetup, payoutSetupSource, applyPayoutAccount, startPayoutSetup, refreshPayoutAccount, claimProviderTransfers, applyProviderTransfer, applyPayoutWebhook];
