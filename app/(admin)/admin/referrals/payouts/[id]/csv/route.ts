// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The payout batch as a file (MASTER.md §4.13, C9.10).
//
// §4.13: "v1 is manual and batched with a CSV the owner can hand to their bank
// or accountant." Handing it over means a file, so this is a route rather than
// a block of text on a page an owner has to select and copy. The service
// already produces the CSV and its filename; this only sets the headers that
// make a browser save it.
import { actorFromRequest } from "@/core/http/actor";
import { batchCsv } from "@/modules/referrals/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const actor = await actorFromRequest(request);
    const file = await batchCsv.call({ batchId: id }, actor);
    return new Response(file.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        // A payout file names people and amounts. It must not sit in a shared
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
