// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: shared per-party issue and payment admission, with no provider I/O.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantChargeScope } from "@/adapters/payments";
import { ERASED_MERCHANT_NAME, publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMarketPolicies, invoiceMerchantAllocations, invoices, payments } from "./schema";
import { invoiceMerchantCollections, merchantCollectionConfiguration, merchantPaymentRoutes } from "./merchant-collection-schema";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { invoicePaymentDueAmount } from "./invoice-payment-due";
import { merchantTaxPolicyReceipt } from "./merchant-tax-contract";
import { nextMerchantCollectionAmount } from "./merchant-collection-amounts";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export { merchantTaxPolicyReceipt } from "./merchant-tax-contract";
export const merchantCollectionReceipt = z.object({
  allocationId: z.uuid(), collectionKind: z.enum(["platform", "direct", "destination"]),
  providerPlatformAccountId: account, chargeAccountId: account.nullable(), recipientAccountId: account.nullable(), settlementMerchantAccountId: account.nullable(),
  merchantName: z.string().trim().min(1).max(200), merchantSupport: publicMerchantSupport,
  taxPolicy: merchantTaxPolicyReceipt,
}).strict();
type CollectionResolver = (invoiceId: string, ctx: ServiceContext) => Promise<z.infer<typeof merchantCollectionReceipt>[]>;
let resolveCollections: CollectionResolver | undefined;
let verifyCollection: ((allocationId: string, ctx: ServiceContext) => Promise<void>) | undefined;
let checkoutRequirement: ((ctx: ServiceContext) => Promise<boolean>) | undefined;
/** Trusted startup registries compose same-transaction services, never provider reads. */
export function registerMerchantCollectionResolver(resolver: CollectionResolver): void { resolveCollections = resolver; }
export function registerMerchantCollectionVerifier(verifier: (allocationId: string, ctx: ServiceContext) => Promise<void>): void { verifyCollection = verifier; }
export function registerMerchantCheckoutRequirement(required: (ctx: ServiceContext) => Promise<boolean>): void { checkoutRequirement = required; }

export const merchantCheckoutRequirements = defineService({
  name: "invoicing.merchantCheckoutRequirements", summary: "Whether checkout needs the buyer's declared tax destination for original merchant collection.",
  kind: "query", permission: "public", input: z.object({}), output: z.object({ buyerTaxDestinationRequired: z.boolean() }),
  handler: async (_input, ctx) => ({ buyerTaxDestinationRequired: await checkoutRequirement?.(ctx) ?? false }),
});

export function chargeScopeForCollection(collection: typeof invoiceMerchantCollections.$inferSelect): MerchantChargeScope {
  return {
    providerPlatformAccountId: collection.providerPlatformAccountId,
    ...(collection.collectionKind === "direct" ? { providerAccountId: collection.chargeAccountId! } : {}),
    ...(collection.collectionKind === "destination" ? { destinationAccountId: collection.recipientAccountId!, settlementMerchantAccountId: collection.settlementMerchantAccountId! } : {}),
  };
}

