// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Seed and measure helpers for the §15.1 harness. Bulk inserts avoid the
// service-layer audit tax so the clock is spent on the list/search/report
// queries the budgets actually name.
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
  for (let offset = 0; offset < counts.contacts; offset += BATCH) {
    const n = Math.min(BATCH, counts.contacts - offset);
    await db()
      .insert(contacts)
      .values(
        Array.from({ length: n }, (_, i) => {
          const index = offset + i;
          return {
            name: `Perf Seed ${String(index).padStart(6, "0")}`,
            email: `perf-${index}@example.test`,
            source: "performance-harness",
          };
        }),
      );
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
  const render = await sampleP95(() =>
    resolvePage.call({ slug: seed.slug, locale: "en" }, { kind: "anonymous" }),
  );
  return [
    { surface: "Admin list (any)", value: list },
    { surface: "Admin detail", value: detail },
    { surface: "Search (inbox, contacts, help)", value: search },
    { surface: "Report generation", value: report },
    { surface: "Public page, server render", value: render },
  ];
}
