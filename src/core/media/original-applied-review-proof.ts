// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A guarded affirmative review is an independent authority, never an actual
// return. This consumer rechecks its original positive bytes/nonce/inventory.
import type {TransferInventoryConfiguration,TransferInventoryEntry} from "../../../scripts/media-transfer.mjs";
import type {ActualOriginalProviderObject} from "./provider-request-proof";
import type {OriginalExecutorStop,OriginalQuiescentCaller,OriginalQuiescentRequest} from "./original-caller-quiescence";
import {requireQuiescentOriginalPut,requireStoppedPutRecoveryProof} from "./original-caller-quiescence";
import {requireOriginalPutRecoveryProof} from "./original-request-recovery-proof";
import {providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict} from "./transfer-proof";
export interface OriginalAppliedReview{
 id:string;objectReceiptId:string|null;objectId:string|null;multipartOperationId:string|null;
 callId:string;readCallId:string;inventoryId:string|null;outcome:string;permitsRetry:boolean;
 stopDrainId:string|null;originalCallWitness:string;
}
type Pass={configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};
export function requireAppliedOriginalPutReview(input:{receiptId:string;caller:OriginalQuiescentCaller&{state:string;stopReceiptId:string|null;stoppedAt:Date|null};requests:readonly OriginalQuiescentRequest[];stop:OriginalExecutorStop|null;review:OriginalAppliedReview;proofCallId:string;inventory:{id:string;state:string;purpose:string;objectReceiptId:string|null;anchorCallId:string|null;proofCallId:string|null;originalWitness:string|null;firstDigest:string|null;confirmedDigest:string|null;completedAt:Date|null};actual:ActualOriginalProviderObject;first:Pass;confirmed:Pass}){
 const{caller,review,inventory}=input;
 if(caller.state!=="stopped"||!caller.stoppedAt||caller.stopReceiptId!==review.id||review.objectReceiptId!==input.receiptId||review.objectId||review.multipartOperationId||review.callId!==caller.id||review.outcome!=="applied"||review.permitsRetry||review.readCallId!==input.proofCallId||review.inventoryId!==inventory.id||review.stopDrainId!==(input.stop?.id??null)||!/^[a-f0-9]{64}$/.test(review.originalCallWitness)||inventory.objectReceiptId!==input.receiptId||inventory.anchorCallId!==caller.id||inventory.proofCallId!==input.proofCallId||inventory.state!=="complete"||inventory.purpose!=="recovery"||!inventory.completedAt||!inventory.originalWitness||!/^[a-f0-9]{64}$/.test(inventory.originalWitness)||inventory.firstDigest!==providerInventoryDigest(input.first.configuration,input.first.entries)||inventory.confirmedDigest!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries))transferConflict("Keep the exact immutable applied review, original read and both complete positive inventories before retirement.");
 const original=requireQuiescentOriginalPut(caller,input.requests,input.stop);
 if(input.stop){
  if(original.mode!=="independent_stop")transferConflict("An applied stop review cannot replace actual portable finish evidence.");
  requireStoppedPutRecoveryProof({...input,stop:input.stop});
 }else requireOriginalPutRecoveryProof(input);
 return original.write;
}
