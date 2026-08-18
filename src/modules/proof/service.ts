// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Proof-plugin services (C2.23).
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { proofNotices } from "./schema";
import { seedNoticeBlock } from "./seed";

export const publishedPaths = defineService({
  name: "proof.publishedPaths",
  summary: "Published notice slugs this plugin owns.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  output: listed(
    row({
      slug: z.string(),
      title: z.string(),
      updatedAt: z.date(),
      kind: z.literal("article"),
    }),
  ),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        slug: proofNotices.slug,
        title: proofNotices.title,
        updatedAt: proofNotices.updatedAt,
      })
      .from(proofNotices)
      .where(eq(proofNotices.published, true))
      .orderBy(asc(proofNotices.slug));
    return rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      updatedAt: row.updatedAt,
      kind: "article" as const,
    }));
  },
});

export const seedProofNotice = defineService({
  name: "proof.seedNotice",
  summary: "Insert the plugin's seed notice row if it is missing.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    id: uuid,
    created: z.boolean(),
    block: z.unknown(),
  }),
  handler: async (_input, ctx) => {
    const existing = await ctx.tx
      .select({ id: proofNotices.id })
      .from(proofNotices)
      .where(eq(proofNotices.slug, "plugin-notice"))
      .limit(1);
    if (existing[0]) return { id: existing[0].id, created: false, block: seedNoticeBlock() };
    const [row] = await ctx.tx
      .insert(proofNotices)
      .values({
        slug: "plugin-notice",
        title: "Plugin notice",
        published: false,
      })
      .returning({ id: proofNotices.id });
    return { id: row!.id, created: true, block: seedNoticeBlock() };
  },
});

export default [publishedPaths, seedProofNotice];
