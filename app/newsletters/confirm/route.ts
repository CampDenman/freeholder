// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { confirmSubscription } from "@/modules/newsletters/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new NextResponse("Missing confirmation token.", { status: 400 });
  try {
    await confirmSubscription.call({ token }, { kind: "anonymous" });
    return new NextResponse("Your subscription is confirmed.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("That confirmation link is not valid.", { status: 404 });
  }
}
