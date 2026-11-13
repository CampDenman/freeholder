// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: a clock cannot prove that an original HTTP/storage wrapper finished.
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { importCrawlResponses } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";

export const recordCrawlWrapperFinish = defineService({
  name: "imports.recordCrawlWrapperFinish", summary: "Record the actual original wrapper's one-way finish fact without changing its executor.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["responseId"],
  input: z.object({ responseId: z.uuid(), token: z.uuid() }), output: z.object({ finished: z.literal(true) }),
  handler: async (input, ctx) => {
    await markImportCrawlWriter(ctx.tx);
    const [response] = await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, input.responseId)).limit(1).for("update");
    const digest = createHash("sha256").update(input.token).digest("hex");
    if (!response || !response.wrapperTokenDigest || response.wrapperTokenDigest !== digest) throw new ServiceError("conflict", "The original HTTP wrapper needs its actual admitted finish token.");
    await ctx.tx.execute(sql`select set_config('freeholder.import_crawl_finished_wrapper',${digest},true)`);
    if (!response.wrapperFinishedAt) await ctx.tx.update(importCrawlResponses).set({ wrapperFinishedAt: new Date() }).where(eq(importCrawlResponses.id, response.id));
    ctx.setSubject("import_crawl_response", response.id);
    return { finished: true as const };
  },
});
