// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A file somebody sent with a form, opened by the owner (C3.38).
//
// The asset is private, so it has no public URL to link to. This route asks
// `forms.openSubmissionFile` — staff-only, keyed by the attachment — and
// streams the bytes as a download that no cache keeps and no page can run.
import { actorFromRequest } from "@/core/http/actor";
import { storage } from "@/adapters/storage";
import { openSubmissionFile } from "@/modules/forms/service";

export const dynamic = "force-dynamic";

function attachment(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, "").slice(0, 180) || "download";
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const actor = await actorFromRequest(request);
  // A refusal and a missing file answer alike: the id is not evidence either way.
  const allowed = await openSubmissionFile.call({ id }, actor).catch(() => null);
  if (!allowed) return new Response(null, { status: 404 });
  const source = await storage().stream(allowed.storageKey);
  if (!source) return new Response(null, { status: 404 });
  const iterator = source[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(allowed.bytes),
      "content-disposition": attachment(allowed.filename),
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
