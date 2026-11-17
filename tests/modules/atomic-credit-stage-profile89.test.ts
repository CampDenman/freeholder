// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// Diagnostic only: time the genuine payment stages without changing the original oracle.
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from "vitest";
import { defineService } from "@/core/service";
import { invoiceCreditFunding } from "@/modules/invoicing/credit-application-schema";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { acceptControlledProration } from "@/modules/subscriptions/controlled-provider-proration-acceptance";
import * as journal from "@/modules/subscriptions/controlled-provider-proof";
import * as economics from "@/modules/subscriptions/controlled-provider-proration-economics";
import * as declaration from "@/modules/invoicing/atomic-credit-fee-declaration";
import * as retention from "@/modules/subscriptions/proration-service";
import * as canonicalTarget from "@/modules/subscriptions/controlled-provider-canonical-target";
import * as collectionState from "@/modules/subscriptions/controlled-provider-collection-state";
import * as cashlessState from "@/modules/subscriptions/controlled-provider-cashless-state";
import * as collectionOrchestration from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import * as cashInspection from "@/modules/invoicing/controlled-cash-inspection-service";
import * as cashApplication from "@/modules/invoicing/controlled-cash-application-service";
import * as paidPeriod from "@/modules/subscriptions/controlled-provider-paid-period";
import * as providerPayments from "@/modules/invoicing/payment-provider-service";
import * as refundCurrent from "@/modules/invoicing/merchant-refund-current-service";
import * as cashRecovery from "@/modules/invoicing/original-cash-recovery";
import * as merchantFee from "@/modules/invoicing/merchant-fee-service";
import * as prorationQuote from "@/modules/subscriptions/controlled-provider-proration-quote";
import * as disposition from "@/modules/invoicing/atomic-credit-invoice-disposition";
import * as feePartition from "@/modules/invoicing/atomic-credit-fee-partition";
import * as prorationBasis from "@/modules/subscriptions/proration-basis";
import * as principalAuthority from "@/modules/invoicing/principal-authority";
import * as feeAncestry from "@/modules/invoicing/atomic-credit-fee-ancestry";
import * as financialParent from "@/modules/invoicing/controlled-provider-financial-parent";
import * as collectionReadiness from "@/modules/subscriptions/controlled-provider-readiness";
import * as providerPlan from "@/modules/subscriptions/controlled-provider-plan";
import * as providerExecution from "@/modules/subscriptions/controlled-provider-execution";
import * as previewPlan from "@/modules/subscriptions/controlled-provider-preview-plan";
import * as fundingRetainer from "@/modules/invoicing/atomic-credit-fee-partition-retain";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { actualAtomicCreditSource84 } from "../helpers/actual-atomic-credit-source84";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const caughtAcceptance = defineService({
  name: "subscriptions.testCaughtAtomicCreditPurposeBirth", summary: "Exercise the actual caught child-writer fault.", kind: "mutation", permission: "system", external: false,
  input: acceptControlledProration.def.input, output: z.literal(true), handler: async (input, ctx) => {
    try { await ctx.callAsSystem(acceptControlledProration, input); } catch (error) {
      if (!(error instanceof Error) || error.message !== "Deliberate B purpose writer refusal") throw error;
    }
    return true as const;
  },
});
const metrics = new Map<string, { count: number; total: number; max: number }>();
async function measure<T extends unknown[], R>(name: string, call: (...args: T) => Promise<R>, args: T): Promise<R> {
  const started = performance.now();
  try { return await call(...args); } finally {
    const elapsed = performance.now() - started, current = metrics.get(name) ?? { count: 0, total: 0, max: 0 };
    current.count++; current.total += elapsed; current.max = Math.max(current.max, elapsed); metrics.set(name, current);
  }
}
function report() {
  for (const [name, value] of [...metrics].sort((a, b) => b[1].total - a[1].total)) console.log(`PAYMENT_CALL ${name} count=${value.count} total=${value.total.toFixed(1)}ms max=${value.max.toFixed(1)}ms`);
  metrics.clear();
}

