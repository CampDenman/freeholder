// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Finished current bank evidence is distinct from application or returned money.
import { eq } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
import { cashInspectionSource } from "./merchant-cash-inspection-evidence";
import { originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { originalCashInspectionBankFacts } from "./merchant-cash-inspection-bank-facts";
import { merchantTaxDigest } from "./merchant-tax-store";
/** Existing strict defaults: a changed namespace needs a genuine new admitted
 * GET. No returned disposition, public context override or principal authority.
 * The separate controlled observational reader never changes these predicates. */
export async function currentOriginalCashInspection(ctx:ServiceContext,input:{inspectionId:string;observationId?:string}){
 const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1);if(!inspection)return null;
 const cash=await originalMerchantRefundCash(ctx,cashInspectionSource(inspection)),history=await merchantRefundCashHistory(ctx,cash,inspection.id);
 const current=await originalCashInspectionBankFacts(ctx.tx,inspection,cash,input.observationId);
 if(!current||cash.applied||history.incomplete||!history.creatorsQuiesced||history.inventoryCount+current.own.primary.length+current.own.observations.length+current.own.refunds.length+2>5000||history.digest!==inspection.sourceHistoryDigest)return null;
 return{...current,history,revision:merchantTaxDigest({inspection,source:current.source,cash,ownEvidenceDigest:current.own.digest,observation:current.observation,finish:current.finish,currentSourceHistoryDigest:history.digest})};
}
