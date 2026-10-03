// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public shopper surface over the existing cart, checkout and order
// services (C3.25 slice 3, gap G2 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// Everything money-shaped here composes the C5.20–C5.22 services; nothing
// re-implements price, stock, tax, shipping or settlement. The three entry
// points exist because the public screen has needs the admin-facing services
// deliberately refuse:
//
//   - catalog.purchaseOptions: the variant/price/availability projection a
//     buy button needs. browseProducts answers "what is on the shelf";
//     this answers "what can be bought, at what price, right now" — per
//     variant, through the same resolvePrice and availability the cart
//     itself refreshes from, so the card, the cart and the invoice can never
//     quote three different numbers.
//   - catalog.shopperCheckout: the checkout C5.21's comment anticipated
//     ("the public storefront checkout verifies the shopper's email first
//     and composes through ctx.callAsSystem"). Naming a contact on
//     checkoutCart is authority over that contact, so an anonymous caller is
//     refused there on purpose. This entry point proves the email first —
//     the platform's existing customer magic link — and only then composes
//     checkoutCart as system, in one transaction. A signed-in customer whose
//     contact email matches the submitted one has already proven it and
//     checks out in a single step.
//   - catalog.shopperOrder: the order summary for whoever holds the cart
//     token that checked out. The cart token is the existing guest order
//     credential — checkoutCart itself consumes it to attach the cart — and
//     this extends the same token gate to the converted cart's order. The
//     projection is deliberately reduced: no contact ids, no full address,
//     just what a confirmation page shows.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { requestCustomerMagicLink } from "@/core/auth/magic-links/service";
import { resolveContact } from "@/core/contacts/service";
import { contacts } from "@/core/contacts/schema";
import { permits, defineService, ServiceError, type Tx } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import {
  customerInvoicePath,
  invoiceAccessToken,
} from "@/modules/invoicing/customer-tokens";
import { invoices } from "@/modules/invoicing/schema";
import { requireCartAccess } from "./cart-access";
import { getCart } from "./cart";
import { availability } from "./inventory";
import { checkoutCart } from "./orders";
import { resolvePrice } from "./pricing";
import { ORDER_STATUSES } from "./contract";
import {
  optionTypes,
  optionValues,
  orderItems,
  orders,
  productVariantOptions,
  productVariants,
  products,
  shippingMethods,
} from "./schema";

const id = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const purchaseVariantRow = row({
  variantId: uuid,
  sku: z.string(),
  /** The option values that distinguish this variant, in dimension order. */
  optionLabel: z.string().nullable(),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  priceAvailable: z.boolean(),
  available: z.boolean(),
  requiresShipping: z.boolean(),
});

const purchaseProductRow = row({
  productId: uuid,
  slug: z.string(),
  name: z.string(),
  currency: z.string().nullable(),
  priceFromMinor: z.number().int().nullable(),
  variants: listed(purchaseVariantRow),
});

const checkoutAddress = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  street1: z.string().trim().min(1).max(300).optional(),
  city: z.string().trim().max(200).optional(),
  region: z.string().trim().toUpperCase().max(100).optional(),
  postalCode: z.string().trim().toUpperCase().max(30).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
});

