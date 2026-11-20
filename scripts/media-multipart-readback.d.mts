// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface OriginalMultipartReadbackPart{partNumber:number;etag:string;bytes?:number;checksumSha256?:string}
export function originalMultipartReadback(parts:readonly OriginalMultipartReadbackPart[],maxBytes:number):{partsDigest:string;update(chunk:Uint8Array):void;finish():{partsDigest:string;bytes:number}};
