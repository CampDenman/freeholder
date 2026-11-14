// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: exact PG timestamp text is required for full-row replay.
import {describe,expect,it} from "vitest";
import {atomicCreditInvoiceProjection,atomicCreditProrationProjection,atomicCreditSubscriptionProjection} from "@/modules/invoicing/atomic-credit-before-image-contract";
const invoiceId="00000000-0000-4000-8000-000000000001";
describe("exact PostgreSQL invoice projection preimage",()=>{
 it("retains actual PostgreSQL microseconds and offset rather than normalizing through JS Date",()=>{const value={invoiceId,creditedMinor:0,status:"sent",paidAt:null,updatedAt:"2026-11-14T09:31:27.123456+00:00"};expect(atomicCreditInvoiceProjection.parse(value)).toEqual(value);});
 it("retains an original nullable/non-null paid timestamp at full precision",()=>{const value={invoiceId,creditedMinor:4199,status:"paid",paidAt:"2026-11-14T01:31:27.987654-08:00",updatedAt:"2026-11-14T09:31:28.654321+00:00"};expect(atomicCreditInvoiceProjection.parse(value)).toEqual(value);});
 it("refuses an unlisted before-image field or an invalid timestamp instead of permitting arbitrary row subtraction",()=>{const value={invoiceId,creditedMinor:0,status:"sent",paidAt:null,updatedAt:"2026-11-14T09:31:27.123456+00:00"};expect(atomicCreditInvoiceProjection.safeParse({...value,paidMinor:0}).success).toBe(false);expect(atomicCreditInvoiceProjection.safeParse({...value,updatedAt:"today"}).success).toBe(false);});
 it("keeps the real pending-plan and queued-task descriptor shapes without admitting other owner columns",()=>{const subscription={subscriptionId:invoiceId,pendingPlanId:null,updatedAt:"2026-11-14T09:31:27.123456+00:00"},proration={prorationId:invoiceId,originalJobId:null,jobClaimDigest:null,originalTask:null,state:"accepted"};
  expect(atomicCreditSubscriptionProjection.parse(subscription)).toEqual(subscription);expect(atomicCreditProrationProjection.parse(proration)).toEqual(proration);
  expect(atomicCreditSubscriptionProjection.safeParse({...subscription,currentPeriodEnd:"2027-01-01T00:00:00Z"}).success).toBe(false);expect(atomicCreditProrationProjection.safeParse({...proration,acceptedQuoteDigest:"a".repeat(64)}).success).toBe(false);});
});