export const getMerchantCollectionConfiguration = defineService({
  name: "invoicing.merchantCollectionConfiguration", summary: "Read the verified original platform and selected merchant collection method.",
  kind: "query", permission: "scoped", input: z.object({}),
  output: z.object({ collectionKind: z.enum(["direct", "destination"]), providerPlatformAccountId: account, verifiedAt: z.date() }).nullable(),
  handler: async (_input, ctx) => {
    const [configuration] = await ctx.tx.select().from(merchantCollectionConfiguration).where(eq(merchantCollectionConfiguration.id, 1)).for("share");
    return configuration ?? null;
  },
});
const collectionConfigurationInput = z.object({ collectionKind: z.enum(["direct", "destination"]) }).strict();
export const applyMerchantCollectionConfiguration = defineService({
  name: "invoicing.applyMerchantCollectionConfiguration", summary: "Record the platform identity actually returned by the configured payment provider.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: collectionConfigurationInput.extend({ providerPlatformAccountId: account, initiatedBy: z.string().min(1).max(300) }), output: z.object({ configured: z.literal(true) }),
  handler: async (input, ctx) => {
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext('merchant-collection-configuration'))`);
    const values = { collectionKind: input.collectionKind, providerPlatformAccountId: input.providerPlatformAccountId, verifiedAt: new Date(), updatedAt: new Date() };
    await ctx.tx.insert(merchantCollectionConfiguration).values({ id: 1, ...values }).onConflictDoUpdate({ target: merchantCollectionConfiguration.id, set: values });
    ctx.setSubject("merchant_collection_configuration", "1");
    return { configured: true as const };
  },
});
export const configureMerchantCollection = defineOrchestratedService({
  name: "invoicing.configureMerchantCollection", summary: "Verify the configured Stripe platform before choosing direct or destination seller collection.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money",
  input: collectionConfigurationInput, output: z.object({ configured: z.literal(true) }),
  handler: async (input, actor) => {
    // The orchestrator has already checked the caller's grant and step-up.
    // Its fixed private phase needs no extra externally grantable scope.
    const adapter = paymentAdapter("stripe");
    if (!adapter.status.available || !adapter.platformAccountIdentity || !adapter.capabilities().sellerMerchantCharges
      || input.collectionKind === "destination" && !adapter.capabilities().destinationMerchantCharges) throw new ServiceError("conflict", "The configured provider cannot verify this merchant collection method.");
    const actual = await adapter.platformAccountIdentity();
    return applyMerchantCollectionConfiguration.call({ ...input, ...actual, initiatedBy: actorString(actor) }, { kind: "system", request: actor.request });
  },
});

export const captureMerchantCollections = defineService({
  name: "invoicing.captureMerchantCollections", summary: "Freeze each original seller's public identity, tax receipt and charge namespace before invoice issue.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: z.object({ captured: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    if (!invoice || invoice.status !== "draft") throw new ServiceError("conflict", "Freeze original merchant collection while issuing its draft invoice.");
    if (policy?.collectionVersion !== 1) return { captured: false };
    if (policy.model !== "seller_merchant" || policy.allocationVersion !== 1 || invoice.sourceType !== "order" || !resolveCollections) throw new ServiceError("conflict", "The complete original merchant collection policy is unavailable.");
    const allocations = await ctx.tx.select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    const existing = await ctx.tx.select().from(invoiceMerchantCollections).where(eq(invoiceMerchantCollections.invoiceId, invoiceId));
    if (existing.length) {
      if (existing.length !== allocations.length || allocations.some(part => !existing.some(row => row.allocationId === part.id))) throw new ServiceError("conflict", "The original merchant collection receipts are incomplete.");
      return { captured: true };
    }
    const supplied = merchantCollectionReceipt.array().parse(await resolveCollections(invoiceId, ctx));
    if (!allocations.length || supplied.length !== allocations.length || new Set(supplied.map(row => row.allocationId)).size !== allocations.length) throw new ServiceError("conflict", "Each original invoice portion needs exactly one merchant collection receipt.");
    for (const receipt of supplied) {
      const allocation = allocations.find(row => row.id === receipt.allocationId);
      if (!allocation || (receipt.collectionKind === "platform") !== (allocation.sellerUserId === null)
        || receipt.merchantName === ERASED_MERCHANT_NAME) throw new ServiceError("conflict", "This merchant receipt does not match its original invoice portion.");
      if (receipt.taxPolicy.liability !== (allocation.sellerUserId === null ? "platform" : "seller")) throw new ServiceError("conflict", "This collection model has no platform-tax withholding for a seller charge. Use the site's platform collection model for that declared tax policy.");
      if (allocation.sellerUserId) {
        const [owner] = allocation.merchantContactId ? await ctx.tx.select({ source: contacts.source }).from(contacts).where(eq(contacts.id, allocation.merchantContactId)) : [];
        if (!owner || owner.source === "privacy-erasure") throw new ServiceError("conflict", "The original seller's erased identity cannot authorize new collection.");
      }
      await ctx.tx.insert(invoiceMerchantCollections).values({ ...receipt, invoiceId });
    }
    ctx.setSubject("invoice", invoiceId);
    return { captured: true };
  },
});

export async function nextCollectionAmount(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, dueMinor: number, allocationId?: string) {
  const allocations = await ctx.tx.select({ allocationId: invoiceMerchantAllocations.id, totalMinor: invoiceMerchantAllocations.totalMinor, feeMinor: invoiceMerchantAllocations.feeMinor })
    .from(invoiceMerchantAllocations).innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, invoiceMerchantAllocations.id)).where(eq(invoiceMerchantAllocations.invoiceId, invoice.id));
  const history = await ctx.tx.select({ allocationId: merchantPaymentRoutes.allocationId, amountMinor: payments.amountMinor, applicationFeeMinor: merchantPaymentRoutes.applicationFeeMinor, status: payments.status })
    .from(payments).innerJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id));
  return nextMerchantCollectionAmount({ invoiceTotalMinor: invoice.totalMinor, invoicePaidMinor: invoice.paidMinor, dueMinor, allocations, payments: history, allocationId });
}

export async function reserveCollectionCharge(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, request: { provider: string; method: string; amountMinor: number; merchantAllocationId?: string }) {
  if (request.provider !== "stripe" || !["hosted_checkout", "saved_method"].includes(request.method)) throw new ServiceError("conflict", "Collect each merchant portion through its original online payment flow.");
  await assertNoUnappliedMerchantCharge(ctx, invoice.id);
  const due = await invoicePaymentDueAmount(invoice, ctx);
  if (due === null || request.amountMinor > due) throw new ServiceError("conflict", "This merchant payment exceeds the amount currently released for collection.");
  const amount = await nextCollectionAmount(ctx, invoice, request.amountMinor, request.merchantAllocationId);
  if (!amount || amount.amountMinor !== request.amountMinor) throw new ServiceError("conflict", "Reserve only the selected original merchant's permitted payment amount.");
  if (!verifyCollection) throw new ServiceError("conflict", "The original merchant account verifier is unavailable.");
  await verifyCollection(amount.allocationId, ctx);
  const [collection] = await ctx.tx.select().from(invoiceMerchantCollections).where(and(eq(invoiceMerchantCollections.allocationId, amount.allocationId), eq(invoiceMerchantCollections.invoiceId, invoice.id)));
  if (!collection || collection.merchantName === ERASED_MERCHANT_NAME) throw new ServiceError("conflict", "The original merchant identity cannot authorize new collection.");
  return { ...amount, ...chargeScopeForCollection(collection) };
}

export async function verifyNextMerchantCollection(ctx: ServiceContext, invoiceId: string): Promise<void> {
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice || !verifyCollection) throw new ServiceError("conflict", "The original merchant account verifier is unavailable.");
  if (invoice.paidMinor === invoice.totalMinor) return;
  const active = await ctx.tx.select({ allocationId: merchantPaymentRoutes.allocationId, status: payments.status })
    .from(payments).innerJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, invoiceId));
  const pending = active.filter(row => ["created", "processing"].includes(row.status));
  if (pending.length > 1) throw new ServiceError("conflict", "The original merchant payment attempts need reconciliation.");
  const allocationId = pending[0]?.allocationId ?? (await nextCollectionAmount(ctx, invoice, invoice.totalMinor - invoice.paidMinor))?.allocationId;
  if (allocationId) await verifyCollection(allocationId, ctx);
}

export default [merchantCheckoutRequirements, getMerchantCollectionConfiguration, applyMerchantCollectionConfiguration, configureMerchantCollection, captureMerchantCollections];
