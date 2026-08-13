// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents always leave through this controlled attachment response. That is
// true even for public object storage, so a PDF/office file never becomes
// executable same-origin content and trash revokes the link immediately.
import { storage } from "@/adapters/storage";
import { authorizeAssetDownload } from "@/core/media/service";

export const dynamic = "force-dynamic";
const ANONYMOUS = { kind: "anonymous" } as const;

function attachment(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, "").slice(0, 180) || "download";
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const allowed = await authorizeAssetDownload.call({ id }, ANONYMOUS);
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
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
