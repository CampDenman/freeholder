// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Seed and measure helpers for the §15.1 harness. Bulk inserts avoid the
// service-layer audit tax so the clock is spent on the list/search/report
// queries the budgets actually name.
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translator } from "@/core/i18n";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { conversations, messages } from "@/core/messaging/schema";
import { assets } from "@/core/media/schema";
import { products, productVariants, orders, orderItems } from "@/modules/catalog/schema";
import { invoices, invoiceLines } from "@/modules/invoicing/schema";
import { listContacts, getContact } from "@/core/contacts/service";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { createPage, publishPage, resolvePage } from "@/modules/cms/service";
import { revenueReport } from "@/modules/reporting/service";
import { OWNER } from "./spine";
import { DATASET_SIZES } from "../../scripts/performance-budgets.mjs";

const BATCH = 500;

export async function seedPerformanceDataset(
  size: keyof typeof DATASET_SIZES,
): Promise<{ contactId: string; slug: string }> {
  const counts = DATASET_SIZES[size];
  const contactIds: string[] = [];
  for (let offset = 0; offset < counts.contacts; offset += BATCH) {
    const n = Math.min(BATCH, counts.contacts - offset);
    await db()
      .insert(contacts)
      .values(
        Array.from({ length: n }, (_, i) => {
          const index = offset + i;
          const id = randomUUID();
          contactIds.push(id);
          return {
            id,
            name: `Perf Seed ${String(index).padStart(6, "0")}`,
            email: `perf-${index}@example.test`,
            source: "performance-harness",
          };
        }),
      );
  }
  // Populate the join sides too: a report over zero invoices is not evidence
  // about a business with 2,000 orders. Deterministic amounts let the test
  // verify query correctness as well as row counts and elapsed time.
  const variantIds: string[] = [];
  await batches(counts.products, async (indices) => {
    const rows = indices.map((i) => ({
      id: randomUUID(), name: `Perf Product ${i}`, slug: `perf-product-${i}`,
      kind: "physical" as const, status: "active" as const, publishedAt: new Date(),
    }));
    await db().insert(products).values(rows);
    await db().insert(productVariants).values(rows.map((product, i) => {
      const id = randomUUID();
      variantIds.push(id);
      return { id, productId: product.id, combinationKey: "default",
        sku: `perf-sku-${indices[i]}`, isDefault: true };
    }));
  });
  await batches(counts.messages, async (indices) => {
    const threads = indices.map((i) => ({
      id: randomUUID(), contactId: contactIds[i % contactIds.length]!,
      subject: `Performance enquiry ${i}`, replyChannel: "email" as const,
      messageCount: 1, unread: true,
    }));
    await db().insert(conversations).values(threads);
    await db().insert(messages).values(threads.map((thread, i) => ({
      conversationId: thread.id, contactId: thread.contactId,
      direction: "inbound" as const, channel: "email" as const,
      sentBy: "contact" as const, body: `Performance message ${indices[i]} about a product order.`,
    })));
  });
  await batches(counts.orders, async (indices) => {
    const rows = indices.map((i) => ({
      id: randomUUID(), invoiceId: randomUUID(),
      contactId: contactIds[i % contactIds.length]!, currency: "CAD",
      status: "paid" as const, subtotalMinor: 2500, totalMinor: 2500,
    }));
    await db().insert(invoices).values(rows.map((order, i) => ({
      id: order.invoiceId, contactId: order.contactId, number: `PERF-${indices[i]}`,
      sourceType: "order" as const, sourceId: order.id,
      idempotencyKey: `perf-invoice-${indices[i]}`, requestHash: "0".repeat(64),
      status: "paid" as const, currency: "CAD", subtotalMinor: 2500,
      totalMinor: 2500, paidMinor: 2500, issuedAt: new Date(Date.now() - 86_400_000),
      paidAt: new Date(Date.now() - 60_000),
    })));
    await db().insert(orders).values(rows);
    await db().insert(orderItems).values(rows.map((order, i) => ({
      orderId: order.id, variantId: variantIds[indices[i]! % variantIds.length]!,
      quantity: 1, unitAmountMinor: 2500, lineTotalMinor: 2500,
    })));
    await db().insert(invoiceLines).values(rows.map((order) => ({
      invoiceId: order.invoiceId, position: 0, description: "Performance product",
      quantityMicros: 1_000_000, unitAmountMinor: 2500, subtotalMinor: 2500,
      totalMinor: 2500,
    })));
  });
  await batches(counts.assets, async (indices) => {
    await db().insert(assets).values(indices.map((i) => ({
      kind: "image" as const, storageKey: `performance/image-${i}.png`,
      filename: `image-${i}.png`, mime: "image/png", legacyBytes: 1024,
      bytes: 1024, width: 100, height: 100, altText: `Performance image ${i}`,
    })));
  });
  // Ask the database, not the loop counters: a missing family must fail the
  // harness before its empty-table timings can be mistaken for proof.
  for (const [name, table] of Object.entries({ contacts, messages, orders, products, assets })) {
    const [actual] = await db().select({ total: count() }).from(table);
    if (actual?.total !== counts[name as keyof typeof counts]) {
      throw new Error(`Performance seed count mismatch for ${name}: ${actual?.total}`);
    }
  }
  const page = await createPage.call(
    {
      slug: "perf-home",
      title: "Performance home",
      blocks: [
        {
          id: "perf-home-heading",
          type: "heading",
          props: { text: "Performance home", level: 1, align: "start" },
        },
      ],
      seo: {},
    },
    OWNER,
  );
  await publishPage.call({ id: page.id, published: true }, OWNER);
  const [first] = await db()
    .select({ id: contacts.id })
    .from(contacts)
    .limit(1);
  if (!first) throw new Error("Performance seed wrote no contacts.");
  return { contactId: first.id, slug: "perf-home" };
}

