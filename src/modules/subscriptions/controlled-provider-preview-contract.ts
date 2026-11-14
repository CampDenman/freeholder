// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
const reference=z.string().min(1).max(200),signed=z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const controlledActualPreview=z.object({providerPreviewRef:reference,providerSubscriptionRef:reference,providerCustomerRef:reference,currency:z.string().regex(/^[A-Z]{3}$/),subtotalMinor:signed,totalMinor:signed,amountDueMinor:signed,
 prorationAt:z.iso.datetime(),requestedAnchor:z.literal("unchanged"),requestedProrationBehavior:z.enum(["create_prorations","none"]),actualInvoicePeriodStart:z.iso.datetime(),actualInvoicePeriodEnd:z.iso.datetime(),
 originalAnchor:z.iso.datetime(),trialPolicy:z.literal("preserve_original_end"),originalTrialEnd:z.iso.datetime().nullable(),
 actualLines:z.array(z.object({providerLineRef:reference,amountMinor:signed,periodStart:z.iso.datetime(),periodEnd:z.iso.datetime(),proration:z.boolean(),component:z.enum(["principal","merchant_declared_tax_collection"]),raw:z.record(z.string(),z.unknown())}).strict()).max(1000),
 actualRaw:z.record(z.string(),z.unknown()),suppliesPaidAuthority:z.literal(false),sealedTaxIncluded:z.boolean()}).strict();
