// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit public projection of a private original collection policy.
import { z } from "zod";
import { ERASED_MERCHANT_ID, ERASED_MERCHANT_NAME, publicMerchantSupport } from "@/core/commerce/merchant-identity";
import type { InvoiceMarketPolicy } from "./market-policy";

export const publicInvoiceIssuer=z.object({
  issuerName:z.string().min(1).max(200).nullable(),issuerIsMerchant:z.boolean(),issuerSupport:publicMerchantSupport.nullable(),
});
export function invoiceIssuer(policy:InvoiceMarketPolicy|null):z.infer<typeof publicInvoiceIssuer>{
  if(policy?.model!=="seller_merchant")return{issuerName:null,issuerIsMerchant:false,issuerSupport:null};
  // An erased or incomplete merchant never becomes a site-issued document.
  if(policy.sellerUserId===ERASED_MERCHANT_ID||policy.merchantName===ERASED_MERCHANT_NAME||!policy.merchantName?.trim())return{issuerName:null,issuerIsMerchant:true,issuerSupport:null};
  return{issuerName:policy.merchantName,issuerIsMerchant:true,issuerSupport:policy.merchantSupport};
}
