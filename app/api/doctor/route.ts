// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor over HTTP (MASTER.md §17, §18).
//
// The door a recipe's CI uses: §18 wants the validation matrix to boot the
// image and run doctor, and the matrix has no shell inside the container. It
// signs in as the owner and asks here.
//
// Owner-only, because the report names which adapters are configured and how
// they are failing — precisely the reconnaissance somebody probing an instance
// would like. `/api/health` stays public and stays shallow.
import { actorFromRequest } from "@/core/http/actor";
import { doctor } from "@/core/doctor/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    // actorFromRequest rather than the cookie alone: a monitor watching this
    // endpoint should be able to hold a scoped key instead of a human session,
    // which is the entire point of §17 calling doctor a contract.
    const actor = await actorFromRequest(request);
    const report = await doctor.call({}, actor);
    // The HTTP status carries the verdict as well as the body, so a monitor
    // that only reads status codes still learns something true.
    return Response.json(report, { status: report.verdict === "fail" ? 503 : 200 });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "permission") {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
