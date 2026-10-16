// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30 (MASTER.md §44.9): what happens after an upload matches known abuse
// imagery.
//
// The scanner (adapters/malware, adapters/abuse-scan) has already held the
// file in quarantine, where it is never served. Here the match becomes a
// report: the provider's match id and the file's SHA-256 are recorded (never
// the image), the upload is linked to the account that sent it, that member
// is suspended pending review, the file is put under legal hold so it cannot
// be deleted, and the site owner is given what they need to report it —
// Cybertip.ca in Canada, NCMEC's CyberTipline in the United States — and
// records the report's reference when done. Nobody here is shown the image.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { assets } from "@/core/media/schema";
import { onAbuseMatch } from "@/adapters/abuse-scan";
import { abuseReports, memberProfiles } from "./schema";

/** Where a site reports, by its country. Others should take legal advice. */
export const REPORT_CHANNELS = {
  CA: { id: "cybertip", url: "https://www.cybertip.ca" },
  US: { id: "ncmec", url: "https://report.cybertip.org" },
} as const;

// Recorded on its own connection: the evidence must survive even if the
// upload that carried it is rolled back.
onAbuseMatch(async (record) => {
  await db().insert(abuseReports).values({
    provider: record.provider,
    matchId: record.matchId ?? null,
    matchSource: record.source ?? null,
    sha256: record.sha256,
    contentType: record.contentType,
    bytes: record.bytes,
  });
});

/** True for a file the abuse scanner held: it may not be trashed or purged. */
export function underLegalHold(asset: { scanEngine: string | null; status: string }): boolean {
  return asset.status === "quarantined" && Boolean(asset.scanEngine?.startsWith("abuse-hash:"));
}

export const linkAbuseReports = defineService({
  name: "members.linkAbuseReports",
  summary: "Tie new abuse matches to the uploaded file and its uploader, and suspend that member pending review.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({}),
  output: z.object({ linked: z.number().int(), suspended: z.number().int() }),
  handler: async (_input, ctx) => {
    const open = await ctx.tx.select().from(abuseReports).where(isNull(abuseReports.assetId)).limit(100);
    let linked = 0;
    let suspended = 0;
    for (const report of open) {
      const [asset] = await ctx.tx
        .select({ id: assets.id, uploadedBy: assets.uploadedBy })
        .from(assets)
        .where(and(eq(assets.checksumSha256, report.sha256), sql`${assets.scanEngine} like 'abuse-hash:%'`))
        .limit(1);
      if (!asset) continue;
      await ctx.tx.update(abuseReports).set({ assetId: asset.id, uploadedBy: asset.uploadedBy }).where(eq(abuseReports.id, report.id));
      linked++;
      const userId = asset.uploadedBy?.startsWith("user:") ? asset.uploadedBy.slice(5) : null;
      if (userId) {
        const done = await ctx.tx
          .update(memberProfiles)
          .set({ status: "suspended", updatedAt: new Date() })
          .where(and(eq(memberProfiles.userId, userId), eq(memberProfiles.status, "active")))
          .returning({ userId: memberProfiles.userId });
        suspended += done.length;
      }
    }
    return { linked, suspended };
  },
});

export const abuseReportQueue = defineService({
  name: "members.abuseReports",
  summary: "Uploads that matched known abuse imagery, for the site owner to report to the authorities.",
  kind: "query",
  permission: "scoped",
  input: z.object({ state: z.enum(["to_report", "reported"]).default("to_report") }),
  output: listed(
    row({
      id: uuid,
      provider: z.string(),
      matchId: z.string().nullable(),
      sha256: z.string(),
      contentType: z.string(),
      bytes: z.number().int(),
      detectedAt: timestamp,
      assetId: uuid.nullable(),
      uploader: z.string().nullable(),
      reportedTo: z.string().nullable(),
      reportReference: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.role !== "owner") throw new ServiceError("permission", "Only the site owner sees these reports.");
    const rows = await ctx.tx
      .select({ report: abuseReports, handle: memberProfiles.handle })
      .from(abuseReports)
      .leftJoin(memberProfiles, sql`'user:' || ${memberProfiles.userId}::text = ${abuseReports.uploadedBy}`)
      .where(eq(abuseReports.state, input.state))
      .orderBy(abuseReports.detectedAt);
    return rows.map(({ report: r, handle }) => ({
      id: r.id,
      provider: r.provider,
      matchId: r.matchId,
      sha256: r.sha256,
      contentType: r.contentType,
      bytes: r.bytes,
      detectedAt: r.detectedAt,
      assetId: r.assetId,
      uploader: handle ? `@${handle}` : r.uploadedBy,
      reportedTo: r.reportedTo,
      reportReference: r.reportReference,
    }));
  },
});

export const markAbuseReported = defineService({
  name: "members.markAbuseReported",
  summary: "Record that a match was reported to the authorities, with their reference.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: uuid, reportedTo: z.enum(["cybertip", "ncmec", "other"]), reference: z.string().trim().min(1).max(200) }),
  output: okResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.role !== "owner") throw new ServiceError("permission", "Only the site owner records these reports.");
    const [done] = await ctx.tx
      .update(abuseReports)
      .set({ state: "reported", reportedTo: input.reportedTo, reportReference: input.reference, reportedAt: new Date(), reportedBy: ctx.actor.userId })
      .where(and(eq(abuseReports.id, input.id), eq(abuseReports.state, "to_report")))
      .returning({ id: abuseReports.id });
    if (!done) throw new ServiceError("not_found", "That report is not waiting.");
    ctx.setSubject("abuse_report", input.id);
    return { ok: true as const };
  },
});

export default [linkAbuseReports, abuseReportQueue, markAbuseReported];
