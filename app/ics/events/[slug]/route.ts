// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { eventCalendar } from "@/modules/events/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ics = await eventCalendar.call({ slug }, { kind: "anonymous" });
  if (!ics) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.ics"`,
    },
  });
}
