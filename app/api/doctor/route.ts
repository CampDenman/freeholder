// Copyright (C) 2026 Camp Denman Society
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
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { doctor } from "@/core/doctor/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const actor = await actorFromToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    );
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
