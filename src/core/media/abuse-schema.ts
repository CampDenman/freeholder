// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * C12.30: an upload that matched known abuse imagery. The file itself stays
 * quarantined in media storage under legal hold; this row keeps what the
 * legal report needs — the provider's match id, the file's SHA-256, when it
 * arrived and who uploaded it — and never the image.
 *
 * Owned by core media because every upload passes through core media: a
 * match is recorded whichever modules are installed. The members module
 * adds the owner's review queue, the uploader link and the suspension.
 * (Created by migration 0051; moving the definition here changes no SQL.)
 */
export const abuseReports = pgTable(
  "abuse_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    matchId: text("match_id"),
    matchSource: text("match_source"),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id"),
    uploadedBy: text("uploaded_by"),
    state: text("state", { enum: ["to_report", "reported"] }).notNull().default("to_report"),
    reportedTo: text("reported_to"),
    reportReference: text("report_reference"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    reportedBy: uuid("reported_by"),
  },
  (t) => [index("abuse_reports_state_idx").on(t.state, t.detectedAt), index("abuse_reports_sha256_idx").on(t.sha256), check("abuse_reports_state_valid", sql`${t.state} in ('to_report','reported')`)],
);
