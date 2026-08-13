// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Authenticated, aggregate-only analytics export (MASTER.md C1.18).
import { actorFromRequest } from "@/core/http/actor";
import { errorResponse } from "@/core/http/respond";
import { exportAnonymizedAnalytics } from "@/modules/analytics/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const actor = await actorFromRequest(request);
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? 90);
    const timezone = url.searchParams.get("timezone") ?? "UTC";
    const includeBots = url.searchParams.get("includeBots") === "1";
    const artifact = await exportAnonymizedAnalytics.call(
      { days, timezone, includeBots },
      actor,
    );
    return new Response(artifact.content, {
      headers: {
        "content-type": `${artifact.mime}; charset=utf-8`,
        "content-disposition": `attachment; filename="${artifact.filename}"`,
        "cache-control": "private, no-store, max-age=0",
        pragma: "no-cache",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-freeholder-content-sha256": artifact.sha256,
      },
    });
  } catch (error) {
    return errorResponse(error, actor);
  }
}
