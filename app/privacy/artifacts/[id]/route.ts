// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Authenticated delivery: export bodies never become public media objects.
import { actorFromRequest } from "@/core/http/actor";
import { errorResponse } from "@/core/http/respond";
import {
  downloadDataRequestArtifact,
  downloadMyDataRequestArtifact,
} from "@/core/privacy/service";
import { hasModuleAccess } from "@/core/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await actorFromRequest(request);
  try {
    const id = (await context.params).id;
    const artifact = hasModuleAccess(actor, "contacts", "manage")
      ? await downloadDataRequestArtifact.call({ id }, actor)
      : await downloadMyDataRequestArtifact.call({ id }, actor);
    const filename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    return new Response(artifact.content, {
      headers: {
        "content-type": `${artifact.mime}; charset=utf-8`,
        "content-disposition": `attachment; filename="${filename}"`,
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
