// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Doctor over HTTP (MASTER.md §17, §18).
//
// The door a recipe's CI uses: §18 wants the validation matrix to boot the
// image and run doctor, and the matrix has no shell inside the container. It
// signs in as the owner and asks here.
//
// Owner-only, because the report names which adapters are configured and how
// they are failing — precisely the reconnaissance somebody probing an instance
// would like. `/api/health` stays public and stays shallow.
import {doctor,doctorStatus} from "@/core/doctor/service";
import {serviceRoute} from "@/core/http/route";
export const dynamic="force-dynamic";
// GET has no physical side effects. POST requires explicit probe scope/manage
// permission and the same CSRF/service/audit boundary as every other mutation.
const present=(report:Awaited<ReturnType<typeof doctor.call>>)=>({body:report,status:report.verdict==="fail"?503:200,headers:{"cache-control":"no-store"}});
export const GET=serviceRoute(doctorStatus,{present});
export const POST=serviceRoute(doctor,{present});
