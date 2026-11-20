// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: no-reset review of declared candidate-only preserved histories.
import { readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { closeDb, db } from "@/core/db";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { BUYER_MONEY_ERASURE_JOB, buyerMoneyErasureInventory } from "@/modules/invoicing/buyer-money-erasure";
import { erasePaymentProviderCustomer } from "@/modules/invoicing/provider-erasure";
import { subscriptionMerchantScope } from "@/modules/subscriptions/merchant-scope-contract";
import { reconcileMerchantScheduleErasure } from "@/modules/subscriptions/provider-schedule-erasure";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "@/modules/subscriptions/schema";

const TABLES = [["public", "data_requests"], ["public", "data_request_artifacts"], ["public", "privacy_retention_exceptions"],
  ["public", "subscriptions"], ["public", "subscription_merchant_scopes"], ["public", "subscription_commercial_terms"],
  ["public", "subscription_provider_schedule_resources"], ["public", "subscription_provider_schedule_operations"],
  ["public", "subscription_provider_schedule_erasures"], ["public", "payment_methods"], ["public", "payment_provider_customers"],
  ["public", "job_idempotency_keys"], ["pgboss", "job"]] as const;
const hashRow = z.object({ schema: z.string(), table: z.string(), count: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const gold = z.object({ target: z.string(), hashes: z.array(hashRow).length(13), requests: z.array(z.object({ id: z.uuid() })).length(1),
  last: z.object({ hash: z.literal("881a7901abf41dc612081df422d6623370e0a68150421f61cc13e96664c43f7d") }),
  journal: z.array(z.object({ entries: z.literal(81), timestamp: z.literal("1793310000060") })).length(1) });
const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough();
const control = process.env.FREEHOLDER_BUYER_HISTORY_CONTROL;
if (control !== "legacy_customer" && control !== "missing_repair") throw new Error("Explicit preserved buyer control required.");
const kind = control === "legacy_customer" ? "localmode" : "missing";
const raw: unknown = JSON.parse(readFileSync(`/tmp/freeholder-current-buyer-recovery885-${kind}-clone.json`, "utf8"));
const golden = gold.parse(raw), goldenName = `freeholder_buyer_${kind}80_populated_before_v10_test_20261112`;
if (golden.target !== goldenName) throw new Error("The immutable original golden report names another database.");
const workUrl = new URL(process.env.TEST_DATABASE_URL ?? "invalid");
if (!new RegExp(`^/freeholder_buyer_${kind}80_review_(before|after)_v10_test_20261112$`).test(workUrl.pathname)
  || workUrl.hostname !== "127.0.0.1" || workUrl.port !== "55447" || workUrl.password) throw new Error("A NEW isolated review workclone is required.");
const evidence = process.env.FREEHOLDER_BUYER_HISTORY_EVIDENCE;
if (!evidence?.startsWith("/tmp/freeholder-buyer-history-") || !evidence.endsWith(".json")) throw new Error("Choose a new allowlisted local evidence path.");
const goldenUrl = new URL(workUrl); goldenUrl.pathname = `/${goldenName}`;
async function snapshot(url: string) {
  const connection = postgres(url, { max: 1, onnotice: () => {} });
  try { return await connection.begin("isolation level repeatable read read only", async tx => {
    const hashes: Array<z.infer<typeof hashRow>> = [];
    for (const [schema, table] of TABLES) {
      // Identifiers are the fixed thirteen-name list, never report/user input.
      const [row] = await tx.unsafe<Array<{ count: number; sha256: string }>>(`select count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') sha256 from "${schema}"."${table}" t`);
      hashes.push(hashRow.parse({ schema, table, ...row }));
    }
    const journal = await tx`select id,hash,created_at::text from drizzle.__drizzle_migrations order by created_at,id`;
    const columns = await tx`select table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema in ('public','drizzle') order by table_schema,table_name,ordinal_position`;
    const constraints = await tx`select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') order by n.nspname,c.relname,k.conname`;
    expect(journal).toHaveLength(81); expect(journal[80]?.hash).toBe(golden.last.hash);
    return { hashes, journal: [...journal], columns: [...columns], constraints: [...constraints] };
  }); } finally { await connection.end(); }
}
function context(name: string, id: string): JobExecutionContext { return { id, name, attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 120, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }
let before: Awaited<ReturnType<typeof snapshot>> | undefined;
let providerDeletes = 0, providerCalls = 0;

describe("preserved buyer recovery workclone", () => {
  beforeAll(async () => {
    const original = await snapshot(goldenUrl.href);
    expect(original.hashes).toEqual(golden.hashes);
    before = await snapshot(workUrl.href);
    expect(before).toEqual(original);
    // Every unexpected network path is refused. Only the explicitly injected
    // original Stripe factory below may observe a synthetic provider response.
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unintercepted provider I/O is forbidden in preserved-history review."); }));
    await ready();
    expect(await snapshot(workUrl.href)).toEqual(before);
  });
  afterAll(async () => {
    try {
      if (before) {
        const original = await snapshot(goldenUrl.href);
        expect(original).toEqual(before);
        const after = await snapshot(workUrl.href);
        expect(after.journal).toEqual(before.journal); expect(after.columns).toEqual(before.columns); expect(after.constraints).toEqual(before.constraints);
        const requests = await db().select({ id: dataRequests.id, status: dataRequests.status, fulfilledAt: dataRequests.fulfilledAt }).from(dataRequests);
        const resources = await db().select({ state: subscriptionProviderScheduleResources.state, recoveryPending: subscriptionProviderScheduleResources.recoveryPending }).from(subscriptionProviderScheduleResources);
        writeFileSync(evidence, JSON.stringify({ control, workDatabase: workUrl.pathname.slice(1), goldenDatabase: goldenName,
          original13Preserved: true, journalPreserved: true, domainSchemaPreserved: true, before: before.hashes, after: after.hashes, requests, resources, providerCalls, providerDeletes }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      }
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await stopJobs(); await closeDb(); }
  });

  it("reviews only the explicitly selected retained original buyer history", async () => {
    if (control === "legacy_customer") {
    const requestId = golden.requests[0]!.id;
    const [original] = await db().select({ parent: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources }).from(subscriptions)
      .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .innerJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id)).limit(1);
    if (!original?.resource.providerCustomerRef || !original.resource.providerSubscriptionRef) throw new Error("The original live provider resource is missing before the control.");
    const frozen = subscriptionMerchantScope.parse(original.scope);
    expect(original.parent.billingMode).toBe("manual"); expect(original.resource.state).toBe("active");
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    expect(erasureArtifactIsIntact(artifact)).toBe(true);
    const pending = receipt.parse(artifact?.body).outcomes.find(item => item.scope === "commerce.money")?.pendingJobs;
    expect(pending).toHaveLength(1);
    const job = await getJob(erasePaymentProviderCustomer.name, pending![0]!);
    if (!job) throw new Error("The actual retained original customer task was pruned before the control.");
    expect(job.data).toMatchObject({ requestId, originalJobId: job.id, providerCustomerRef: original.resource.providerCustomerRef,
      providerPlatformAccountId: frozen.providerPlatformAccountId, providerAccountId: frozen.chargeAccountId ?? "" });
    expect(job.data.buyerMoneyFinisherJobId).toBeUndefined();
    const customer = original.resource.providerCustomerRef;
    const factory = createStripePayments({ secretKey: "sk_preserved_buyer_fixture", webhookSecrets: ["whsec_preserved_buyer_fixture"], apiBase: "https://stripe.example.test",
      fetch: async (input, init = {}) => {
        providerCalls++;
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
        expect(url.origin).toBe("https://stripe.example.test"); expect(headers.get("stripe-account")).toBe(frozen.chargeAccountId);
        if (url.pathname === "/v1/account") return Response.json({ id: frozen.providerPlatformAccountId });
        if (url.pathname === `/v1/customers/${customer}`) {
          if (init.method === "DELETE") providerDeletes++;
          return Response.json({ id: customer, deleted: providerDeletes > 0 });
        }
        throw new Error(`Unexpected intercepted original provider path: ${url.pathname}`);
      } });
    vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(factory);
    const outcome = await erasePaymentProviderCustomer.handler(job.data, context(erasePaymentProviderCustomer.name, job.id))
      .then(value => ({ value }), (error: unknown) => ({ error }));
    expect(providerDeletes).toBe(0);
    expect(outcome).toHaveProperty("error");
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, requestId)))[0]?.status).toBe("in_progress");
    expect((await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, original.parent.id)))[0]?.state).toBe("active");
    return;
    }

    const requestId = golden.requests[0]!.id;
    const [cohort] = await db().select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.requestId, requestId));
    if (!cohort?.subscriptionId) throw new Error("The original buyer recovery cohort is missing before review.");
    const initialMoneyClaims = await db().select().from(jobIdempotencyKeys).where(eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB)).orderBy(jobIdempotencyKeys.id);
    expect(initialMoneyClaims).toHaveLength(1);
    expect(await getJob(BUYER_MONEY_ERASURE_JOB, initialMoneyClaims[0]!.jobId)).toBeNull();
    // Ordering selects an actual retained admission; elapsed time supplies no
    // absence/quiescence proof and no payload is manufactured from current IDs.
    const [claim] = await db().select({ jobId: jobIdempotencyKeys.jobId }).from(jobIdempotencyKeys).where(and(
      eq(jobIdempotencyKeys.jobName, reconcileMerchantScheduleErasure.name), sql`${jobIdempotencyKeys.idempotencyKey} like ${`schedule-erasure-evidence:${cohort.subscriptionId}:%`}`))
      .orderBy(desc(jobIdempotencyKeys.createdAt), desc(jobIdempotencyKeys.id)).limit(1);
    if (!claim) throw new Error("The actual retained restoration repair admission is missing.");
    const repair = await getJob(reconcileMerchantScheduleErasure.name, claim.jobId);
    if (!repair) throw new Error("The actual retained restoration repair payload is missing.");
    expect(repair.data.subscriptionId).toBe(cohort.subscriptionId);
    await expect(reconcileMerchantScheduleErasure.handler(repair.data, context(reconcileMerchantScheduleErasure.name, repair.id))).rejects.toMatchObject({ code: "conflict" });
    const [request] = await db().select().from(dataRequests).where(eq(dataRequests.id, requestId));
    expect(request).toMatchObject({ status: "in_progress", fulfilledAt: null });
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    expect(erasureArtifactIsIntact(artifact)).toBe(true);
    const agreement = receipt.parse(artifact?.body).outcomes.find(item => item.scope === "subscriptions.agreements");
    expect(agreement?.outcome).toBe("pending"); expect(agreement?.pendingJobs?.length).toBeGreaterThan(0);
    expect(await buyerMoneyErasureInventory.call({ requestId, subscriptionId: cohort.subscriptionId }, { kind: "system" })).toEqual({ ready: false });
    expect(await db().select().from(jobIdempotencyKeys).where(eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB)).orderBy(jobIdempotencyKeys.id)).toEqual(initialMoneyClaims);
    expect(await getJob(BUYER_MONEY_ERASURE_JOB, initialMoneyClaims[0]!.jobId)).toBeNull();
    expect(providerCalls).toBe(0); expect(providerDeletes).toBe(0);
  });
});
