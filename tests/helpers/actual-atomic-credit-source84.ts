// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real services and HTTP facts; no synthetic context or row fill.
//
// COST, measured 2026-11-18 on a tmpfs PostgreSQL 16 with fsync off. This
// fixture takes ~61s, and four single service calls are 44s of it:
//
//   13811ms  quoteControlledProration         (1 call)
//   12345ms  applyControlledCashReceipts      (1 call)
//   10158ms  returnOriginalCash               (1 call)
//    8140ms  reconcileMerchantApplicationFee  (1 call)
//     3367ms completePaidControlledPeriod     (3 calls)
//     3229ms inspectControlledCashReceipt     (5 calls)
//
// For contrast, in the same run `ready()` was 1.1s and `truncateSpine` 274ms,
// so neither boot nor the 601-table reset is what costs anything here.
//
// This is why `atomic-credit-fee-persistence84` and
// `atomic-credit-stage-profile89` -- the only two suites that use this fixture
// -- time out in CI while passing locally. `.github/workflows/ci.yml` records
// that a hosted runner executes DB-backed files at a measured 6.7x degraded
// rate, which puts this fixture alone at ~409s per test there, above the 180s
// ceiling before a single assertion runs. Raising the ceiling cannot fix it:
// three tests at that cost exceed the job's 25-minute budget, which is why
// C11.13 added shards instead of raising timeouts.
//
// WHERE the time goes, measured the same day with the server logging every
// statement for this database alone. Building this fixture once issues
//
//   236,252 statements in 857 transactions, 32.3s of server time in 61s wall
//
// and NOT ONE of them exceeds 900ms. Nothing here is a slow query; the cost is
// the number of round trips. The single most repeated shape is a per-row
// lookup of one resource by id:
//
//   4156x  WITH actual_resource AS MATERIALIZED(
//            SELECT r.id FROM subscription_controlled_resources r WHERE r.id=$1::uuid)
//   2189x  select ... from subscription_controlled_... by id
//   1352x  three further per-row lookups, each exactly 1352 times
//
// That is an N+1 in the controlled-provider money path, not a test artefact:
// the same services answer a customer's proration quote, and
// quoteControlledProration alone is 13.8s of the 61s here. Whoever takes this
// on should start from the 4156 lookups, since a single id repeated that often
// is a cache or a join that was never made.
//
// So the fix is to make those four services cheaper, or to stop rebuilding
// the whole fixture per test. Please do not "fix" this by relaxing a timeout.
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {stopJobs} from "@/core/jobs";
import {invoices,payments} from "@/modules/invoicing/schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {completePaidControlledPeriod} from "@/modules/subscriptions/controlled-provider-paid-period";
import {inspectControlledCashReceipt} from "@/modules/invoicing/controlled-cash-inspection-service";
import {applyControlledCashReceipts} from "@/modules/invoicing/controlled-cash-application-service";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {merchantRefundRequests} from "@/modules/invoicing/merchant-refund-schema";
import {reconcileMerchantRefundCurrentState} from "@/modules/invoicing/merchant-refund-current-service";
import {returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {reconcileMerchantApplicationFee} from "@/modules/invoicing/merchant-fee-service";
import {createListing} from "@/modules/members/listings";
import {getProductVariants} from "@/modules/catalog/variants";
import {savePlan} from "@/modules/subscriptions/service";
import {quoteControlledProration} from "@/modules/subscriptions/controlled-provider-proration-quote";
import type {actualControlledPeriod84} from "./actual-controlled-period84";
import {actualControlledOpenInvoice84} from "./actual-controlled-open-invoice84";
import {retainActualControlledManifest84} from "./actual-controlled-current-manifest84";
import {OWNER} from "./spine";
const system={kind:"system"} as const;
export async function actualAtomicCreditSource84(f:Awaited<ReturnType<typeof actualControlledPeriod84>>){
 const open=await actualControlledOpenInvoice84(f);
 f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
 const collected=await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER);
 if(collected.state!=="money_retained"||collected.applied!==false)throw Error("Preserve the actual producer-only money-retained boundary.");
 await retainActualControlledManifest84(f);
 const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));
 if(receipts.length!==2)throw Error("Retain the two genuine independent original PIs, never an amount alias.");
 for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER);
 const applied=await applyControlledCashReceipts.call({collectionId:f.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system);
 if(applied.outstandingMinor!==0)throw Error("Use the complete actual 4199+1 canonical settlement first.");
 // Access changes only in the real independent post-money effect transaction.
 const effect=await completePaidControlledPeriod.call({invoiceId:f.target.invoiceId},system);if(!["applied","already_applied"].includes(effect.state))throw Error("Use the genuine accepted current period, never a rewritten parent.");
 await stopJobs();
 const cash=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId)),big=cash.find(row=>row.amountMinor===4199),tiny=cash.find(row=>row.amountMinor===1);
 if(!big||!tiny)throw Error("Resolve actual retained receipt-owned canonical cash.");
 const returned=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Actual B sibling-only principal return",idempotencyKey:`atomic-B-tiny:${tiny.id}`},OWNER);
 const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,returned.id));if(!request)throw Error("Retain the genuine original refund owner.");
 await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
 await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER);
 for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER);
 const fee=await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER);if(fee.state!=="accepted"||fee.operation?.amountMinor!==1)throw Error("The original fee400 must genuinely return exactly1 before a current399 source is usable.");
 const original=receipts.find(row=>row.providerPaymentIntentRef===big.providerRef);if(!original)throw Error("Keep exact original fee/PI ownership.");
 await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:original.id},OWNER);
 const period=f.remote.advanceToPaidInvoicePeriod(open.providerInvoiceRef);
 const[invoice]=await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId));
 if(!invoice||invoice.refundedMinor!==1||invoice.paidMinor!==4200)throw Error("Retain the actual fully accounted sibling refund in the original invoice.");
 const seller=f.original.fixture.sellers[0];if(!seller)throw Error("Keep the actual original merchant.");
 const listing=await createListing.call({title:"Actual B original-epoch new NET day",kind:"digital",price:"60",acceptPolicy:true},seller),variant=(await getProductVariants.call({productId:listing.productId},OWNER)).variants[0];
 if(!variant)throw Error("Use the actual offered new product variant.");
 const plan=await savePlan.call({productId:listing.productId,name:"Actual B accepted NET day",interval:"day",intervalCount:1,billingMode:"provider",proration:"create_prorations",status:"active"},OWNER);
 const effectiveAt=new Date((Math.floor(Date.now()/1000)+600)*1000);if(effectiveAt>=period.periodEnd)throw Error("Use an actual still-unused current period.");
 const review=await quoteControlledProration.call({id:f.parent.id,resourceId:f.review.controlled.resourceId,planId:plan.id,productVariantId:variant.id,effectiveAt:effectiveAt.toISOString(),taxDestination:{country:"CA",region:"BC"},locale:"en"},OWNER);
 return{big,tiny,receipts,review,input:{quoteId:review.controlled.quoteId,resourceId:review.controlled.resourceId,previousTermsId:review.previousTermsId,acceptedQuoteDigest:review.quoteDigest,confirm:true as const}};
}
