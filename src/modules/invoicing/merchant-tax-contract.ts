// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit declarations and immutable business-calculation evidence.
import { z } from "zod";
import { ServiceError } from "@/core/service";

export const merchantTaxAddress = z.object({
  country:z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  region:z.string().trim().toUpperCase().max(100).optional(),
  postalCode:z.string().trim().toUpperCase().max(30).optional(),
  city:z.string().trim().max(200).optional(),
});
export const merchantTaxPolicyReceipt = z.object({
  liability:z.enum(["platform","seller"]),profileId:z.uuid(),
  profileVersion:z.number().int().positive(),evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/),
});
const taxDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number(value.slice(0,4))>0&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
});
export const merchantTaxRegistrationInput = z.object({
  zoneId:z.uuid(),number:z.string().trim().min(1).max(200).nullable().default(null),
  scheme:z.enum(["standard","oss","ioss","simplified"]).default("standard"),
  status:z.enum(["monitoring","active","paused","closed"]).default("monitoring"),
  collectsFrom:taxDate.nullable().default(null),
  thresholdMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  thresholdCurrency:z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  /** Explicit authorization: never activate another jurisdiction's tax. */
  rateIds:z.array(z.uuid()).min(1).max(1000),
  configurationDigest:z.string().regex(/^[a-f0-9]{64}$/),
});
export const merchantTaxRuleSnapshot = z.object({
  zone:z.object({
    id:z.uuid(),name:z.string(),country:z.string().regex(/^[A-Z]{2}$/),regions:z.array(z.string()),postalPatterns:z.array(z.string()),
    priority:z.number().int(),basis:z.enum(["origin","destination"]),pricesIncludeTax:z.boolean(),
    roundingScope:z.enum(["line","invoice"]),roundingMode:z.enum(["half_up","bankers"]),
  }),
  registrations:z.array(merchantTaxRegistrationInput.extend({id:z.uuid()})).min(1).max(100),
  rates:z.array(z.object({
    id:z.uuid(),name:z.string(),jurisdiction:z.string(),ratePpm:z.number().int().min(0).max(10_000_000),
    compound:z.boolean(),priority:z.number().int(),appliesToShipping:z.boolean(),categoryCode:z.string().nullable(),
    active:z.boolean(),effectiveFrom:z.string().nullable(),effectiveTo:z.string().nullable(),
  })).max(1000),
});
export type MerchantTaxRuleSnapshot=z.infer<typeof merchantTaxRuleSnapshot>;
export class MerchantTaxLocationError extends ServiceError {
  constructor(readonly field:"region"|"postalCode",readonly side:"origin"|"destination",message="The declared merchant tax policy needs a more complete transaction location."){
    super("validation",message);
  }
}