const shopperOrderRow = row({
  id: uuid,
  status: z.enum(ORDER_STATUSES),
  currency: z.string(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  shippingMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  createdAt: timestamp,
});

const shopperOrderLineRow = row({
  productName: z.string(),
  sku: z.string(),
  quantity: z.number().int(),
  unitAmountMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
});

const shopperInvoiceRow = row({
  id: uuid,
  number: z.string().nullable(),
  status: z.enum([
    "draft",
    "sent",
    "viewed",
    "partially_paid",
    "paid",
    "overdue",
    "void",
    "refunded",
  ]),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  currency: z.string(),
});

const PAYABLE_INVOICE_STATUSES = ["sent", "viewed", "partially_paid", "overdue"];

async function contactIdForUser(tx: Tx, userId: string): Promise<string | null> {
  const [contact] = await tx
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .limit(1);
  return contact?.id ?? null;
}

export const purchaseOptions = defineService({
  name: "catalog.purchaseOptions",
  summary:
    "Storefront purchase projection: sellable variants, option labels, resolved prices and availability for active products.",
  kind: "query",
  permission: "public",
  input: z
    .object({
      slugs: z.array(slug).min(1).max(24).optional(),
      productIds: z.array(id).min(1).max(24).optional(),
    })
    .refine((value) => (value.slugs?.length ?? 0) + (value.productIds?.length ?? 0) > 0, {
      message: "Name at least one product.",
    }),
  output: listed(purchaseProductRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.status, "active"),
          input.slugs
            ? inArray(products.slug, input.slugs)
            : inArray(products.id, input.productIds!),
        ),
      )
      .orderBy(asc(products.name))
      .limit(24);
    if (rows.length === 0) return [];

    // The same visibility gate the product detail block applies: public and
    // unlisted resolve; member-only resolves only for a signed-in contact
    // with access.
    const visible = rows.filter((product) => product.visibility !== "member_only");
    const gated = rows.filter((product) => product.visibility === "member_only");
    if (gated.length > 0 && ctx.actor.kind === "user") {
      const { contactHasAccess } = await import("@/core/entitlements/access");
      const contactId = await contactIdForUser(ctx.tx, ctx.actor.userId);
      for (const product of gated) {
        if (await contactHasAccess(ctx.tx, contactId, { kind: "catalog", selector: product.id })) {
          visible.push(product);
        }
      }
    }

    const business = await ctx.callAsSystem(getBusiness, {});
    const activeCurrency = business?.baseCurrency ?? null;
    // Audience-aware pricing: a signed-in customer is quoted their own price
    // lists through resolvePrice's contactId; an anonymous visitor gets the
    // anonymous reading, the same basis browse.ts documents.
    const contactId = ctx.actor.kind === "user" ? await contactIdForUser(ctx.tx, ctx.actor.userId) : null;

    const variants = visible.length
      ? await ctx.tx
          .select()
          .from(productVariants)
          .where(
            and(
              inArray(productVariants.productId, visible.map((product) => product.id)),
              eq(productVariants.status, "active"),
            ),
          )
          .orderBy(asc(productVariants.sku))
      : [];
    const variantOptions = variants.length
      ? await ctx.tx
          .select({
            variantId: productVariantOptions.variantId,
            optionTypeId: productVariantOptions.optionTypeId,
            optionValueId: productVariantOptions.optionValueId,
          })
          .from(productVariantOptions)
          .where(inArray(productVariantOptions.variantId, variants.map((variant) => variant.id)))
      : [];
    const optionLabels = new Map<string, Array<{ typeName: string; valueName: string }>>();
    if (variantOptions.length > 0) {
      const labels = await ctx.tx
        .select({
          valueId: optionValues.id,
          typeName: optionTypes.name,
          valueName: optionValues.name,
        })
        .from(optionValues)
        .innerJoin(optionTypes, eq(optionTypes.id, optionValues.optionTypeId))
        .where(inArray(optionValues.id, variantOptions.map((entry) => entry.optionValueId)));
      const labelById = new Map(labels.map((entry) => [entry.valueId, entry]));
      for (const entry of variantOptions) {
        const label = labelById.get(entry.optionValueId);
        if (!label) continue;
        const list = optionLabels.get(entry.variantId) ?? [];
        list.push({ typeName: label.typeName, valueName: label.valueName });
        optionLabels.set(entry.variantId, list);
      }
    }
    const labelFor = (variantId: string) =>
      optionLabels.has(variantId)
        ? [...optionLabels.get(variantId)!]
            .sort((left, right) => left.typeName.localeCompare(right.typeName))
            .map((entry) => `${entry.typeName}: ${entry.valueName}`)
            .join(" · ")
        : null;

    const projected = [];
    for (const product of visible) {
      const productVariants_ = variants.filter((variant) => variant.productId === product.id);
      const variantsOut = [];
      for (const variant of productVariants_) {
        const priced = activeCurrency
          ? await ctx.callAsSystem(resolvePrice, {
              variantId: variant.id,
              currency: activeCurrency,
              contactId: contactId ?? undefined,
              quantity: 1,
            })
          : null;
        const stock = await ctx.call(availability, { variantId: variant.id, quantity: 1 });
        variantsOut.push({
          variantId: variant.id,
          sku: variant.sku,
          optionLabel: labelFor(variant.id),
          priceMinor: priced?.available ? priced.amountMinor ?? null : null,
          currency: activeCurrency,
          priceAvailable: priced?.available ?? false,
          available: stock.available,
          requiresShipping: variant.requiresShipping,
        });
      }
      const pricedVariants = variantsOut.filter((variant) => variant.priceMinor !== null);
      projected.push({
        productId: product.id,
        slug: product.slug,
        name: product.name,
        currency: activeCurrency,
        priceFromMinor: pricedVariants.length
          ? Math.min(...pricedVariants.map((variant) => variant.priceMinor!))
          : null,
        variants: variantsOut,
      });
    }
    return projected;
  },
});

