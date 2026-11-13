// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// New exact canonical collection protocol; historical phase DTOs stay strict.
import type { MerchantControlledSubscriptionPauseRequest,MerchantControlledInvoiceInventory,MerchantControlledProrationPreviewRequest } from "./merchant-controlled-subscription-types";
export interface MerchantControlledCollectionComponent {
 id:string;position:number;kind:"net"|"merchant_declared_tax_collection"|"locked_canonical_credit";
 amountMinor:number;providerProductRef?:string;periodStart:string;periodEnd:string;provenanceDigest:string;
 taxQuoteDigest?:string;profileId?:string;profileVersion?:number;creditNoteId?:string;applicationIds?:string[];
}
export interface MerchantControlledCollectionManifest {
 protocol:"controlled_net_gross.v1";collectionId:string;quoteId:string;canonicalInvoiceId:string;termsId:string;acceptedQuoteDigest:string;canonicalTargetDigest:string;
 currency:string;grossMinor:number;creditedMinor:number;cashDueMinor:number;applicationFeeMinor:number;
 components:MerchantControlledCollectionComponent[];
}
/** Genuine independently retained current calendar source, including actual
 * price/item/period/anchor and original read digest. No current account alias. */
export interface MerchantControlledCollectionRequest extends MerchantControlledSubscriptionPauseRequest {
 manifest:MerchantControlledCollectionManifest;calendar:MerchantControlledProrationPreviewRequest;
 /** Server-owned original creator admission and exact retained line receipts.
  * These cannot be selected by total, current account or a later ACK. */
 invoiceOrigin:{kind:"created_draft"|"update_generated"|"calendar_generated";creatorOperationId:string;creatorRequestDigest:string};
 lineBindings:Array<{componentId:string;providerInvoiceLineRef:string;providerInvoiceItemRef:string|null;providerPriceRef:string|null}>;
}
export interface MerchantControlledDraftRequest extends MerchantControlledCollectionRequest {
 mode:"create"|"existing_generated";providerInvoiceRef?:string;
}
export interface MerchantControlledInvoiceComponentRequest extends MerchantControlledCollectionRequest {
 providerInvoiceRef:string;componentId:string;
}
export interface MerchantControlledInvoiceActionRequest extends MerchantControlledCollectionRequest {providerInvoiceRef:string;}
export interface MerchantControlledDraftAcknowledgment {
 providerInvoiceRef:string;origin:"created_draft"|"existing_generated";requiresIndependentRead:true;suppliesPaidAuthority:false;
}
export interface MerchantControlledItemAcknowledgment {
 providerInvoiceRef:string;componentId:string;providerInvoiceItemRef:string;providerPriceRef:string|null;requiresIndependentRead:true;
}
export interface MerchantControlledInvoiceActionAcknowledgment {
 providerInvoiceRef:string;requiresIndependentRead:true;suppliesPaidAuthority:false;
}
export interface MerchantControlledInvoiceManifestProof {
 providerInvoiceRef:string;manifestDigest:string;inventory:MerchantControlledInvoiceInventory;customerFinancialDigest:string;
 exactManifest:true;suppliesPaidAuthority:false;
}
