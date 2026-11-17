// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: safe retention and financial authority are distinct contracts.
export const CONTROLLED_SAFE_RESPONSE_PROTOCOL = "controlled_provider_safe_response.v1";
export const CONTROLLED_HISTORICAL_FIN_PROTOCOL = "controlled_historical_fin_reference.v1";
export const CONTROLLED_PROJECTION_KEY = "_freeholder_projection";
export const CONTROLLED_SAFE_PRODUCERS = [
  "createMerchantControlledBootstrap", "inspectMerchantControlledBootstrap", "pauseMerchantControlledBootstrap",
  "previewMerchantControlledProration", "previewMerchantControlledCalendarUpdate", "inspectMerchantControlledInvoice",
  "createMerchantControlledTaxProduct", "inspectMerchantControlledTaxProduct", "discoverMerchantControlledBootstrap",
  "updateMerchantControlledCalendar", "cancelMerchantControlledCalendar", "inspectMerchantControlledCalendar",
  "listMerchantControlledInvoices", "inspectMerchantControlledCustomerFinancials", "prepareMerchantControlledDraft",
  "addMerchantControlledComponent", "inspectMerchantControlledInvoiceManifest", "setMerchantControlledInvoiceFee",
  "finalizeMerchantControlledInvoice", "payMerchantControlledInvoice",
] as const;
export type ControlledSafeProducer = typeof CONTROLLED_SAFE_PRODUCERS[number];
export type ControlledSafeUnknownReason = "unsupported_financial_shape" | "unsupported_financial_field" | "reserved_projection_collision" | "unknown_page_url" | "public_product_context_conflict" | "unknown_path_capacity_exceeded";
export interface ControlledSafeUnknown {
  /** Server-owned structural path; never a provider's arbitrary key or value. */
  path: string;
  reason: ControlledSafeUnknownReason;
}
export interface ControlledSafeBinding {
  operationId: string;
  callId: string;
  requestDigest: string;
  resourceId: string;
  kind: string;
}
export interface ControlledProjectionMetadata {
  protocol: typeof CONTROLLED_SAFE_RESPONSE_PROTOCOL;
  context: ControlledSafeProducer;
  unknownFinancialPaths: ControlledSafeUnknown[];
  unknownFinancialPathCount: number;
}
export interface ControlledIngressContext {
  binding: ControlledSafeBinding;
  producer: ControlledSafeProducer;
  method: "GET" | "POST" | "DELETE";
  /** Actual request path/parameters are private provenance, not response facts. */
  requestPath: string;
  dispatchOrdinal: number;
  requestParametersDigest?: string;
  requestHeadersDigest?: string;
  requestNamespaceDigest?: string;
  publicProduct?: { name: string; component: string; creatorOperationId: string; creatorRequestDigest: string; platformAccountId: string };
}

/** Exact admitted operation chooses the outer SDK producer; provider JSON cannot. */
export const CONTROLLED_SAFE_PRODUCER_BY_KIND: Readonly<Record<string, ControlledSafeProducer>> = {
 bootstrap:"createMerchantControlledBootstrap",discover_bootstrap:"discoverMerchantControlledBootstrap",read_bootstrap:"inspectMerchantControlledBootstrap",pause_drafts:"pauseMerchantControlledBootstrap",read_invoice:"inspectMerchantControlledInvoice",read_customer_financials:"inspectMerchantControlledCustomerFinancials",list_invoices:"listMerchantControlledInvoices",read_calendar:"inspectMerchantControlledCalendar",cancel_calendar:"cancelMerchantControlledCalendar",create_product:"createMerchantControlledTaxProduct",read_product:"inspectMerchantControlledTaxProduct",preview_proration:"previewMerchantControlledProration",preview_update:"previewMerchantControlledCalendarUpdate",update_calendar:"updateMerchantControlledCalendar",create_draft:"prepareMerchantControlledDraft",add_invoice_component:"addMerchantControlledComponent",read_manifest:"inspectMerchantControlledInvoiceManifest",set_invoice_fee:"setMerchantControlledInvoiceFee",finalize_invoice:"finalizeMerchantControlledInvoice",pay_invoice:"payMerchantControlledInvoice",
};
