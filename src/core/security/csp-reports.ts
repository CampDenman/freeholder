// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Privacy-bounded CSP violation normalization, aggregation and retention.
import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { defineService } from "@/core/service";
import { cspViolations } from "./schema";

const RETENTION_DAYS = 30;
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_UNIQUE_VIOLATIONS = 10_000;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;
const DIRECTIVE = /^[a-z][a-z0-9-]{0,79}$/;

type Raw = Record<string, unknown>;

export interface NormalizedCspViolation {
  fingerprint: string;
  documentPath: string;
  effectiveDirective: string;
  blockedSource: string;
  sourcePath: string | null;
  disposition: "enforce" | "report";
  statusCode: number | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

function object(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function first(report: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    if (report[key] !== undefined) return report[key];
  }
  return undefined;
}

function text(value: unknown, max = 2_000): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function boundedInteger(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** Redact entity ids and opaque tokens while keeping the route that needs repair. */
export function redactCspPath(pathname: string): string {
  const segments = pathname.split("/").map((segment) => {
    if (UUID_SEGMENT.test(segment)) return ":id";
    if (/^\d+$/.test(segment)) return ":number";
    if (OPAQUE_SEGMENT.test(segment)) return ":value";
    return segment.slice(0, 80);
  });
  const path = segments.join("/").slice(0, 500);
  return path.startsWith("/") ? path : `/${path}`;
}

function urlPath(
  value: unknown,
  documentOrigin: string,
  externalAsOrigin: boolean,
): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (["inline", "eval", "wasm-eval", "trusted-types-sink"].includes(raw)) {
    return raw;
  }
  if (raw.startsWith("data:")) return "data:";
  if (raw.startsWith("blob:")) return "blob:";
  try {
    const url = new URL(raw, documentOrigin);
    if (!["http:", "https:"].includes(url.protocol)) return url.protocol;
    return url.origin === documentOrigin || !externalAsOrigin
      ? redactCspPath(url.pathname)
      : url.origin;
  } catch {
    return "unknown";
  }
}

function rawReports(payload: unknown): Raw[] {
  if (Array.isArray(payload)) {
    return payload.slice(0, MAX_REPORTS_PER_REQUEST).flatMap((entry) => {
      const wrapper = object(entry);
      const body = object(wrapper?.body);
      return body ? [body] : [];
    });
  }
  const wrapper = object(payload);
  const legacy = object(wrapper?.["csp-report"]);
  return legacy ? [legacy] : wrapper ? [wrapper] : [];
}

/** Accept legacy CSP and Reporting API shapes; return only storage-safe facts. */
export function normalizeCspPayload(
  payload: unknown,
  requestOrigin: string,
): NormalizedCspViolation[] {
  return rawReports(payload).flatMap((report) => {
    const documentValue = first(report, "document-uri", "documentURL", "documentUrl");
    const documentRaw = text(documentValue);
    if (!documentRaw) return [];
    let document: URL;
    try {
      document = new URL(documentRaw);
    } catch {
      return [];
    }
    // A browser reports violations for the origin that supplied the endpoint.
    // Refusing any other origin prevents this public intake becoming a generic
    // logging database for arbitrary callers.
    if (document.origin !== requestOrigin) return [];

    const directiveRaw = text(first(
      report,
      "effective-directive",
      "effectiveDirective",
      "violated-directive",
      "violatedDirective",
    ), 80)?.toLowerCase();
    const effectiveDirective = directiveRaw && DIRECTIVE.test(directiveRaw)
      ? directiveRaw
      : "unknown";
    const blockedSource = urlPath(
      first(report, "blocked-uri", "blockedURL", "blockedUrl"),
      document.origin,
      true,
    ) ?? "unknown";
    const sourcePath = urlPath(
      first(report, "source-file", "sourceFile"),
      document.origin,
      true,
    );
    const disposition = first(report, "disposition") === "report"
      ? "report" as const
      : "enforce" as const;
    const normalized = {
      documentPath: redactCspPath(document.pathname),
      effectiveDirective,
      blockedSource,
      sourcePath,
      disposition,
      statusCode: boundedInteger(first(report, "status-code", "statusCode"), 599),
      lineNumber: boundedInteger(first(report, "line-number", "lineNumber"), 10_000_000),
      columnNumber: boundedInteger(first(report, "column-number", "columnNumber"), 10_000_000),
    };
    return [{
      ...normalized,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(normalized), "utf8")
        .digest("hex"),
    }];
  });
}

/**
 * Infrastructure observation, not a business mutation: like rate limiting it
 * commits outside the service audit trail so an untrusted report cannot create
 * permanent audit rows. Input is normalized before the database is touched.
 */
export async function recordCspPayload(
  payload: unknown,
  requestOrigin: string,
): Promise<{ accepted: number; capacityReached: boolean }> {
  const reports = normalizeCspPayload(payload, requestOrigin);
  if (reports.length === 0) return { accepted: 0, capacityReached: false };
  return db().transaction(async (tx) => {
    const [total] = await tx.select({ n: count() }).from(cspViolations);
    let unique = total?.n ?? 0;
    let accepted = 0;
    let capacityReached = false;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000);
    for (const report of reports) {
      const [existing] = await tx
        .select({ expiresAt: cspViolations.expiresAt })
        .from(cspViolations)
        .where(eq(cspViolations.fingerprint, report.fingerprint))
        .limit(1);
      if (!existing && unique >= MAX_UNIQUE_VIOLATIONS) {
        capacityReached = true;
        continue;
      }
      await tx.insert(cspViolations).values({
        ...report,
        firstAt: now,
        lastAt: now,
        expiresAt,
      }).onConflictDoUpdate({
        target: cspViolations.fingerprint,
        set: {
          occurrences: existing && existing.expiresAt > now
            ? sql`${cspViolations.occurrences} + 1`
            : 1,
          firstAt: existing && existing.expiresAt > now
            ? sql`${cspViolations.firstAt}`
            : now,
          lastAt: now,
          expiresAt,
        },
      });
      if (!existing) unique += 1;
      accepted += 1;
    }
    return { accepted, capacityReached };
  });
}

export const listCspViolations = defineService({
  name: "platform.cspViolations",
  summary: "Recent redacted Content Security Policy violations.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: z.number().int().min(1).max(30).default(7),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  handler: (input, ctx) => ctx.tx
    .select()
    .from(cspViolations)
    .where(and(
      gte(cspViolations.lastAt, new Date(Date.now() - input.days * 86_400_000)),
      gte(cspViolations.expiresAt, new Date()),
    ))
    .orderBy(desc(cspViolations.lastAt))
    .limit(input.limit),
});

export async function pruneCspViolations(): Promise<number> {
  const deleted = await db()
    .delete(cspViolations)
    .where(lt(cspViolations.expiresAt, new Date()))
    .returning({ fingerprint: cspViolations.fingerprint });
  return deleted.length;
}

export default [listCspViolations];
