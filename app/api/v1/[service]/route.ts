// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The whole HTTP API, in one route (MASTER.md §11, §28).
//
// There is no list of endpoints here and there never will be: the segment is
// a service name, and the registry decides what exists. A module that ships a
// service ships an endpoint for it, with validation, permissions, rate limits
// and audit already attached — see src/core/api/dispatch.ts for why that is a
// projection rather than a layer.
import { dispatch } from "@/core/api/dispatch";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ service: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return dispatch(request, (await params).service);
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return dispatch(request, (await params).service);
}
