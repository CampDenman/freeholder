// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Database-schema probe (C1.38). Neither liveness (process only) nor readiness
// (which also judges jobs and plugins): it answers whether the migrated schema
// is present, so a container health check can tell an emptied database from a
// merely busy instance. See src/core/runtime/schema-probe.ts.
import { probeSchema } from "@/core/runtime/schema-probe";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const state = await probeSchema();
  return Response.json(
    { ok: state === "ok", ...(state === "ok" ? {} : { reason: state }) },
    { status: state === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
