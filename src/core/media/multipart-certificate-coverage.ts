// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: historical identity, complete current evidence and an actual
// erasure entitlement are three different contracts. None authorizes I/O.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {requireOriginalMultipartRetirementProof,type OriginalMultipartRetirementProof} from "./multipart-retirement-certificate-proof";
import {transferConflict,transferDigest} from "./transfer-proof";

export interface OriginalMultipartCertificateCoverage {
 id:string;
 proof:OriginalMultipartRetirementProof;
 proofDigest:string;
 current:boolean;
}

/** Every certificate stays immutable. Selecting by the complete current
 * frontier, rather than creation time, cannot hide a late caller or fact. */
export async function readOriginalMultipartCertificateCoverage(tx:Tx,resourceId:string):Promise<OriginalMultipartCertificateCoverage|null>{
 const[available]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_multipart_certificate_coverage(uuid)') is not null as present`);
 if(available?.present!==true)return null;
 const rows=await tx.execute<{id:string;proof:unknown;digest:string;intact:boolean;current:boolean}>(sql`select review.id,review.retirement_proof as proof,review.provider_evidence_digest as digest,freeholder_media_multipart_retirement_certificate_intact(review.id) as intact,freeholder_media_multipart_certificate_coverage(review.id) as current from media_storage_transfer_reviews review join media_multipart_operations operation on operation.id=review.multipart_operation_id where operation.resource_id=${resourceId}::uuid and review.retirement_proof is not null order by review.id limit 50001`);
 if(!rows.length)return null;
 if(rows.length>50000||rows.some(row=>row.intact!==true))transferConflict("Keep every immutable original upload certificate for review; no subset may replace its first identity.");
 const candidates=rows.filter(row=>row.current===true).map(row=>{
  const proof=requireOriginalMultipartRetirementProof(row.proof);
  if(proof.resource.id!==resourceId||transferDigest(proof)!==row.digest)transferConflict();
  return{id:row.id,proof,proofDigest:row.digest,current:true};
 });
 if(!candidates.length)return null;
 const first=candidates[0]!;
 if(candidates.some(row=>row.proofDigest!==first.proofDigest))transferConflict("Conflicting current upload frontiers require recovery; a newer timestamp cannot choose between them.");
 return first;
}
