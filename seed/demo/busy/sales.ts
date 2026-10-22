// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Six months of money for the busy demo (C1.38): shop orders, session and
// wedding invoices with deposit plans, quotes through every status, signed
// agreements, gift cards, coupons and a monthly print club.
//
// Bulk inserts, but every row is shaped the way the invoicing, catalog,
// quotes, contracts and subscriptions services would have left it:
//
//   - invoice totals are subtotal − discount + shipping + tax, line by line,
//     with BC tax computed per line (GST 5% everywhere, PST 7% on goods,
//     GST only on shipping), half-up, as the ca-bc starter does;
//   - an invoice's paid/refunded figures are exactly the sum of its
//     succeeded payments/refunds, and its status agrees with them and with
//     its due date (the same rule `invoicing.reconciliation` checks);
//   - numbers are gapless INV-/Q- sequences continuing whatever the
//     sequence tables already hold, and the tables are advanced past them;
//   - a gift card spend goes through the customer-balance ledger (credit
//     then debit, net zero) exactly as `catalog.applyGiftCardToInvoice` does;
//   - an accepted quote carries its frozen snapshot, and a signed agreement
//     its body and signature hashes computed the way contracts computes them.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import {
  customerBalanceAccounts,
  customerBalanceEntries,
  invoiceLines,
  invoiceSequences,
  invoices,
  moneyStateEvents,
  paymentAllocations,
  paymentPlanInstallments,
  paymentPlans,
  payments,
  refunds,
  taxCategories,
  taxLines,
  taxZones,
} from "@/modules/invoicing/schema";
import {
  couponRedemptions,
  coupons,
  giftCardRedemptions,
  giftCards,
  orderItems,
  orders,
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { quoteItems, quoteMessages, quoteSequences, quotes } from "@/modules/quotes/schema";
import { contractDocuments, contractTemplates } from "@/modules/contracts/schema";
import { plans, subscriptionEvents, subscriptions } from "@/modules/subscriptions/schema";
import { DAY, type AreaSeeder, type Person, type World } from "./world";

const CURRENCY = "CAD";
const GST = 50_000;
const PST = 70_000;
const QTY = 1_000_000;

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const ppm = (amount: number, rate: number) => Math.round((amount * rate) / 1_000_000);

type InvoiceSource = "order" | "quote" | "manual" | "subscription";

interface LineSpec {
  description: string;
  unitMinor: number;
  qty: number;
  /** Goods carry PST as well as GST. */
  goods: boolean;
  discountMinor?: number;
  sourceType?: string;
  sourceId?: string;
  snapshot?: Record<string, unknown>;
}

interface PaymentSpec {
  amountMinor: number;
  at: Date;
  method: string;
  /** "manual" for offline money, "balance" for a gift-card spend. */
  provider?: "manual" | "balance";
  id?: string;
}

interface InvoiceSpec {
  id: string;
  contactId: string;
  sourceType: InvoiceSource;
  sourceId: string | null;
  memo?: string;
  lines: LineSpec[];
  shippingMinor: number;
  /** False reproduces checkout's "no taxable origin/destination" legend. */
  taxed: boolean;
  createdAt: Date;
  /** Null leaves it a draft. */
  issuedAt: Date | null;
  dueAt: Date | null;
  viewed?: boolean;
  void?: boolean;
  payments: PaymentSpec[];
  refunds: Array<{ paymentIndex: number; amountMinor: number; at: Date; reason: string }>;
  plan?: { depositMinor: number; balanceDueAt: Date };
}

interface Built {
  invoice: typeof invoices.$inferInsert;
  lines: Array<typeof invoiceLines.$inferInsert>;
  taxes: Array<typeof taxLines.$inferInsert>;
  totalMinor: number;
  taxMinor: number;
  discountMinor: number;
  subtotalMinor: number;
}

export const seedSales: AreaSeeder = async (tx, w) => {
  const r = w.r;
  const now = w.now;
  const staff = `user:${w.staffUserId}`;
  const owner = w.ownerUserId ? `user:${w.ownerUserId}` : staff;
  const contactOf = (person: Person) => w.contactIds.get(person.key)!;
  const createdOf = (person: Person) => w.daysAgo(person.firstSeenDaysAgo);
  /** A moment between the person's first contact and now, never in the future. */
  const after = (person: Person, minDays = 0) => {
    const span = Math.max(0, person.firstSeenDaysAgo - minDays);
    const back = r.int(0, span);
    const at = w.daysAgo(back, r.int(9, 17));
    const floor = new Date(createdOf(person).getTime() + minDays * DAY);
    const clipped = at < floor ? floor : at;
    return clipped > now ? new Date(now.getTime() - r.int(1, 6) * 3_600_000) : clipped;
  };
  const clampPast = (date: Date) => (date > now ? new Date(now.getTime() - 3_600_000) : date);

  const customers = w.people.filter((p) => p.lifecycle === "customer" || p.lifecycle === "repeat");
  const prospects = w.people.filter((p) => p.lifecycle === "lead" || p.lifecycle === "prospect");
  let customerCursor = 0;
  const nextCustomer = () => customers[customerCursor++ % customers.length]!;
  let prospectCursor = 0;
  const nextProspect = () => prospects[prospectCursor++ % prospects.length]!;

  // ---------------------------------------------------------- base lookups
  const [zone] = await tx
    .select({ id: taxZones.id })
    .from(taxZones)
    .where(eq(taxZones.templateKey, "ca-bc"))
    .limit(1);
  const [standard] = await tx
    .select({ id: taxCategories.id })
    .from(taxCategories)
    .where(eq(taxCategories.code, "standard"))
    .limit(1);
  const [retail] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.currency, CURRENCY), eq(priceLists.active, true), eq(priceLists.kind, "retail")))
    .limit(1);
  const SHOP_SLUGS = [
    "driftwood-dawn-print",
    "strait-in-fog-print",
    "headland-low-tide-print",
    "coastal-calendar-2027",
    "aurora-coast-gift-card",
    "portrait-session-voucher",
  ];
  const sellable = retail
    ? await tx
        .select({
          productId: products.id,
          slug: products.slug,
          name: products.name,
          kind: products.kind,
          variantId: productVariants.id,
          sku: productVariants.sku,
          requiresShipping: productVariants.requiresShipping,
          amountMinor: priceListEntries.amountMinor,
        })
        .from(priceListEntries)
        .innerJoin(productVariants, eq(productVariants.id, priceListEntries.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            eq(priceListEntries.priceListId, retail.id),
            eq(productVariants.status, "active"),
            inArray(products.slug, SHOP_SLUGS),
          ),
        )
    : [];
  const prints = sellable.filter((v) => v.slug.endsWith("-print"));
  const calendar = sellable.filter((v) => v.slug === "coastal-calendar-2027");
  const giftCardVariant = sellable.find((v) => v.slug === "aurora-coast-gift-card");
  const voucher = sellable.find((v) => v.slug === "portrait-session-voucher");

  // ----------------------------------------------------- sequences we continue
  const [invoiceSeq] = await tx
    .select()
    .from(invoiceSequences)
    .where(eq(invoiceSequences.key, "invoice"))
    .limit(1);
  let nextInvoiceNumber = invoiceSeq?.nextValue ?? 1;
  const invoicePrefix = invoiceSeq?.prefix ?? "INV-";
  const invoicePadding = invoiceSeq?.padding ?? 6;
  const [quoteSeq] = await tx.select().from(quoteSequences).where(eq(quoteSequences.id, "quote")).limit(1);
  let nextQuoteNumber = quoteSeq?.nextValue ?? 1;

  // ----------------------------------------------------------- collectors
  const invoiceSpecs: InvoiceSpec[] = [];
  const orderRows: Array<typeof orders.$inferInsert> = [];
  const orderItemRows: Array<typeof orderItems.$inferInsert> = [];
  const quoteRows: Array<typeof quotes.$inferInsert> = [];
  const quoteItemRows: Array<typeof quoteItems.$inferInsert> = [];
  const quoteMessageRows: Array<typeof quoteMessages.$inferInsert> = [];
  const contractRows: Array<typeof contractDocuments.$inferInsert> = [];
  const timeline: Array<typeof timelineEvents.$inferInsert> = [];
  const giftCardRows: Array<typeof giftCards.$inferInsert> = [];
  const giftRedemptionRows: Array<typeof giftCardRedemptions.$inferInsert> = [];
  const couponRedemptionRows: Array<typeof couponRedemptions.$inferInsert> = [];
  const balanceAccounts: Array<typeof customerBalanceAccounts.$inferInsert> = [];
  const balanceEntries: Array<typeof customerBalanceEntries.$inferInsert> = [];
  const orderStatusFixups: Array<{ orderId: string; invoiceId: string }> = [];

  // ------------------------------------------------------------- coupons
  const couponDefs = [
    { id: randomUUID(), code: "WELCOME10", kind: "percent" as const, percentOffPpm: 100_000, amountMinor: null, minSubtotalMinor: 0, createdAt: w.daysAgo(170) },
    { id: randomUUID(), code: "SPRINGPRINTS", kind: "fixed" as const, percentOffPpm: null, amountMinor: 1_000, minSubtotalMinor: 5_000, createdAt: w.daysAgo(150), endsAt: w.daysAgo(60) },
    { id: randomUUID(), code: "FREESHIP", kind: "free_shipping" as const, percentOffPpm: null, amountMinor: null, minSubtotalMinor: 10_000, createdAt: w.daysAgo(120) },
  ];

  // ---------------------------------------------------------- shop orders
  const SHIPPING = 1_200;
  const ORDER_COUNT = sellable.length ? 30 : 0;
  for (let i = 0; i < ORDER_COUNT; i += 1) {
    const person = nextCustomer();
    const contactId = contactOf(person);
    const placedAt = after(person, 1);
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    const picks: typeof sellable = [];
    const roll = r.next();
    if (roll < 0.12 && giftCardVariant) picks.push(giftCardVariant);
    else if (roll < 0.2 && voucher) picks.push(voucher);
    else {
      if (prints.length) picks.push(r.pick(prints));
      if (prints.length && r.chance(0.35)) picks.push(r.pick(prints));
      if (calendar.length && r.chance(0.3)) picks.push(calendar[0]!);
    }
    if (!picks.length) continue;
    const unique = [...new Map(picks.map((p) => [p.variantId, p])).values()];
    const quantities = unique.map(() => (r.chance(0.2) ? 2 : 1));
    const physical = unique.some((p) => p.requiresShipping);
    const subtotal = unique.reduce((sum, p, idx) => sum + p.amountMinor * quantities[idx]!, 0);

    // Coupons: a handful of orders used one, recorded the way checkout does.
    let coupon: (typeof couponDefs)[number] | undefined;
    if (i % 7 === 3) coupon = couponDefs[0];
    else if (i % 11 === 5 && subtotal >= 5_000 && placedAt < w.daysAgo(60)) coupon = couponDefs[1];
    else if (i % 9 === 4 && physical && subtotal >= 10_000) coupon = couponDefs[2];
    // Never redeemed before the code existed.
    if (coupon && placedAt <= coupon.createdAt) coupon = undefined;
    const discount =
      coupon?.kind === "percent"
        ? Math.round((subtotal * coupon.percentOffPpm) / 1_000_000)
        : coupon?.kind === "fixed"
          ? Math.min(coupon.amountMinor, subtotal)
          : 0;
    const shipping = physical && coupon?.kind !== "free_shipping" ? SHIPPING : 0;
    // Discount allocated to lines largest-first, never past a line's amount.
    let remainingDiscount = discount;
    const lines: LineSpec[] = unique.map((p, idx) => {
      const extended = p.amountMinor * quantities[idx]!;
      const share = Math.min(remainingDiscount, extended);
      remainingDiscount -= share;
      return {
        description: `${p.name} · ${p.sku}`,
        unitMinor: p.amountMinor,
        qty: quantities[idx]!,
        goods: true,
        discountMinor: share,
        sourceType: "variant",
        sourceId: p.variantId,
        snapshot: { sku: p.sku },
      };
    });

    // Outcomes: most paid; a few still open, overdue, cancelled or refunded.
    const outcome = i % 15 === 7 ? "void" : i % 13 === 6 ? "refunded" : i % 10 === 9 ? "open" : i % 17 === 8 ? "partial_refund" : "paid";
    const issuedAt = placedAt;
    const dueAt = new Date(placedAt.getTime() + 7 * DAY);
    const spec: InvoiceSpec = {
      id: invoiceId,
      contactId,
      sourceType: "order",
      sourceId: orderId,
      lines,
      shippingMinor: shipping,
      taxed: physical,
      createdAt: placedAt,
      issuedAt,
      dueAt,
      viewed: outcome === "open" && r.chance(0.5),
      void: outcome === "void",
      payments: [],
      refunds: [],
    };
    invoiceSpecs.push(spec);
    orderRows.push({
      id: orderId,
      contactId,
      invoiceId,
      currency: CURRENCY,
      status: "pending_payment",
      subtotalMinor: subtotal,
      discountMinor: discount,
      shippingMinor: shipping,
      couponId: coupon?.id ?? null,
      shippingAddress: physical
        ? { name: person.name, line1: `${r.int(10, 990)} Sample Road`, city: person.city, region: person.region, postalCode: "V9N 0A0", country: "CA" }
        : null,
      createdAt: placedAt,
      updatedAt: placedAt,
    });
    unique.forEach((p, idx) =>
      orderItemRows.push({
        orderId,
        variantId: p.variantId,
        quantity: quantities[idx]!,
        unitAmountMinor: p.amountMinor,
        lineTotalMinor: p.amountMinor * quantities[idx]!,
        snapshot: { sku: p.sku, productName: p.name, requiresShipping: p.requiresShipping },
        createdAt: placedAt,
      }),
    );
    if (coupon) {
      couponRedemptionRows.push({ couponId: coupon.id, contactId, orderId, discountMinor: discount, createdAt: placedAt });
    }
    orderStatusFixups.push({ orderId, invoiceId });
    timeline.push({
      contactId,
      actor: "system",
      eventType: "order.placed",
      subjectType: "order",
      subjectId: orderId,
      payload: { invoiceId, currency: CURRENCY },
      occurredAt: placedAt,
    });
    // Payments are filled in once totals are known (below).
    (spec as InvoiceSpec & { outcome?: string }).outcome = outcome;
  }

  // -------------------------------------------------------------- gift cards
  // Cards bought in the shop, plus two the owner issued by hand. Two of the
  // purchased ones have since been part-spent on later print orders.
  const giftOrders = (invoiceSpecs as Array<InvoiceSpec & { outcome?: string }>).filter(
    (spec) =>
      spec.outcome === "paid" && spec.lines.some((line) => line.sourceId === giftCardVariant?.variantId),
  );
  const cardCodes: Array<{ id: string; code: string; issuedMinor: number; contactId: string | null; createdAt: Date; note: string }> = [];
  giftOrders.forEach((spec, idx) => {
    cardCodes.push({
      id: randomUUID(),
      code: `AURORA-GIFT-${String(1001 + idx)}`,
      issuedMinor: giftCardVariant!.amountMinor,
      contactId: null,
      createdAt: spec.createdAt,
      note: "Bought in the shop as a gift.",
    });
  });
  cardCodes.push(
    { id: randomUUID(), code: "AURORA-GIFT-2001", issuedMinor: 25_000, contactId: contactOf(nextCustomer()), createdAt: w.daysAgo(95), note: "Raffle prize, Comox Valley Arts Collective (sample)." },
    { id: randomUUID(), code: "AURORA-GIFT-2002", issuedMinor: 10_000, contactId: contactOf(nextCustomer()), createdAt: w.daysAgo(40), note: "Make-good for a late album." },
  );

  // ----------------------------------------------- session invoices (manual)
  const SESSIONS = [
    { name: "Portrait session (90 min)", minor: 45_000 },
    { name: "Mini session (30 min)", minor: 17_500 },
    { name: "Headshot session (45 min)", minor: 22_500 },
  ];
  for (let i = 0; i < 24; i += 1) {
    const person = nextCustomer();
    const contactId = contactOf(person);
    const session = SESSIONS[i % 3]!;
    const createdAt = after(person, 2);
    let kind = i % 12 === 5 ? "draft" : i % 8 === 3 ? "overdue" : i % 11 === 7 ? "void" : i % 9 === 2 ? "open" : "paid";
    // Overdue only when fourteen days' terms have genuinely run out.
    if (kind === "overdue" && createdAt.getTime() + 15 * DAY > now.getTime()) kind = "open";
    const lines: LineSpec[] = [{ description: session.name, unitMinor: session.minor, qty: 1, goods: false }];
    if (r.chance(0.3)) lines.push({ description: "Fine-art print, 12x18, from the session", unitMinor: 8_500, qty: r.int(1, 3), goods: true });
    const dueAt =
      kind === "open"
        ? new Date(Math.max(createdAt.getTime() + 14 * DAY, now.getTime() + r.int(3, 20) * DAY))
        : new Date(createdAt.getTime() + 14 * DAY);
    const issued = kind === "draft" ? null : createdAt;
    const spec: InvoiceSpec & { outcome?: string } = {
      id: randomUUID(),
      contactId,
      sourceType: "manual",
      sourceId: null,
      memo: kind === "draft" ? "Waiting on print choices before sending." : undefined,
      lines,
      shippingMinor: 0,
      taxed: true,
      createdAt,
      issuedAt: issued,
      dueAt: kind === "draft" ? null : dueAt,
      viewed: kind === "open" || kind === "overdue",
      void: kind === "void",
      payments: [],
      refunds: [],
    };
    spec.outcome = kind === "draft" || kind === "overdue" || kind === "open" || kind === "void" ? kind : "paid";
    invoiceSpecs.push(spec);
  }

  // ------------------------------------------------------ quotes & weddings
  const QUOTE_TERMS =
    "A 30% deposit holds the date. The balance is due fourteen days before the wedding. Travel beyond Vancouver Island is quoted separately.";
  const weddingItems = (hours: number) => [
    { description: "Full-day wedding coverage (8 hours)", unitPriceMinor: 340_000, quantityMicros: QTY, optional: false, selected: true },
    ...(hours > 8
      ? [{ description: "Additional coverage, per hour", unitPriceMinor: 25_000, quantityMicros: (hours - 8) * QTY, optional: false, selected: true }]
      : []),
    { description: "Second photographer", unitPriceMinor: 60_000, quantityMicros: QTY, optional: true, selected: false },
    { description: "Linen-bound album, 30 spreads", unitPriceMinor: 85_000, quantityMicros: QTY, optional: true, selected: false },
  ];
  const quoteTotal = (items: ReturnType<typeof weddingItems>) =>
    items.filter((i) => !i.optional || i.selected).reduce((s, i) => s + i.unitPriceMinor * (i.quantityMicros / QTY), 0);

  const templateId = randomUUID();
  const TEMPLATE_BODY =
    "Wedding photography agreement\n\nAurora Coast Photography (sample) will photograph the wedding of {{client.name}} on {{event.date}}.\n\n1. Coverage and deliverables are as listed in the accepted quote.\n2. A 30% deposit holds the date and is non-refundable after thirty days.\n3. The balance is due fourteen days before the wedding.\n4. The client receives a permanent personal print licence for every delivered image.\n\nThis is a fictional sample agreement for the Freeholder demo.";
  const contractTemplateRow = {
    id: templateId,
    name: "Wedding photography agreement",
    kind: "agreement" as const,
    version: 1,
    title: "Wedding photography agreement",
    body: TEMPLATE_BODY,
    variables: [
      { key: "client.name", label: "Client name" },
      { key: "event.date", label: "Wedding date" },
    ],
    requiresCountersignature: true,
    createdAt: w.daysAgo(178),
    updatedAt: w.daysAgo(178),
  };

  const QUOTE_PLAN: Array<"accepted" | "draft" | "sent" | "viewed" | "negotiating" | "declined" | "expired"> = [
    ...Array<"accepted">(14).fill("accepted"),
    "draft", "draft", "sent", "sent", "sent", "viewed", "viewed", "negotiating", "declined", "declined", "expired", "expired",
  ];
  for (const status of QUOTE_PLAN) {
    const person = status === "accepted" ? nextCustomer() : nextProspect();
    const contactId = contactOf(person);
    const quoteId = randomUUID();
    const hours = r.pick([8, 8, 9, 10, 12]);
    const items = weddingItems(hours);
    // The optional extras sit at the end; the overtime line is only there for
    // days past eight hours, so they are addressed from the end, not by index.
    if (r.chance(0.4)) items[items.length - 2]!.selected = true;
    if (r.chance(0.3)) items[items.length - 1]!.selected = true;
    const total = quoteTotal(items);
    const createdAt = after(person, 0);
    const sentAt = status === "draft" ? null : new Date(Math.min(createdAt.getTime() + DAY, now.getTime() - 3_600_000));
    // Season-weighted wedding date: three candidates, keep the summeriest.
    const candidates = [0, 1, 2].map(() => new Date(createdAt.getTime() + r.int(45, 320) * DAY));
    const weddingDate = candidates.reduce((best, c) => (r.seasonal(c) > r.seasonal(best) ? c : best));
    weddingDate.setUTCHours(21, 0, 0, 0);
    const reference = `Q-${String(nextQuoteNumber++).padStart(4, "0")}`;
    const validUntil =
      status === "expired"
        ? new Date(Math.min((sentAt ?? createdAt).getTime() + 30 * DAY, now.getTime() - r.int(1, 10) * DAY))
        : new Date((sentAt ?? createdAt).getTime() + 30 * DAY < now.getTime() + 5 * DAY ? now.getTime() + r.int(5, 25) * DAY : (sentAt ?? createdAt).getTime() + 30 * DAY);
    const acceptedAt = status === "accepted" ? clampPast(new Date(sentAt!.getTime() + r.int(1, 6) * DAY)) : null;
    const declinedAt = status === "declined" ? clampPast(new Date(sentAt!.getTime() + r.int(2, 9) * DAY)) : null;
    const title = `Wedding photography — ${weddingDate.toISOString().slice(0, 10)}`;
    quoteRows.push({
      id: quoteId,
      contactId,
      reference,
      title,
      status,
      version: 1,
      currency: CURRENCY,
      validUntil,
      depositMinor: Math.round(total * 0.3),
      terms: QUOTE_TERMS,
      notes: status === "negotiating" ? "Asked whether the album can be swapped for a print box." : null,
      viewToken: ["sent", "viewed", "negotiating"].includes(status) ? randomUUID().replaceAll("-", "") : null,
      sentAt,
      firstViewedAt: ["viewed", "negotiating", "accepted", "declined"].includes(status) && sentAt ? clampPast(new Date(sentAt.getTime() + 6 * 3_600_000)) : null,
      acceptedAt,
      declinedAt,
      declineReason: status === "declined" ? r.pick(["We found someone closer to the venue.", "Our budget changed — maybe portraits instead."]) : null,
      acceptedSnapshot:
        status === "accepted"
          ? {
              version: 1,
              currency: CURRENCY,
              acceptedName: person.name,
              totals: {
                requiredMinor: items.filter((i) => !i.optional).reduce((s, i) => s + i.unitPriceMinor * (i.quantityMicros / QTY), 0),
                optionalSelectedMinor: items.filter((i) => i.optional && i.selected).reduce((s, i) => s + i.unitPriceMinor, 0),
                optionalAvailableMinor: items.filter((i) => i.optional && !i.selected).reduce((s, i) => s + i.unitPriceMinor, 0),
                totalMinor: total,
              },
              items: items.filter((i) => !i.optional || i.selected).map((i) => ({ description: i.description, quantityMicros: i.quantityMicros, unitPriceMinor: i.unitPriceMinor, optional: i.optional })),
            }
          : null,
      convertedAt: acceptedAt ? clampPast(new Date(acceptedAt.getTime() + 3_600_000)) : null,
      createdAt,
      updatedAt: acceptedAt ?? declinedAt ?? sentAt ?? createdAt,
    });
    items.forEach((item, idx) =>
      quoteItemRows.push({
        quoteId,
        version: 1,
        description: item.description,
        quantityMicros: item.quantityMicros,
        unitPriceMinor: item.unitPriceMinor,
        optional: item.optional,
        selected: item.selected,
        sortOrder: idx,
        createdAt,
        updatedAt: createdAt,
      }),
    );
    if (status === "negotiating" && sentAt) {
      quoteMessageRows.push(
        { quoteId, version: 1, author: "contact", body: "This looks lovely. Could we swap the album for a box of twenty prints?", createdAt: clampPast(new Date(sentAt.getTime() + 2 * DAY)) },
        { quoteId, version: 1, author: "owner", authorUserId: w.ownerUserId ?? w.staffUserId, body: "Absolutely — a print box is $600. I'll send a revised version this week.", createdAt: clampPast(new Date(sentAt.getTime() + 3 * DAY)) },
      );
    }
    if (sentAt) timeline.push({ contactId, actor: owner, eventType: "quote.sent", subjectType: "quote", subjectId: quoteId, payload: { reference, version: 1 }, occurredAt: sentAt });
    if (acceptedAt) timeline.push({ contactId, actor: "system", eventType: "quote.accepted", subjectType: "quote", subjectId: quoteId, payload: { reference, version: 1, totalMinor: total, acceptedName: person.name }, occurredAt: acceptedAt });
    if (declinedAt) timeline.push({ contactId, actor: "system", eventType: "quote.declined", subjectType: "quote", subjectId: quoteId, payload: { reference }, occurredAt: declinedAt });

    if (status !== "accepted" || !acceptedAt) continue;

    // The agreement, signed by the couple and countersigned by the studio.
    const body = TEMPLATE_BODY.replace("{{client.name}}", person.name).replace("{{event.date}}", weddingDate.toISOString().slice(0, 10));
    const bodyHash = sha(body);
    const issuedAt = clampPast(new Date(acceptedAt.getTime() + 2 * 3_600_000));
    const signed = contractRows.length < 12;
    const signedAt = signed ? clampPast(new Date(issuedAt.getTime() + r.int(1, 3) * DAY)) : null;
    const signatureHash = signedAt ? sha([bodyHash, person.name, person.email, signedAt.toISOString(), "", ""].join("\n")) : null;
    const countersignedAt = signedAt ? clampPast(new Date(signedAt.getTime() + 5 * 3_600_000)) : null;
    const countersignerName = "Mara Whitfield (sample owner)";
    contractRows.push({
      contactId,
      subjectType: "quote",
      subjectId: quoteId,
      templateId,
      kind: "agreement",
      title: `Wedding photography agreement — ${person.name}`,
      bodySnapshot: body,
      bodyHash,
      status: signed ? "signed" : "issued",
      signToken: signed ? null : randomUUID().replaceAll("-", ""),
      issuedAt,
      signedAt,
      signerName: signed ? person.name : null,
      signerEmail: signed ? person.email : null,
      signatureHash,
      countersignedAt,
      countersignerUserId: countersignedAt ? (w.ownerUserId ?? w.staffUserId) : null,
      countersignerName: countersignedAt ? countersignerName : null,
      countersignatureHash: countersignedAt ? sha([bodyHash, signatureHash ?? "", countersignerName, countersignedAt.toISOString()].join("\n")) : null,
      requiresCountersignature: true,
      createdAt: issuedAt,
      updatedAt: countersignedAt ?? issuedAt,
    });
    if (signedAt) timeline.push({ contactId, actor: "system", eventType: "contract.signed", subjectType: "contract", subjectId: quoteId, payload: { title: "Wedding photography agreement" }, occurredAt: signedAt });

    // The wedding invoice, on a deposit/balance plan.
    const invoiceIssued = clampPast(new Date(acceptedAt.getTime() + 3_600_000));
    const balanceDueAt = new Date(weddingDate.getTime() - 14 * DAY);
    const lines: LineSpec[] = items
      .filter((i) => !i.optional || i.selected)
      .map((i) => ({ description: i.description, unitMinor: i.unitPriceMinor, qty: i.quantityMicros / QTY, goods: false, sourceType: "quote_item" }));
    const spec: InvoiceSpec & { outcome?: string } = {
      id: randomUUID(),
      contactId,
      sourceType: "quote",
      sourceId: quoteId,
      memo: `Wedding on ${weddingDate.toISOString().slice(0, 10)}. Quote ${reference}.`,
      lines,
      shippingMinor: 0,
      taxed: true,
      createdAt: invoiceIssued,
      issuedAt: invoiceIssued,
      dueAt: balanceDueAt,
      viewed: true,
      payments: [],
      refunds: [],
      plan: { depositMinor: 0, balanceDueAt },
    };
    spec.outcome = "plan";
    invoiceSpecs.push(spec);
  }

  // ---------------------------------------------------------- print club
  let printClubPlanId: string | null = null;
  let printClubVariantId: string | null = null;
  const subscriptionRows: Array<typeof subscriptions.$inferInsert> = [];
  const subscriptionEventRows: Array<typeof subscriptionEvents.$inferInsert> = [];
  const PRINT_CLUB_MINOR = 2_500;
  if (standard && retail) {
    const productId = randomUUID();
    printClubVariantId = randomUUID();
    printClubPlanId = randomUUID();
    await tx.insert(products).values({
      id: productId,
      name: "Print Club — a print a month",
      slug: "print-club",
      kind: "digital",
      status: "active",
      visibility: "unlisted",
      taxCategoryId: standard.id,
      schemaType: "Product",
      publishedAt: w.daysAgo(175),
      createdAt: w.daysAgo(176),
      updatedAt: w.daysAgo(175),
    });
    await tx.insert(productVariants).values({
      id: printClubVariantId,
      productId,
      combinationKey: "default",
      sku: "print-club",
      isDefault: true,
      status: "active",
      requiresShipping: false,
    });
    await tx.insert(priceListEntries).values({ priceListId: retail.id, variantId: printClubVariantId, amountMinor: PRINT_CLUB_MINOR });
    await tx.insert(plans).values({
      id: printClubPlanId,
      productId,
      name: "Print Club, monthly",
      interval: "month",
      intervalCount: 1,
      billingMode: "manual",
      status: "active",
      createdAt: w.daysAgo(175),
      updatedAt: w.daysAgo(175),
    });
    for (let i = 0; i < 9; i += 1) {
      const person = nextCustomer();
      const contactId = contactOf(person);
      const subscriptionId = randomUUID();
      const startedAt = after(person, 1);
      const months: Array<{ start: Date; end: Date }> = [];
      let start = startedAt;
      while (start <= now) {
        const end = new Date(start);
        end.setUTCMonth(end.getUTCMonth() + 1);
        months.push({ start, end });
        start = end;
      }
      const lastPeriod = months.at(-1)!;
      const status = i === 4 ? "past_due" : i === 7 && months.length > 1 ? "cancelled" : "active";
      const periods = status === "cancelled" ? months.slice(0, -1) : months;
      const current = status === "cancelled" ? periods.at(-1)! : lastPeriod;
      subscriptionRows.push({
        id: subscriptionId,
        contactId,
        planId: printClubPlanId,
        productVariantId: printClubVariantId,
        currency: CURRENCY,
        billingMode: "manual",
        status,
        currentPeriodStart: current.start,
        currentPeriodEnd: current.end,
        cancelledAt: status === "cancelled" ? current.start : null,
        endedAt: status === "cancelled" ? current.end < now ? current.end : null : null,
        cancelAtPeriodEnd: false,
        createdAt: startedAt,
        updatedAt: current.start,
      });
      subscriptionEventRows.push({ subscriptionId, kind: "created", toPlanId: printClubPlanId, at: startedAt });
      periods.forEach((period, idx) => {
        const invoiceId = randomUUID();
        const unpaid = status === "past_due" && idx === periods.length - 1;
        const spec: InvoiceSpec & { outcome?: string } = {
          id: invoiceId,
          contactId,
          sourceType: "subscription",
          sourceId: `${subscriptionId}:${period.start.toISOString()}`,
          lines: [
            {
              description: `Print Club — a print a month — ${period.start.toISOString().slice(0, 10)} to ${period.end.toISOString().slice(0, 10)}`,
              unitMinor: PRINT_CLUB_MINOR,
              qty: 1,
              goods: true,
              sourceType: "subscription",
              sourceId: subscriptionId,
            },
          ],
          shippingMinor: 0,
          taxed: true,
          createdAt: period.start,
          issuedAt: period.start,
          dueAt: new Date(period.start.getTime() + (unpaid ? Math.min(7 * DAY, Math.max(DAY, now.getTime() - period.start.getTime() - DAY)) : 7 * DAY)),
          payments: [],
          refunds: [],
        };
        spec.outcome = unpaid ? (spec.dueAt! < now ? "overdue" : "open") : "paid";
        invoiceSpecs.push(spec);
        subscriptionEventRows.push({
          subscriptionId,
          kind: idx === 0 ? "activated" : "renewed",
          toPlanId: printClubPlanId,
          invoiceId,
          at: period.start,
        });
        if (unpaid) subscriptionEventRows.push({ subscriptionId, kind: "payment_failed", invoiceId, detail: "Card declined — waiting on an e-transfer.", at: clampPast(new Date(period.start.getTime() + DAY)) });
      });
      if (status === "cancelled") subscriptionEventRows.push({ subscriptionId, kind: "cancelled", detail: "Moving away — thanks for the prints!", at: current.start });
    }
  }

  // ---------------------------------------------------- price & pay each spec
  const methods = ["e-transfer", "card terminal", "e-transfer", "cash", "card terminal"];
  const built: Array<{ spec: InvoiceSpec; b: Built }> = [];
  let payCounter = 0;
  for (const spec of invoiceSpecs as Array<InvoiceSpec & { outcome?: string }>) {
    const b = build(spec, zone?.id ?? null);
    built.push({ spec, b });
    const total = b.totalMinor;
    const issued = spec.issuedAt;
    if (!issued || spec.void || total === 0) continue;
    const payAt = (days: number) => clampPast(new Date(issued.getTime() + days * DAY + r.int(1, 8) * 3_600_000));
    const method = () => methods[payCounter++ % methods.length]!;
    switch (spec.outcome) {
      case "paid":
        spec.payments.push({ amountMinor: total, at: payAt(r.int(0, 5)), method: method() });
        break;
      case "refunded":
        spec.payments.push({ amountMinor: total, at: payAt(0), method: method() });
        spec.refunds.push({ paymentIndex: 0, amountMinor: total, at: payAt(r.int(3, 9)), reason: "Print arrived damaged in transit; replaced at no charge." });
        break;
      case "partial_refund": {
        spec.payments.push({ amountMinor: total, at: payAt(0), method: method() });
        const part = Math.max(100, Math.round(total * 0.2));
        spec.refunds.push({ paymentIndex: 0, amountMinor: part, at: payAt(r.int(3, 9)), reason: "Partial refund — one print reprinted with a colour shift." });
        break;
      }
      case "plan": {
        const deposit = Math.round(total * 0.3);
        spec.plan = { depositMinor: deposit, balanceDueAt: spec.plan!.balanceDueAt };
        spec.payments.push({ amountMinor: deposit, at: payAt(r.int(0, 3)), method: "e-transfer" });
        if (spec.plan.balanceDueAt.getTime() - 2 * DAY < now.getTime()) {
          spec.payments.push({ amountMinor: total - deposit, at: clampPast(new Date(spec.plan.balanceDueAt.getTime() - 2 * DAY)), method: "e-transfer" });
        }
        break;
      }
      default:
        break;
    }
  }

  // Two purchased gift cards part-spent on later print orders: the order's
  // invoice is part-funded from the card (provider "balance"), the rest paid
  // offline, and the card's remaining balance drops by exactly that much.
  const spendable = cardCodes.slice(0, 2);
  const spendTargets = built.filter(
    ({ spec }) =>
      spec.sourceType === "order" &&
      (spec as InvoiceSpec & { outcome?: string }).outcome === "paid" &&
      !spec.lines.some((l) => l.sourceId === giftCardVariant?.variantId) &&
      spec.payments.length === 1,
  );
  const usedSpenders = new Set<string>();
  spendable.forEach((card, idx) => {
    const target = spendTargets.find(
      ({ spec }) => spec.createdAt > card.createdAt && !usedSpenders.has(spec.contactId),
    );
    if (!target) return;
    usedSpenders.add(target.spec.contactId);
    const total = target.b.totalMinor;
    const take = Math.min(card.issuedMinor - 1_000 * (idx + 1), total - 100);
    if (take <= 0) return;
    const paidAt = target.spec.payments[0]!.at;
    const paymentId = randomUUID();
    const accountId = randomUUID();
    const creditId = randomUUID();
    const debitId = randomUUID();
    target.spec.payments = [
      { amountMinor: take, at: paidAt, method: "customer_balance", provider: "balance", id: paymentId },
      { amountMinor: total - take, at: paidAt, method: "card terminal" },
    ];
    card.contactId = card.contactId ?? target.spec.contactId;
    giftRedemptionRows.push({ giftCardId: card.id, contactId: target.spec.contactId, orderId: target.spec.sourceId, amountMinor: take, createdAt: paidAt });
    (card as typeof card & { spent?: number }).spent = take;
    balanceAccounts.push({ id: accountId, contactId: target.spec.contactId, currency: CURRENCY, balanceMinor: 0, createdAt: paidAt, updatedAt: paidAt });
    balanceEntries.push(
      { id: creditId, accountId, kind: "credit", deltaMinor: take, balanceAfterMinor: take, sourceType: "manual_adjustment", idempotencyKey: `demo-gift-${card.code}:credit`, requestHash: sha(`credit:${card.code}`), reason: `Gift card ${card.code}`, actor: "system", createdAt: paidAt },
      { id: debitId, accountId, kind: "debit", deltaMinor: -take, balanceAfterMinor: 0, sourceType: "payment", sourceId: paymentId, idempotencyKey: `payment:demo-gift-${card.code}:apply`, requestHash: sha(`debit:${card.code}`), reason: "Applied to invoice", actor: "system", createdAt: new Date(paidAt.getTime() + 1_000) },
    );
    (target.spec.payments[0] as PaymentSpec & { providerRef?: string }).providerRef = `balance:${debitId}`;
  });
  for (const card of cardCodes) {
    const spent = (card as typeof card & { spent?: number }).spent ?? 0;
    giftCardRows.push({
      id: card.id,
      code: card.code,
      currency: CURRENCY,
      issuedMinor: card.issuedMinor,
      remainingMinor: card.issuedMinor - spent,
      contactId: card.contactId,
      status: card.issuedMinor - spent === 0 ? "redeemed" : "active",
      expiresAt: new Date(card.createdAt.getTime() + 3 * 365 * DAY),
      note: card.note,
      createdAt: card.createdAt,
      updatedAt: card.createdAt,
    });
  }

  // ------------------------------------------- numbers, statuses and ledgers
  // Gapless numbers in issue order, continuing the existing sequence.
  const byIssue = built
    .filter(({ spec }) => spec.issuedAt)
    .sort((a, b) => a.spec.issuedAt!.getTime() - b.spec.issuedAt!.getTime());
  const numberOf = new Map<string, string>();
  for (const { spec } of byIssue) {
    numberOf.set(spec.id, `${invoicePrefix}${String(nextInvoiceNumber++).padStart(invoicePadding, "0")}`);
  }

  const paymentRows: Array<typeof payments.$inferInsert> = [];
  const refundRows: Array<typeof refunds.$inferInsert> = [];
  const planRows: Array<typeof paymentPlans.$inferInsert> = [];
  const installmentRows: Array<typeof paymentPlanInstallments.$inferInsert> = [];
  const allocationRows: Array<typeof paymentAllocations.$inferInsert> = [];
  const stateRows: Array<typeof moneyStateEvents.$inferInsert> = [];
  const invoiceStatus = new Map<string, string>();
  let ref = 0;

  for (const { spec, b } of built) {
    const total = b.totalMinor;
    const paymentIds: string[] = [];
    for (const payment of spec.payments) {
      const id = payment.id ?? randomUUID();
      paymentIds.push(id);
      const provider = payment.provider ?? "manual";
      const providerRef = (payment as PaymentSpec & { providerRef?: string }).providerRef ?? `manual:demo-${++ref}`;
      const refunded = spec.refunds
        .filter((refund) => spec.payments[refund.paymentIndex] === payment)
        .reduce((s, refund) => s + refund.amountMinor, 0);
      const idempotencyKey = `demo-payment-${spec.id}-${paymentIds.length}`;
      paymentRows.push({
        id,
        invoiceId: spec.id,
        provider,
        providerRef,
        idempotencyKey,
        requestHash: sha(`${provider}:${idempotencyKey}:${payment.amountMinor}`),
        status: "succeeded",
        method: payment.method,
        currency: CURRENCY,
        amountMinor: payment.amountMinor,
        refundedMinor: refunded,
        processedAt: payment.at,
        metadata: { sample: true },
        createdAt: payment.at,
        updatedAt: payment.at,
      });
      stateRows.push({ subjectType: "payment", subjectId: id, fromState: null, toState: "created", actor: staff, occurredAt: payment.at });
      stateRows.push({ subjectType: "payment", subjectId: id, fromState: "created", toState: "succeeded", actor: staff, occurredAt: payment.at });
    }
    spec.refunds.forEach((refund, idx) => {
      const id = randomUUID();
      const key = `demo-refund-${spec.id}-${idx}`;
      refundRows.push({
        id,
        paymentId: paymentIds[refund.paymentIndex]!,
        invoiceId: spec.id,
        provider: spec.payments[refund.paymentIndex]!.provider ?? "manual",
        providerRef: `manual:demo-refund-${++ref}`,
        idempotencyKey: key,
        requestHash: sha(key),
        status: "succeeded",
        currency: CURRENCY,
        amountMinor: refund.amountMinor,
        reason: refund.reason,
        processedAt: refund.at,
        createdAt: refund.at,
        updatedAt: refund.at,
      });
      stateRows.push({ subjectType: "refund", subjectId: id, fromState: null, toState: "succeeded", actor: owner, occurredAt: refund.at });
    });

    const paid = spec.payments.reduce((s, p) => s + p.amountMinor, 0);
    const refunded = spec.refunds.reduce((s, x) => s + x.amountMinor, 0);
    const lastPaidAt = spec.payments.reduce<Date | null>((latest, p) => (!latest || p.at > latest ? p.at : latest), null);
    let status: (typeof invoices.$inferInsert)["status"];
    if (!spec.issuedAt) status = "draft";
    else if (spec.void) status = "void";
    else if (refunded > 0 && refunded === paid) status = "refunded";
    else if (paid === total) status = "paid";
    else if (paid > 0) status = spec.dueAt && spec.dueAt < now ? "overdue" : "partially_paid";
    else if (spec.dueAt && spec.dueAt < now) status = "overdue";
    else status = spec.viewed ? "viewed" : "sent";
    invoiceStatus.set(spec.id, status);
    const voidedAt = status === "void" ? clampPast(new Date(spec.issuedAt!.getTime() + 2 * DAY)) : null;

    Object.assign(b.invoice, {
      number: spec.issuedAt ? numberOf.get(spec.id)! : null,
      status,
      paidMinor: paid,
      refundedMinor: refunded,
      paidAt: status === "paid" || status === "refunded" ? lastPaidAt : null,
      voidedAt,
      viewedAt: spec.issuedAt && (spec.viewed || paid > 0) ? clampPast(new Date(spec.issuedAt.getTime() + 4 * 3_600_000)) : null,
      updatedAt: [spec.createdAt, lastPaidAt, voidedAt, ...spec.refunds.map((x) => x.at)]
        .filter((d): d is Date => Boolean(d))
        .reduce((a, d) => (d > a ? d : a)),
    });

    stateRows.push({ subjectType: "invoice", subjectId: spec.id, fromState: null, toState: "draft", reason: "created", actor: staff, occurredAt: spec.createdAt });
    if (spec.issuedAt) {
      stateRows.push({ subjectType: "invoice", subjectId: spec.id, fromState: "draft", toState: "sent", reason: "issued", actor: staff, occurredAt: spec.issuedAt });
      if (status !== "sent") {
        stateRows.push({ subjectType: "invoice", subjectId: spec.id, fromState: "sent", toState: status, actor: "system", occurredAt: b.invoice.updatedAt });
      }
      timeline.push({
        contactId: spec.contactId,
        actor: staff,
        eventType: "invoice.sent",
        subjectType: "invoice",
        subjectId: spec.id,
        payload: { number: numberOf.get(spec.id), currency: CURRENCY, totalMinor: total, sourceType: spec.sourceType },
        occurredAt: spec.issuedAt,
      });
      if (status === "paid" || status === "refunded") {
        timeline.push({
          contactId: spec.contactId,
          actor: "system",
          eventType: "invoice.paid",
          subjectType: "invoice",
          subjectId: spec.id,
          payload: { paidMinor: paid, totalMinor: total, currency: CURRENCY, sourceType: spec.sourceType },
          occurredAt: lastPaidAt!,
        });
      }
      for (const refund of spec.refunds) {
        timeline.push({ contactId: spec.contactId, actor: owner, eventType: "invoice.refunded", subjectType: "invoice", subjectId: spec.id, payload: { amountMinor: refund.amountMinor, currency: CURRENCY }, occurredAt: refund.at });
      }
    }

    // Deposit/balance plan for weddings, allocated payment by payment.
    if (spec.plan && spec.issuedAt) {
      const planId = randomUUID();
      const depositId = randomUUID();
      const balanceId = randomUUID();
      const deposit = spec.plan.depositMinor;
      const balance = total - deposit;
      const depositPaid = Math.min(paid, deposit);
      const balancePaid = paid - depositPaid;
      const key = `demo-plan-${spec.id}`;
      planRows.push({ id: planId, invoiceId: spec.id, idempotencyKey: key, requestHash: sha(key), status: paid === total ? "completed" : "active", currency: CURRENCY, principalMinor: total, paidMinor: paid, createdAt: spec.issuedAt, updatedAt: b.invoice.updatedAt });
      const installmentStatus = (due: Date, amount: number, got: number) =>
        got === amount ? "paid" : got > 0 ? "partially_paid" : due < now ? "due" : "scheduled";
      installmentRows.push(
        { id: depositId, planId, position: 0, dueAt: spec.issuedAt, amountMinor: deposit, paidMinor: depositPaid, status: installmentStatus(spec.issuedAt, deposit, depositPaid), createdAt: spec.issuedAt },
        { id: balanceId, planId, position: 1, dueAt: spec.plan.balanceDueAt, amountMinor: balance, paidMinor: balancePaid, status: installmentStatus(spec.plan.balanceDueAt, balance, balancePaid), createdAt: spec.issuedAt },
      );
      if (paymentIds[0]) allocationRows.push({ paymentId: paymentIds[0], installmentId: depositId, amountMinor: spec.payments[0]!.amountMinor, createdAt: spec.payments[0]!.at });
      if (paymentIds[1]) allocationRows.push({ paymentId: paymentIds[1], installmentId: balanceId, amountMinor: spec.payments[1]!.amountMinor, createdAt: spec.payments[1]!.at });
    }
  }

  // Orders follow their invoices, as payOrder and cancellation leave them.
  for (const fix of orderStatusFixups) {
    const row = orderRows.find((o) => o.id === fix.orderId)!;
    const b = built.find(({ spec }) => spec.id === fix.invoiceId)!.b;
    const status = invoiceStatus.get(fix.invoiceId);
    row.taxMinor = b.taxMinor;
    row.totalMinor = b.totalMinor;
    row.status =
      status === "void"
        ? "cancelled"
        : status === "refunded"
          ? "refunded"
          : status === "paid"
            ? (row.createdAt as Date) < w.daysAgo(10) ? "fulfilled" : "paid"
            : status === "partially_paid"
              ? "partially_paid"
              : "pending_payment";
    row.updatedAt = (b.invoice.updatedAt) ?? row.createdAt;
  }

  // ------------------------------------------------------------- writes
  const CHUNK = 500;
  const insertAll = async <T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
  };
  await insertAll(couponDefs, (chunk) =>
    tx.insert(coupons).values(
      chunk.map((c) => ({
        id: c.id,
        code: c.code,
        kind: c.kind,
        percentOffPpm: c.percentOffPpm,
        amountMinor: c.amountMinor,
        currency: c.kind === "fixed" ? CURRENCY : null,
        minSubtotalMinor: c.minSubtotalMinor,
        perContactLimit: 1,
        startsAt: c.createdAt,
        endsAt: "endsAt" in c ? c.endsAt : null,
        active: !("endsAt" in c),
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      })),
    ),
  );
  await insertAll(orderRows, (chunk) => tx.insert(orders).values(chunk));
  await insertAll(orderItemRows, (chunk) => tx.insert(orderItems).values(chunk));
  await insertAll(quoteRows, (chunk) => tx.insert(quotes).values(chunk));
  await insertAll(quoteItemRows, (chunk) => tx.insert(quoteItems).values(chunk));
  await insertAll(quoteMessageRows, (chunk) => tx.insert(quoteMessages).values(chunk));
  if (contractRows.length) await tx.insert(contractTemplates).values(contractTemplateRow);
  await insertAll(contractRows, (chunk) => tx.insert(contractDocuments).values(chunk));
  if (subscriptionRows.length) await insertAll(subscriptionRows, (chunk) => tx.insert(subscriptions).values(chunk));
  await insertAll(built.map(({ b }) => b.invoice), (chunk) => tx.insert(invoices).values(chunk));
  await insertAll(built.flatMap(({ b }) => b.lines), (chunk) => tx.insert(invoiceLines).values(chunk));
  await insertAll(built.flatMap(({ b }) => b.taxes), (chunk) => tx.insert(taxLines).values(chunk));
  await insertAll(paymentRows, (chunk) => tx.insert(payments).values(chunk));
  await insertAll(refundRows, (chunk) => tx.insert(refunds).values(chunk));
  await insertAll(planRows, (chunk) => tx.insert(paymentPlans).values(chunk));
  await insertAll(installmentRows, (chunk) => tx.insert(paymentPlanInstallments).values(chunk));
  await insertAll(allocationRows, (chunk) => tx.insert(paymentAllocations).values(chunk));
  if (subscriptionEventRows.length) await insertAll(subscriptionEventRows, (chunk) => tx.insert(subscriptionEvents).values(chunk));
  await insertAll(giftCardRows, (chunk) => tx.insert(giftCards).values(chunk));
  await insertAll(giftRedemptionRows, (chunk) => tx.insert(giftCardRedemptions).values(chunk));
  await insertAll(couponRedemptionRows, (chunk) => tx.insert(couponRedemptions).values(chunk));
  await insertAll(balanceAccounts, (chunk) => tx.insert(customerBalanceAccounts).values(chunk));
  await insertAll(balanceEntries, (chunk) => tx.insert(customerBalanceEntries).values(chunk));
  await insertAll(stateRows, (chunk) => tx.insert(moneyStateEvents).values(chunk));
  await insertAll(timeline, (chunk) => tx.insert(timelineEvents).values(chunk));

  // Advance the sequences past every number used, as allocation would have.
  await tx
    .insert(invoiceSequences)
    .values({ key: "invoice", prefix: invoicePrefix, nextValue: nextInvoiceNumber, padding: invoicePadding })
    .onConflictDoUpdate({ target: invoiceSequences.key, set: { nextValue: nextInvoiceNumber } });
  await tx
    .insert(quoteSequences)
    .values({ id: "quote", nextValue: nextQuoteNumber })
    .onConflictDoUpdate({ target: quoteSequences.id, set: { nextValue: nextQuoteNumber } });

  // Anyone who paid us is at least a customer; the CRM seeder chose stages
  // from the same pool, so this only lifts the odd lead who bought a card.
  const payers = [...new Set(built.filter(({ b }) => (b.invoice.paidMinor ?? 0) > 0).map(({ spec }) => spec.contactId))];
  if (payers.length) {
    await tx
      .update(contacts)
      .set({ lifecycleStage: "customer" })
      .where(and(inArray(contacts.id, payers), inArray(contacts.lifecycleStage, ["lead", "prospect"])));
  }

  return {
    orders: orderRows.length,
    invoices: built.length,
    payments: paymentRows.length,
    refunds: refundRows.length,
    paymentPlans: planRows.length,
    quotes: quoteRows.length,
    contracts: contractRows.length,
    giftCards: giftCardRows.length,
    coupons: couponDefs.length,
    couponRedemptions: couponRedemptionRows.length,
    subscriptions: subscriptionRows.length,
  };
};

