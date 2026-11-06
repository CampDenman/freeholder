// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: one chunk of a reserved import export file. The body is raw bytes,
// read with its own bound (one chunk), so no other route's limit changes and
// the request proxy's buffer is never the thing that cuts a file short.
import { serviceRoute } from "@/core/http/route";
import { readBoundedBytes } from "@/core/http/body";
import { IMPORT_SOURCE_CHUNK_BYTES, uploadSourceChunk } from "@/core/import/source-upload";

export const POST = serviceRoute(uploadSourceChunk, {
  readInput: async (request) => {
    const params = new URL(request.url).searchParams;
    return {
      id: params.get("id") ?? "",
      uploadId: params.get("uploadId") ?? "",
      index: Number(params.get("index") ?? "-1"),
      bytes: await readBoundedBytes(request, IMPORT_SOURCE_CHUNK_BYTES),
    };
  },
});
