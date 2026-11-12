// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: only deliberately public commercial contact details belong on documents.
import { z } from "zod";

const line=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value));
export const publicMerchantAddress=z.object({
  line1:line(200),line2:line(200).nullable(),city:line(100).nullable(),state:line(100).nullable(),postalCode:line(40).nullable(),country:z.string().regex(/^[A-Z]{2}$/),
});
export const publicMerchantSupport=z.object({
  email:z.string().trim().email().max(254).nullable(),
  phone:line(60).nullable(),
  url:line(2048).refine(value=>{try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}).nullable(),
  address:publicMerchantAddress.nullable(),
}).refine(value=>Boolean(value.email||value.phone||value.url||value.address));
export type PublicMerchantSupport=z.infer<typeof publicMerchantSupport>;

/** Existing anonymous sales owner; a public document must never fall back to site branding after erasure. */
export const ERASED_MERCHANT_ID="00000000-0000-4000-8000-00000000e5ed";
export const ERASED_MERCHANT_NAME="[privacy-erased-merchant]";