/** Price one invoice the way `invoicing.createDraft` would for BC. */
function build(spec: InvoiceSpec, zoneId: string | null): Built {
  const lines: Built["lines"] = [];
  const taxes: Built["taxes"] = [];
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  const explanation = "British Columbia GST + PST (sample demo tax lines).";
  spec.lines.forEach((line, position) => {
    const id = randomUUID();
    const extended = line.unitMinor * line.qty;
    const lineDiscount = line.discountMinor ?? 0;
    const net = extended - lineDiscount;
    const gst = spec.taxed ? ppm(net, GST) : 0;
    const pst = spec.taxed && line.goods ? ppm(net, PST) : 0;
    subtotal += extended;
    discount += lineDiscount;
    tax += gst + pst;
    lines.push({
      id,
      invoiceId: spec.id,
      position,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      description: line.description,
      quantityMicros: line.qty * QTY,
      unitAmountMinor: line.unitMinor,
      subtotalMinor: extended,
      discountMinor: lineDiscount,
      taxMinor: gst + pst,
      totalMinor: net + gst + pst,
      taxCategoryCode: "standard",
      snapshot: line.snapshot ?? {},
      createdAt: spec.createdAt,
    });
    if (spec.taxed && net > 0) {
      taxes.push({ invoiceId: spec.id, invoiceLineId: id, kind: "item", rateName: "GST", ratePpm: GST, taxableMinor: net, amountMinor: gst, jurisdiction: "Canada", priority: 0, explanation, createdAt: spec.createdAt });
      if (line.goods) {
        taxes.push({ invoiceId: spec.id, invoiceLineId: id, kind: "item", rateName: "PST", ratePpm: PST, taxableMinor: net, amountMinor: pst, jurisdiction: "British Columbia", priority: 10, explanation, createdAt: spec.createdAt });
      }
    }
  });
  const shippingTax = spec.taxed ? ppm(spec.shippingMinor, GST) : 0;
  if (spec.taxed && spec.shippingMinor > 0) {
    taxes.push({ invoiceId: spec.id, kind: "shipping", rateName: "GST", ratePpm: GST, taxableMinor: spec.shippingMinor, amountMinor: shippingTax, jurisdiction: "Canada", priority: 0, explanation, createdAt: spec.createdAt });
  }
  tax += shippingTax;
  const total = subtotal - discount + spec.shippingMinor + tax;
  const key = `demo-invoice-${spec.id}`;
  return {
    invoice: {
      id: spec.id,
      contactId: spec.contactId,
      sequenceKey: "invoice",
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
      idempotencyKey: key,
      requestHash: createHash("sha256").update(key, "utf8").digest("hex"),
      status: "draft",
      currency: CURRENCY,
      subtotalMinor: subtotal,
      discountMinor: discount,
      shippingMinor: spec.shippingMinor,
      taxMinor: tax,
      taxZoneId: spec.taxed ? zoneId : null,
      totalMinor: total,
      paidMinor: 0,
      refundedMinor: 0,
      requiredTaxLegend: spec.taxed ? null : "This checkout has no taxable origin and destination pair.",
      memo: spec.memo ?? null,
      dueAt: spec.dueAt,
      issuedAt: spec.issuedAt,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    },
    lines,
    taxes,
    totalMinor: total,
    taxMinor: tax,
    discountMinor: discount,
    subtotalMinor: subtotal,
  };
}

export type { World };
