// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The export as a file (MASTER.md §2535, §43 C9.32).
//
// A route rather than a block of text on a page, because handing a file to an
// accounting package means handing over a file. This is the staff-only
// recovery door. Emailed recipients use a separate expiring bearer route
// because they are deliberately external addresses rather than users.
import { actorFromRequest } from "@/core/http/actor";
import { exportFile } from "@/modules/reporting/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;
  try {
    const actor = await actorFromRequest(request);
    const file = await exportFile.call({ runId }, actor);
    return new Response(file.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        // Every customer and what they paid. It must not sit in a shared
        // cache, and it must not be indexed.
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      const status =
        error.code === "permission" ? 403 : error.code === "not_found" ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }
}