async function batches(total: number, write: (indices: number[]) => Promise<void>) {
  for (let offset = 0; offset < total; offset += BATCH) {
    await write(Array.from({ length: Math.min(BATCH, total - offset) }, (_, i) => offset + i));
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("No samples.");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

async function timeMs(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

async function sampleP95(work: () => Promise<unknown>, times = 11): Promise<number> {
  const values: number[] = [];
  await work();
  for (let i = 0; i < times; i += 1) values.push(await timeMs(work));
  return percentile(values, 95);
}

export async function measureServerSurfaces(seed: {
  contactId: string;
  slug: string;
}): Promise<Array<{ surface: string; value: number }>> {
  const list = await sampleP95(() => listContacts.call({ limit: 25 }, OWNER));
  const detail = await sampleP95(() => getContact.call({ id: seed.contactId }, OWNER));
  const search = await sampleP95(() =>
    listContacts.call({ search: "Perf Seed 000001", limit: 25 }, OWNER),
  );
  const report = await sampleP95(() =>
    revenueReport.call({ days: 90, timezone: "UTC" }, OWNER),
  );
  // Include the real block renderer and HTML serialization. This is a CMS
  // component measurement; the HTTP/layout and browser budgets still need
  // the standalone server on the reference target.
  const render = await sampleP95(async () => {
    const page = await resolvePage.call({ slug: seed.slug, locale: "en" }, { kind: "anonymous" });
    if (!page) throw new Error("Performance page did not resolve.");
    const nodes = await renderBlocks(page.blocks as BlockNode[], {
      locale: "en", t: translator("en"), business: null, path: `/${seed.slug}`,
    });
    const html = renderToStaticMarkup(createElement(Fragment, null, ...nodes));
    if (!html.includes("Performance home") || !html.includes("<h1")) {
      throw new Error("Performance render did not produce its heading.");
    }
  });
  return [
    { surface: "Admin list (any)", value: list },
    { surface: "Admin detail", value: detail },
    { surface: "Search (inbox, contacts, help)", value: search },
    { surface: "Report generation", value: report },
    { surface: "Public page, server render", value: render },
  ];
}