describe.runIf(hasDatabase)("payment stage timing diagnostic", () => {
  let fixture: Awaited<ReturnType<typeof actualControlledPeriod84>> | undefined;
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterEach(() => { report(); vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("reports the real stages", { timeout: 240000 }, async () => {
    const calls = {
      journal: journal.controlledProviderJournal,
      economics: economics.prepareControlledProrationEconomics,
      declaration: declaration.assertAtomicCreditFeeDeclarationCurrent,
      retention: retention.retainAcceptedGrossProration,
      canonical: canonicalTarget.controlledCanonicalTarget,
      collection: collectionState.controlledCollectionState,
      cashless: cashlessState.controlledCashlessCollectionState,
      collect: collectionOrchestration.collectControlledCollection.call.bind(collectionOrchestration.collectControlledCollection),
      inspect: cashInspection.inspectControlledCashReceipt.call.bind(cashInspection.inspectControlledCashReceipt),
      apply: cashApplication.applyControlledCashReceipts.call.bind(cashApplication.applyControlledCashReceipts),
      complete: paidPeriod.completePaidControlledPeriod.call.bind(paidPeriod.completePaidControlledPeriod),
      refund: providerPayments.submitProviderRefund.call.bind(providerPayments.submitProviderRefund),
      reconcileRefund: refundCurrent.reconcileMerchantRefundCurrentState.call.bind(refundCurrent.reconcileMerchantRefundCurrentState),
      returnCash: cashRecovery.returnOriginalCash.call.bind(cashRecovery.returnOriginalCash),
      reconcileFee: merchantFee.reconcileMerchantApplicationFee.call.bind(merchantFee.reconcileMerchantApplicationFee),
      quote: prorationQuote.quoteControlledProration.call.bind(prorationQuote.quoteControlledProration),
      disposition: disposition.readAtomicCreditInvoiceDisposition,
      partition: feePartition.controlledAtomicCreditFeePartition,
      basis: prorationBasis.paidProrationBasis,
      principal: principalAuthority.readOriginalPrincipalAndDebt,
      ancestry: feeAncestry.readAtomicCreditFeeAncestry,
      parent: financialParent.parentFinancialGraphForTx,
      readiness: collectionReadiness.controlledCollectionReadiness,
      plan: providerPlan.planControlledProviderOperation.call.bind(providerPlan.planControlledProviderOperation),
      execute: providerExecution.executeControlledOperation,
      preview: previewPlan.planControlledProrationPreview.call.bind(previewPlan.planControlledProrationPreview),
      retainQuote: prorationQuote.retainControlledProrationQuote.call.bind(prorationQuote.retainControlledProrationQuote),
    };
    vi.spyOn(journal, "controlledProviderJournal").mockImplementation((...args) => {
      const frame = new Error().stack?.split("\n").map(line => line.match(/src\/[a-zA-Z0-9/_-]+\.ts:\d+:\d+/)?.[0])
        .find(location => location && location !== "src/modules/subscriptions/controlled-provider-proof.ts");
      return measure(`controlledProviderJournal ${frame ?? "unknown"}`, calls.journal, args);
    });
    vi.spyOn(economics, "prepareControlledProrationEconomics").mockImplementation((...args) => measure("prepareControlledProrationEconomics", calls.economics, args));
    vi.spyOn(declaration, "assertAtomicCreditFeeDeclarationCurrent").mockImplementation((...args) => measure("assertAtomicCreditFeeDeclarationCurrent", calls.declaration, args));
    vi.spyOn(retention, "retainAcceptedGrossProration").mockImplementation((...args) => measure("retainAcceptedGrossProration", calls.retention, args));
    vi.spyOn(canonicalTarget, "controlledCanonicalTarget").mockImplementation((...args) => measure("controlledCanonicalTarget", calls.canonical, args));
    vi.spyOn(collectionState, "controlledCollectionState").mockImplementation((...args) => measure("controlledCollectionState", calls.collection, args));
    vi.spyOn(cashlessState, "controlledCashlessCollectionState").mockImplementation((...args) => measure("controlledCashlessCollectionState", calls.cashless, args));
    vi.spyOn(collectionOrchestration.collectControlledCollection, "call").mockImplementation((...args) => measure("collectControlledCollection", calls.collect, args));
    vi.spyOn(cashInspection.inspectControlledCashReceipt, "call").mockImplementation((...args) => measure("inspectControlledCashReceipt", calls.inspect, args));
    vi.spyOn(cashApplication.applyControlledCashReceipts, "call").mockImplementation((...args) => measure("applyControlledCashReceipts", calls.apply, args));
    vi.spyOn(paidPeriod.completePaidControlledPeriod, "call").mockImplementation((...args) => measure("completePaidControlledPeriod", calls.complete, args));
    vi.spyOn(providerPayments.submitProviderRefund, "call").mockImplementation((...args) => measure("submitProviderRefund", calls.refund, args));
    vi.spyOn(refundCurrent.reconcileMerchantRefundCurrentState, "call").mockImplementation((...args) => measure("reconcileMerchantRefundCurrentState", calls.reconcileRefund, args));
    vi.spyOn(cashRecovery.returnOriginalCash, "call").mockImplementation((...args) => measure("returnOriginalCash", calls.returnCash, args));
    vi.spyOn(merchantFee.reconcileMerchantApplicationFee, "call").mockImplementation((...args) => measure("reconcileMerchantApplicationFee", calls.reconcileFee, args));
    vi.spyOn(prorationQuote.quoteControlledProration, "call").mockImplementation((...args) => measure("quoteControlledProration", calls.quote, args));
    vi.spyOn(disposition, "readAtomicCreditInvoiceDisposition").mockImplementation((...args) => measure("readAtomicCreditInvoiceDisposition", calls.disposition, args));
    vi.spyOn(feePartition, "controlledAtomicCreditFeePartition").mockImplementation((...args) => measure("controlledAtomicCreditFeePartition", calls.partition, args));
    vi.spyOn(prorationBasis, "paidProrationBasis").mockImplementation((...args) => measure("paidProrationBasis", calls.basis, args));
    vi.spyOn(principalAuthority, "readOriginalPrincipalAndDebt").mockImplementation((...args) => measure("readOriginalPrincipalAndDebt", calls.principal, args));
    vi.spyOn(feeAncestry, "readAtomicCreditFeeAncestry").mockImplementation((...args) => measure("readAtomicCreditFeeAncestry", calls.ancestry, args));
    vi.spyOn(financialParent, "parentFinancialGraphForTx").mockImplementation((...args) => measure("parentFinancialGraphForTx", calls.parent, args));
    vi.spyOn(collectionReadiness, "controlledCollectionReadiness").mockImplementation((...args) => measure("controlledCollectionReadiness", calls.readiness, args));
    vi.spyOn(providerPlan.planControlledProviderOperation, "call").mockImplementation((...args) => measure("planControlledProviderOperation", calls.plan, args));
    vi.spyOn(providerExecution, "executeControlledOperation").mockImplementation((...args) => measure("executeControlledOperation", calls.execute, args));
    vi.spyOn(previewPlan.planControlledProrationPreview, "call").mockImplementation((...args) => measure("planControlledProrationPreview", calls.preview, args));
    vi.spyOn(prorationQuote.retainControlledProrationQuote, "call").mockImplementation((...args) => measure("retainControlledProrationQuote", calls.retainQuote, args));
    const retainFunding = fundingRetainer.retainAtomicCreditFundingPartition;
    vi.spyOn(fundingRetainer, "retainAtomicCreditFundingPartition").mockImplementation(async (ctx, input) => {
      if (process.env.PAYMENT_PROFILE_FAULT) {
        const [parent] = await ctx.tx.select({ id: invoiceCreditFunding.id }).from(invoiceCreditFunding).where(eq(invoiceCreditFunding.id, input.fundingId));
        console.log(`PAYMENT_FAULT_PARENT ${parent?.id ?? "missing"}`);
        throw Error("Deliberate B purpose writer refusal");
      }
      const candidate = input.candidate;
      const rows = await ctx.tx.execute<{ table: string; id: string; fingerprint: string }>(sql`
       WITH current_scope AS(SELECT freeholder_controlled_cash_scope(${candidate.owner.collectionId}::uuid) AS value),physical AS(
        SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(${candidate.owner.collectionId}::uuid) current_entry
        UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions purpose WHERE purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids((SELECT value FROM current_scope),'payments'))
        UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions purpose WHERE purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids((SELECT value FROM current_scope),'payments'))
        UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids((SELECT value FROM current_scope),'payments'))
       ) SELECT family AS "table",identity AS id,min(fingerprint) AS fingerprint FROM physical GROUP BY family,identity`);
      const actual = new Map(rows.map(row => [`${row.table}:${row.id}`, row.fingerprint]));
      const expected = new Map(candidate.beforeEntries.map(row => [row.key, row.postgres_row ?? row.schedule_stable ?? row.dependency_canonical ?? null]));
      const keys = [...new Set([...actual.keys(), ...expected.keys()])].sort();
      const differences = keys.filter(key => actual.get(key) !== expected.get(key)).map(key => ({ key, actual: actual.get(key), expected: expected.get(key) }));
      if (differences.length) console.log(`PAYMENT_PHYSICAL_DIFF ${JSON.stringify(differences)}`);
      return retainFunding(ctx, input);
    });
    let started = performance.now();
    const stage = (name: string) => {
      const now = performance.now();
      console.log(`PAYMENT_STAGE ${name} ${(now - started).toFixed(1)}ms`);
      started = now; report();
    };
    fixture = await actualControlledPeriod84({ prorationPreview6000: true });
    stage("actualControlledPeriod84");
    const source = await actualAtomicCreditSource84(fixture);
    stage("actualAtomicCreditSource84");
    if (process.env.PAYMENT_PROFILE_SOURCE_ONLY) return;
    try {
      if (process.env.PAYMENT_PROFILE_FAULT) console.log("PAYMENT_FAULT_RESULT", await caughtAcceptance.call(source.input, { kind: "system" }));
      else await acceptControlledProration.call(source.input, OWNER);
    } catch (error) {
      if (error instanceof Error) console.log("PAYMENT_ERROR", JSON.stringify(Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, Reflect.get(error, key)]))));
      throw error;
    }
    stage("acceptControlledProration");
  });
});