export const shopperCheckout = defineService({
  name: "catalog.shopperCheckout",
  summary:
    "Public storefront checkout: prove the shopper's email, then turn their token cart into an order and invoice.",
  kind: "mutation",
  permission: "public",
  writeClass: "money",
  rateLimit: {
    limit: 10,
    windowSeconds: 60,
    subject: (input) => `shopper-checkout:${input.cartId}`,
    message: "Please wait a moment before trying checkout again.",
  },
  input: z.object({
    cartId: id,
    cartToken: z.string().uuid().optional(),
    email: z.string().trim().email().toLowerCase().max(320),
    name: z.string().trim().min(1).max(200).optional(),
    shippingAddress: checkoutAddress.optional(),
    shippingMethodId: id.optional(),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/)
      .optional(),
    acceptedTerms: z.literal(true),
    termsVersion: z.string().trim().min(1).max(100).optional(),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    idempotencyKey: z.string().trim().min(8).max(240),
    locale: z.string().trim().min(2).max(35).optional(),
  }),
  output: z.object({
    status: z.enum(["verification_sent", "placed"]),
    email: z.string(),
    orderId: uuid.nullable(),
  }),
  handler: async (input, ctx) => {
    const access = await requireCartAccess(
      ctx,
      { cartId: input.cartId, cartToken: input.cartToken },
      "catalog.shopperCheckout",
      "mutation",
    );
    if (access.cart.kind !== "cart") {
      throw new ServiceError("conflict", "Only a shopping cart can be checked out.");
    }
    if (access.cart.status === "converted") {
      // The order already exists — a double submit or a retry after the email
      // round trip converges on it instead of failing, exactly the answer
      // catalog.checkoutCart itself gives for a converted cart.
      const [existing] = await ctx.tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.cartId, access.cart.id))
        .limit(1);
      if (existing) return { status: "placed", email: input.email, orderId: existing.id };
      throw new ServiceError("conflict", "That cart was already converted.");
    }
    if (access.cart.status !== "open") {
      throw new ServiceError("conflict", "Only an open shopping cart can be checked out.");
    }
    const basket = await ctx.callAsSystem(getCart, { cartId: input.cartId });
    if (basket.lines.length === 0) {
      throw new ServiceError("validation", "The cart is empty.");
    }

    // Proof of the email: the signed-in visitor's linked contact carries it,
    // or an authorized staff caller already holds contact authority. Everyone
    // else gets the platform's existing proof — a customer magic link — and
    // the order waits until they present it.
    let contactId: string | null = null;
    if (ctx.actor.kind === "user") {
      const [contact] = await ctx.tx
        .select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(eq(contacts.userId, ctx.actor.userId))
        .limit(1);
      if (contact?.email === input.email) contactId = contact.id;
      else if (permits(ctx.actor, "scoped", "catalog.shopperCheckout", "mutation")) {
        const resolved = await ctx.callAsSystem(resolveContact, {
          email: input.email,
          name: input.name,
          source: "storefront_checkout",
        });
        contactId = resolved.contact.id;
      }
    }

    if (!contactId) {
      // The spine doctrine for automated paths: resolve, never create
      // directly, and fill blanks rather than overwrite. Then ask for proof.
      const resolved = await ctx.callAsSystem(resolveContact, {
        email: input.email,
        name: input.name,
        source: "storefront_checkout",
        ...(input.locale ? { preferredLocale: input.locale } : {}),
        ...(input.shippingAddress?.country ? { country: input.shippingAddress.country } : {}),
      });
      await ctx.call(requestCustomerMagicLink, {
        email: input.email,
        locale: input.locale,
      });
      return { status: "verification_sent", email: resolved.contact.email, orderId: null };
    }

    const placed = await ctx.callAsSystem(checkoutCart, {
      cartId: input.cartId,
      contactId,
      idempotencyKey: input.idempotencyKey,
      acceptedTerms: true,
      ...(input.termsVersion ? { termsVersion: input.termsVersion } : {}),
      ...(input.termsHash ? { termsHash: input.termsHash } : {}),
      ...(input.shippingAddress ? { shippingAddress: input.shippingAddress } : {}),
      ...(input.shippingMethodId ? { shippingMethodId: input.shippingMethodId } : {}),
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    });
    return { status: "placed", email: input.email, orderId: placed.order.id };
  },
});

