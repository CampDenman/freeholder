// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SEO services (MASTER.md §5).
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { redirects } from "@/core/seo/schema";
import { defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";

const redirectRow = row({
  id: uuid,
  fromPath: z.string(),
  toPath: z.string(),
  status: z.enum(["301", "302"]),
  locale: z.string(),
  source: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const path = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""));

/**
 * Where a path should send someone, if anywhere.
 *
 * Public and called on the 404 path, so a link shared before a rename still
 * lands somewhere useful. Chains are followed a few hops — a page renamed
 * twice should still resolve — and then give up rather than loop, because a
 * redirect cycle is a configuration mistake and not a request to spin.
 */
export const resolveRedirect = defineService({
  name: "seo.resolveRedirect",
  summary: "Where an old path now leads.",
  kind: "query",
  permission: "public",
  input: z.object({ path, locale: z.string().default("en") }),
  output: row({
    toPath: z.string(),
    status: z.enum(["301", "302"]),
  }).nullable(),
  handler: async (input, ctx) => {
    let current = input.path;
    let status: "301" | "302" = "301";

    for (let hop = 0; hop < 5; hop += 1) {
      const [row] = await ctx.tx
        .select()
        .from(redirects)
        .where(
          and(
            eq(redirects.fromPath, current),
            eq(redirects.locale, input.locale),
          ),
        )
        .limit(1);
      if (!row) {
        return hop === 0 ? null : { toPath: current, status };
      }
      // A 302 anywhere in the chain makes the whole journey temporary: the
      // final destination is only as permanent as its least permanent hop.
      if (row.status === "302") status = "302";
      current = row.toPath;
    }

    console.warn(`[seo] redirect chain from "${input.path}" is too long`);
    return null;
  },
});

export const listRedirects = defineService({
  name: "seo.listRedirects",
  summary: "Every redirect, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(redirectRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(redirects).orderBy(desc(redirects.createdAt)),
});

/**
 * Record that a path has moved.
 *
 * `system` is permitted because the caller that matters is `cms.updatePage`
 * noticing a slug change — an owner renaming a page has not asked for a
 * redirect and should not have to. It reaches this through `ctx.callAsSystem`.
 */
export const recordRedirect = defineService({
  name: "seo.recordRedirect",
  summary: "Point an old path at a new one.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    fromPath: path,
    toPath: path,
    locale: z.string().default("en"),
    status: z.enum(["301", "302"]).default("301"),
    source: z.string().default("manual"),
  }),
  output: redirectRow,
  handler: async (input, ctx) => {
    if (input.fromPath === input.toPath) {
      throw new ServiceError(
        "validation",
        "A page cannot redirect to itself.",
      );
    }

    // Renaming A→B then B→A must not leave a redirect pointing at a page that
    // exists again. The old row is retargeted, so the live page always wins.
    await ctx.tx
      .delete(redirects)
      .where(
        and(
          eq(redirects.fromPath, input.toPath),
          eq(redirects.locale, input.locale),
        ),
      );

    const [row] = await ctx.tx
      .insert(redirects)
      .values(input)
      .onConflictDoUpdate({
        target: [redirects.fromPath, redirects.locale],
        set: { toPath: input.toPath, status: input.status, source: input.source },
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            "There is already a redirect from that address.",
          );
        }
        throw error;
      });

    ctx.setSubject("redirect", row!.id);
    return row!;
  },
});

export const deleteRedirect = defineService({
  name: "seo.deleteRedirect",
  summary: "Stop redirecting a path.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .delete(redirects)
      .where(eq(redirects.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "That redirect is gone.");
    ctx.setSubject("redirect", row.id);
    return { ok: true };
  },
});

export default [
  resolveRedirect,
  listRedirects,
  recordRedirect,
  deleteRedirect,
];
