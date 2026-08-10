// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Uploading a file.
//
// Multipart rather than JSON, so a plain <form> works and the browser streams
// the body instead of the page base64-encoding it into memory first. That is
// also why this route reads its own input rather than taking serviceRoute's
// JSON default — everything after the parse is the standard wrapper.
//
// §18 note: the bytes go to the storage adapter, never to instance disk, and
// this app never becomes the thing holding an owner's archive. Uploads pass
// *through* the app for now; presigned direct-to-bucket uploads are tracked by
// `MASTER.md` §43 item C1.12.
import { uploadAsset } from "@/core/media/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(uploadAsset, {
  readInput: async (request) => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return {};
    return {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      altText: typeof form.get("altText") === "string"
        ? (form.get("altText") as string)
        : undefined,
    };
  },
});
