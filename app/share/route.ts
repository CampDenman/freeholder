// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Web Share Target for camera-roll / share-sheet ingest (C1.29).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { attachCaptureUpload, createUploadLink } from "@/core/media/capture";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const form = await request.formData();
  const files = form.getAll("media").concat(form.getAll("file")).filter((value) => value instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  let sessionToken = token;
  if (!sessionToken) {
    if (!actor || actor.kind !== "user") {
      return NextResponse.json({ error: "sign in or use an upload link" }, { status: 401 });
    }
    const created = await createUploadLink.call({ source: "share_sheet" }, actor);
    sessionToken = created.token;
  }
  const uploaded = [];
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await attachCaptureUpload.call(
      {
        token: sessionToken,
        filename: file.name || "shared.bin",
        contentType: file.type || "application/octet-stream",
        bytes,
      },
      actor ?? { kind: "anonymous" },
    );
    uploaded.push(result.session.id);
  }
  return NextResponse.redirect(new URL(`/capture/${sessionToken}`, request.url), 303);
}
