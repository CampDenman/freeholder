// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plain serialized exact bank DTOs. No public request accepts these money fields.
import { z } from "zod";
const sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),reference=z.string().min(1).max(200);
const original={bootstrapOperationId:z.uuid(),bootstrapRequestDigest:sha,providerSubscriptionRef:reference};
export const controlledCalendarPayload=z.object({...original,
 originalComponents:z.array(z.object({kind:z.literal("principal"),subscriptionItemRef:reference,providerPriceRef:reference,providerProductRef:reference,amountMinor:minor,interval:z.enum(["day","week","month","year"]).optional(),intervalCount:z.number().int().positive().optional(),
  actualPeriodStart:z.iso.datetime(),actualPeriodEnd:z.iso.datetime(),taxQuoteDigest:sha,profileId:z.uuid(),profileVersion:z.number().int().positive()}).strict()).length(1),
 originalAnchor:z.iso.datetime(),originalProviderTrialEnd:z.iso.datetime().nullable(),originalPeriodStart:z.iso.datetime(),originalPeriodEnd:z.iso.datetime(),prorationAt:z.iso.datetime(),currentReadDigest:sha,
 target:z.object({providerProductRef:reference,principalMinor:minor,interval:z.enum(["day","week","month","year"]),intervalCount:z.number().int().positive()}).strict(),
 taxComponent:z.object({providerProductRef:reference,amountMinor:minor,periodStart:z.iso.datetime(),periodEnd:z.iso.datetime(),taxQuoteDigest:sha,profileId:z.uuid(),profileVersion:z.number().int().positive()}).strict().nullable(),
}).strict();
export const controlledManifestComponent=z.object({id:z.uuid(),position:z.number().int().nonnegative(),kind:z.enum(["net","merchant_declared_tax_collection","locked_canonical_credit"]),
 amountMinor:z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),providerProductRef:reference.optional(),periodStart:z.iso.datetime(),periodEnd:z.iso.datetime(),provenanceDigest:sha,
 taxQuoteDigest:sha.optional(),profileId:z.uuid().optional(),profileVersion:z.number().int().positive().optional(),creditNoteId:z.uuid().optional(),applicationIds:z.array(z.uuid()).max(1000).optional()}).strict();
export const controlledCollectionManifest=z.object({protocol:z.literal("controlled_net_gross.v1"),collectionId:z.uuid(),quoteId:z.uuid(),canonicalInvoiceId:z.uuid(),termsId:z.uuid(),acceptedQuoteDigest:sha,canonicalTargetDigest:sha,
 currency:z.string().regex(/^[A-Z]{3}$/),grossMinor:minor,creditedMinor:minor,cashDueMinor:minor,applicationFeeMinor:minor,components:z.array(controlledManifestComponent).min(1).max(250)}).strict();
export const controlledCollectionPayload=z.object({...original,manifest:controlledCollectionManifest,calendar:controlledCalendarPayload,
 // Null creator is legal only for the new create operation itself. Its actual
 // UUID/request SHA are injected from the immutable admitted op, avoiding an
 // impossible request-digest self-reference. All later operations bind that op.
 invoiceOrigin:z.discriminatedUnion("kind",[
  z.object({kind:z.literal("created_draft"),creatorOperationId:z.uuid().nullable(),creatorRequestDigest:sha.nullable()}).strict(),
  z.object({kind:z.enum(["update_generated","calendar_generated"]),creatorOperationId:z.uuid(),creatorRequestDigest:sha,priceEpochCollectionId:z.uuid().optional(),priceEpochAcceptedQuoteDigest:sha.optional()}).strict()]),
 lineBindings:z.array(z.object({componentId:z.uuid(),providerInvoiceLineRef:reference,providerInvoiceItemRef:reference.nullable(),providerPriceRef:reference.nullable()}).strict()).max(250),
 mode:z.enum(["create","existing_generated"]).optional(),providerInvoiceRef:reference.optional(),componentId:z.uuid().optional(),
}).strict();
