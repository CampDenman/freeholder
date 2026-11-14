// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original browser ETags select the completion manifest; provider listings
// verify it and never replace it. Body checksums come from the first declaration.
import type {MultipartPart} from "@/adapters/storage/types";
import type {OriginalMultipartPartBodies} from "./multipart-part-bodies-proof";
import {exactMultipartPartBodies} from "./multipart-part-bodies-proof";
import {transferConflict} from "./transfer-proof";
export function originalMultipartCompleteManifest(input:readonly MultipartPart[],original:OriginalMultipartPartBodies):MultipartPart[]{
 const bodies=exactMultipartPartBodies(original.parts,original.expectedBytes);
 if(input.length!==bodies.length)transferConflict("Finish every part of the same original file before completing this upload.");
 return input.map((part,index)=>{
  const body=bodies[index];
  if(!body||part.partNumber!==body.partNumber||typeof part.etag!=="string"||!part.etag||part.etag.length>256||/[\u0000-\u001f\u007f]/.test(part.etag))transferConflict("Keep the exact original ordered upload-part receipts for completion.");
  const checksumSha256=Buffer.from(body.sha256,"hex").toString("base64");
  if(part.bytes!==undefined&&part.bytes!==body.bytes||part.checksumSha256!==undefined&&part.checksumSha256!==checksumSha256)transferConflict("The upload-part receipt differs from the original file declaration.");
  return{partNumber:body.partNumber,etag:part.etag,bytes:body.bytes,checksumSha256};
 });
}
