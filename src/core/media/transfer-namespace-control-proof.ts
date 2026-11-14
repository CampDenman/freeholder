// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Genuine ancestry does not authorize one transfer through another controller.
import {transferConflict} from "./transfer-proof";
export interface TransferNamespacePlan{
 id:string;sourceNamespace:string;targetNamespace:string;state:string;sourceDrainId:string|null;sourceStopEvidenceDigest:string;createdAt:Date;
}
export interface TransferNamespaceDrain{id:string;state:string;namespace:string;stopProofDigest:string|null;verifiedAt:Date|null}
export function requireTransferNamespaceControl(input:{plan:TransferNamespacePlan;objectState:string;namespace:string;kind:string;sourceClaims:readonly {id:string;state:string}[];drains:readonly TransferNamespaceDrain[]}):void{
 const{plan,kind,namespace}=input;
 if(plan.sourceNamespace===plan.targetNamespace)transferConflict("Source and target cannot claim one indistinguishable namespace generation.");
 const target=kind==="target_put"||kind==="privacy_delete";
 if(!["target_put","source_delete","privacy_delete","privacy_source_delete"].includes(kind)||namespace!==(target?plan.targetNamespace:plan.sourceNamespace))transferConflict("This transfer mutation does not belong to its actual original namespace and role.");
 if(kind==="target_put"&&(!["planned","copying"].includes(plan.state)||!["planned","copying"].includes(input.objectState))||kind==="source_delete"&&(!["adopted","cleanup_pending"].includes(plan.state)||!["adopted","cleanup_pending"].includes(input.objectState)))transferConflict("An earlier transfer caller cannot mutate after its owning plan phase has ended.");
 if(input.sourceClaims.some(other=>other.id!==plan.id&&!["complete","cancelled"].includes(other.state)))transferConflict("Another current source claim controls this namespace; genuine ancestry in an earlier plan grants no mutation.");
 for(const drain of input.drains){
  if(drain.namespace!==namespace||drain.state==="released")continue;
  if(target||plan.sourceNamespace!==namespace||drain.id!==plan.sourceDrainId||drain.state!=="verified"||!drain.stopProofDigest||drain.stopProofDigest!==plan.sourceStopEvidenceDigest||!drain.verifiedAt||!Number.isFinite(drain.verifiedAt.getTime())||!Number.isFinite(plan.createdAt.getTime())||drain.verifiedAt>plan.createdAt)transferConflict("An unrelated or later executor drain controls this namespace. Retain the exact current-plan recovery association before any new mutation.");
 }
}
