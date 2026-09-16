// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import { defineService, getService } from "@/core/service";
import { products } from "./schema";

const CONTRIBUTION = { key: "catalog.demo-product", version: 1 } as const;

const TITLES = {
  en: "[Demo] Harbour print",
  fr: "[Demo] Tirage du port",
  es: "[Demo] Copia del puerto",
} as const;

export const loadDemoCatalog = defineService({
  name: "catalog.loadDemoFixture",
  summary: "Load a marked demo product.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "load");
    const name = TITLES[input.locale as keyof typeof TITLES] ?? TITLES.en;
    const product = (await ctx.callAsSystem(getService("catalog.createProduct"), {
      name,
      slug: "freeholder-demo-print",
      kind: "physical",
      visibility: "public",
    })) as { id: string };
    return demoLoadResultSchema.parse({
      records: [{ fixtureKey: "print", subjectType: "product", subjectId: product.id, label: name }],
    });
  },
});

export const purgeDemoCatalog = defineService({
  name: "catalog.purgeDemoFixture",
  summary: "Archive only products proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    for (const record of input.records) {
      const [product] = await ctx.tx
        .select({ id: products.id, version: products.version, status: products.status })
        .from(products)
        .where(eq(products.id, record.subjectId))
        .limit(1);
      if (product && product.status !== "archived") {
        await ctx.callAsSystem(getService("catalog.archiveProduct"), {
          id: product.id,
          expectedVersion: product.version,
          reason: "Purging the tracked demo product.",
        });
      }
    }
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoCatalog = defineService({
  name: "catalog.verifyDemoFixture",
  summary: "Verify the marked demo product is still listed and not archived.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const id = input.records[0]?.subjectId;
    const [product] = id
      ? await ctx.tx
          .select({ slug: products.slug, name: products.name, status: products.status })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "catalog.demo-product.visible",
          achieved:
            product?.slug === "freeholder-demo-print" &&
            product.status !== "archived" &&
            Boolean(product.name.startsWith("[Demo]")),
          detail: product?.name,
        },
      ],
    });
  },
});

export default [loadDemoCatalog, purgeDemoCatalog, verifyDemoCatalog];
