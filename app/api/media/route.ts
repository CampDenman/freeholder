// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Uploading a file.
//
// Multipart rather than JSON, so a plain <form> works without base64 expansion.
// The request is capped before formData buffers the bounded proxy body. That is
// also why this route reads its own input rather than taking serviceRoute's
// JSON default — everything after the parse is the standard wrapper.
//
// §18 note: the bytes go to the storage adapter, never to instance disk, and
// this app never becomes the thing holding an owner's archive. Small uploads
// pass through the app; large files use presigned multipart URLs to private
// S3-compatible storage.
import { uploadAsset } from "@/core/media/service";
import { PROXY_UPLOAD_LIMIT } from "@/core/media/validation";
import { serviceRoute } from "@/core/http/route";
import { ServiceError } from "@/core/service";

export const POST = serviceRoute(uploadAsset, {
  readInput: async (request) => {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > PROXY_UPLOAD_LIMIT + 1024 * 1024) {
      throw new ServiceError(
        "validation",
        "That request is too large for the upload proxy. Use resumable direct upload.",
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return {};
    return {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      uploadId:
        typeof form.get("uploadId") === "string"
          ? (form.get("uploadId") as string) || undefined
          : undefined,
      altText: typeof form.get("altText") === "string"
        ? (form.get("altText") as string)
        : undefined,
      metadata: {
        width: number(form, "width"),
        height: number(form, "height"),
        durationSeconds: number(form, "durationSeconds"),
      },
      provenance: {
        lastModifiedAt:
          file.lastModified > 0
            ? new Date(file.lastModified).toISOString()
            : undefined,
      },
    };
  },
});

function number(form: FormData, key: string): number | undefined {
  const value = form.get(key);
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
