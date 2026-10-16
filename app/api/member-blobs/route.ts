// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.36: upload one file a device already encrypted. The body is ciphertext.
import { serviceRoute } from "@/core/http/route";
import { readBoundedBytes } from "@/core/http/body";
import { MAX_SEALED_BYTES, uploadSealedBlob } from "@/modules/members/sealed-blobs";

export const POST = serviceRoute(uploadSealedBlob, {
  readInput: async (request) => ({
    conversationId: new URL(request.url).searchParams.get("conversation") ?? "",
    // AES-GCM adds a 16-byte tag to the file.
    bytes: await readBoundedBytes(request, MAX_SEALED_BYTES + 16),
  }),
});
