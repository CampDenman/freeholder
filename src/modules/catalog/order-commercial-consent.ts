// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: public preview and source capture bind the same actual business terms.
import {z} from "zod";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
export const currentOrderCommercialTerms=z.object({model:z.enum(["hold","instant","seller_merchant"]),adapter:z.string().min(1).max(100),siteFeeBps:z.number().int().min(0).max(10000),holdDays:z.number().int().min(0).max(365),collectionKind:z.enum(["direct","destination"]).nullable(),providerPlatformAccountId:z.string().min(1).nullable(),sellers:z.array(z.object({sellerUserId:z.uuid().nullable(),merchantContactId:z.uuid().nullable(),merchantName:z.string().min(1).max(200).nullable(),merchantSupport:publicMerchantSupport.nullable(),recipientAccountId:z.string().min(1).nullable()})).max(1000)});
export function orderCommercialConsentDigest(input:z.infer<typeof currentOrderCommercialTerms>){const terms=currentOrderCommercialTerms.parse(input);return merchantTaxDigest({version:1,...terms,sellers:[...terms.sellers].sort((a,b)=>(a.sellerUserId??"").localeCompare(b.sellerUserId??""))});}
