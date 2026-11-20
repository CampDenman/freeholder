// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Intent only: no URL, provider ACK, original FIN or consumption is inferred.
export interface OriginalMultipartPartIssue {
 format:"original-multipart-part-issue/v1";bodyManifestId:string;bodyManifestDigest:string;
 partNumber:number;sha256:string;bytes:number;expiresAt:string;
}