export const shopperOrder = defineService({
  name: "catalog.shopperOrder",
  summary:
    "The reduced order summary for whoever holds the private token of the cart that became it.",
  kind: "query",
  permission: "public",
  input: z.object({ cartId: id, cartToken: z.string().uuid() }),
  output: z.object({
    order: shopperOrderRow,
    lines: listed(shopperOrderLineRow),
    shippingMethodName: z.string().nullable(),
    invoice: shopperInvoiceRow.nullable(),
    /** The existing customer invoice-pay path, when the balance is open. */
    payHref: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    await requireCartAccess(ctx, input, "catalog.shopperOrder", "query");
    const [order] = await ctx.tx
      .select()
      .from(orders)
      .where(eq(orders.cartId, input.cartId))
      .limit(1);
    if (!order) throw new ServiceError("not_found", "That order is not here.");

    // Line identity lives in the checkout snapshot: sku and product name are
    // frozen at placement, which is what a confirmation page should quote
    // even if the catalog row later changes.
    const lines = await ctx.tx
      .select({
        productName: sql<string>`${orderItems.snapshot}->>'productName'`,
        sku: sql<string>`${orderItems.snapshot}->>'sku'`,
        quantity: orderItems.quantity,
        unitAmountMinor: orderItems.unitAmountMinor,
        lineTotalMinor: orderItems.lineTotalMinor,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

    let shippingMethodName: string | null = null;
    if (order.shippingMethodId) {
      const [method] = await ctx.tx
        .select({ name: shippingMethods.name })
        .from(shippingMethods)
        .where(eq(shippingMethods.id, order.shippingMethodId))
        .limit(1);
      shippingMethodName = method?.name ?? null;
    }

    let invoice: z.infer<typeof shopperInvoiceRow> | null = null;
    let payHref: string | null = null;
    if (order.invoiceId) {
      const [row] = await ctx.tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, order.invoiceId))
        .limit(1);
      if (row) {
        invoice = {
          id: row.id,
          number: row.number,
          status: row.status,
          totalMinor: row.totalMinor,
          paidMinor: row.paidMinor,
          currency: row.currency,
        };
        // The same token-gated customer invoice surface the emailed link
        // uses — hosted checkout through the configured adapter when one is
        // live, offline instructions when the business collects manually.
        if (row.number && PAYABLE_INVOICE_STATUSES.includes(row.status) && row.totalMinor > row.paidMinor) {
          payHref = customerInvoicePath(row.id, invoiceAccessToken(row));
        }
      }
    }

    return {
      order: {
        id: order.id,
        status: order.status,
        currency: order.currency,
        subtotalMinor: order.subtotalMinor,
        discountMinor: order.discountMinor,
        shippingMinor: order.shippingMinor,
        taxMinor: order.taxMinor,
        totalMinor: order.totalMinor,
        createdAt: order.createdAt,
      },
      lines,
      shippingMethodName,
      invoice,
      payHref,
    };
  },
});

export default [purchaseOptions, shopperCheckout, shopperOrder];
