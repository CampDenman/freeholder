// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ordinary concrete commercial DTOs; no service registry or I/O dependency.
import { z } from "zod";
import { publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { subscriptionTaxDestination } from "./merchant-scope-contract";
import { subscriptionCommercialSnapshot,subscriptionInitialTaxQuote } from "./merchant-terms-contract";
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const merchantQuoteProfileReceipt = z.object({ profileId: z.uuid(), profileVersion: z.number().int().positive(), liability: z.enum(["platform", "seller"]) });
export const merchantTermsQuoteInput = z.object({ planId: z.uuid(), contactId: z.uuid(), productVariantId: z.uuid().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), taxDestination: subscriptionTaxDestination,
  paymentMethodId: z.uuid().optional(), deferFirstPayment: z.boolean().default(false), locale: z.enum(["en", "es", "fr", "ar"]).default("en") }).strict();
export const merchantTermsQuoteOutput = z.object({ planId: z.uuid(), contactId: z.uuid(), snapshot: subscriptionCommercialSnapshot,
  issuer: z.object({ name: z.string(), support: publicMerchantSupport.nullable() }),
  profile: merchantQuoteProfileReceipt,
  siteFeeBps: z.number().int().min(0).max(10000),
  route: z.object({ collectionKind: z.enum(["direct", "destination"]), providerPlatformAccountId: account, chargeAccountId: account.nullable(),
    recipientAccountId: account, settlementMerchantAccountId: account }),
  taxDestination: subscriptionTaxDestination,
  initialTaxQuote: subscriptionInitialTaxQuote, firstPeriodTaxQuote: subscriptionInitialTaxQuote, renewalTaxQuote: subscriptionInitialTaxQuote,
  quoteOccurredAt: z.date(), quoteDigest: z.string().regex(/^[a-f0-9]{64}$/), noticeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  noticeSnapshot: z.object({ locale: z.enum(["en", "es", "fr", "ar"]), text: z.string().min(1) }),
}).nullable();
export const publicMerchantTermsQuote = merchantTermsQuoteOutput.unwrap().pick({ planId: true, snapshot: true, issuer: true,
  initialTaxQuote: true, firstPeriodTaxQuote: true, renewalTaxQuote: true, quoteDigest: true, noticeDigest: true, noticeSnapshot: true }).nullable();

