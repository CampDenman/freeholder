// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Privacy-bounded CSP report intake, aggregation and expiry (MASTER.md C1.19).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { cspViolations } from "@/core/security/schema";
import {
  listCspViolations,
  normalizeCspPayload,
  pruneCspViolations,
  recordCspPayload,
} from "@/core/security/csp-reports";
import { POST } from "../../app/api/security/csp-report/route";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const origin = "https://example.test";

function legacy(overrides: Record<string, unknown> = {}) {
  return {
    "csp-report": {
      "document-uri": `${origin}/admin/pages/00000000-0000-4000-8000-000000000123?secret=document#editor`,
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://creative.example/pixel.js?customer=private",
      "source-file": `${origin}/_next/static/chunks/app.js?token=private`,
      "status-code": 200,
      "line-number": 42,
      "column-number": 7,
      "referrer": "https://private.example/history?q=secret",
      "script-sample": "window.secret = 'private'",
      "original-policy": "default-src 'self'",
      ...overrides,
    },
  };
}

describe("CSP report minimization", () => {
  it("redacts paths and retains external origins rather than full URLs", () => {
    const [report] = normalizeCspPayload(legacy(), origin);
    expect(report).toMatchObject({
      documentPath: "/admin/pages/:id",
      effectiveDirective: "script-src-elem",
      blockedSource: "https://creative.example",
      sourcePath: "/_next/static/chunks/app.js",
      disposition: "enforce",
      statusCode: 200,
      lineNumber: 42,
      columnNumber: 7,
    });
    const storedShape = JSON.stringify(report);
    expect(storedShape).not.toMatch(/secret|private|referrer|sample|original-policy/i);
  });

  it("accepts Reporting API batches, caps them, and rejects foreign documents", () => {
    const entry = {
      type: "csp-violation",
      url: `${origin}/services`,
      body: {
        documentURL: `${origin}/services/12345?lead=private`,
        effectiveDirective: "img-src",
        blockedURL: "data:image/png;base64,private",
        disposition: "report",
      },
    };
    expect(normalizeCspPayload(Array.from({ length: 25 }, () => entry), origin))
      .toHaveLength(20);
    expect(normalizeCspPayload(legacy({
      "document-uri": "https://foreign.example/turn-this-into-a-log",
    }), origin)).toEqual([]);
  });
});

describe.runIf(hasDatabase)("CSP report persistence", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("deduplicates reports and exposes only scoped, minimized evidence", async () => {
    expect(await recordCspPayload(legacy(), origin)).toMatchObject({ accepted: 1 });
    expect(await recordCspPayload(legacy(), origin)).toMatchObject({ accepted: 1 });

    const [row] = await db().select().from(cspViolations);
    expect(row?.occurrences).toBe(2);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "blockedSource",
      "columnNumber",
      "disposition",
      "documentPath",
      "effectiveDirective",
      "expiresAt",
      "fingerprint",
      "firstAt",
      "lastAt",
      "lineNumber",
      "occurrences",
      "sourcePath",
      "statusCode",
    ]);
    expect(await listCspViolations.call({ days: 7, limit: 20 }, OWNER)).toHaveLength(1);
    expect((await failure(listCspViolations.call({ days: 7, limit: 20 }, ANONYMOUS))).code)
      .toBe("permission");
  });

  it("prunes expired evidence", async () => {
    await recordCspPayload(legacy(), origin);
    const [row] = await db().select().from(cspViolations);
    await db().update(cspViolations)
      .set({ expiresAt: new Date(0) })
      .where(eq(cspViolations.fingerprint, row!.fingerprint));
    expect(await pruneCspViolations()).toBe(1);
    expect(await db().select().from(cspViolations)).toEqual([]);
  });

  it("accepts browser content types without returning report data", async () => {
    const response = await POST(new Request(`${origin}/api/security/csp-report`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify(legacy()),
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await db().select().from(cspViolations)).toHaveLength(1);
  });

  it("silently discards malformed input and rejects oversized bodies", async () => {
    const malformed = await POST(new Request(`${origin}/api/security/csp-report`, {
      method: "POST",
      body: "not json",
    }));
    const oversized = await POST(new Request(`${origin}/api/security/csp-report`, {
      method: "POST",
      headers: { "content-length": String(65 * 1_024) },
      body: "{}",
    }));
    expect(malformed.status).toBe(204);
    expect(oversized.status).toBe(413);
    expect(await db().select().from(cspViolations)).toEqual([]);
  });
});
