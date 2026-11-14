// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// An independent executor stop is not an actual caller return, and cannot prove
// an in-flight remote PUT unapplied. This proof enables positive nonce recovery
// only; portable actual finishes keep their existing non-Linux path.
import {z} from "zod";
import type {OriginalPhysicalRequest,ReturnedOriginalCaller} from "./original-request-recovery-proof";
import {requireFinishedOriginalPut} from "./original-request-recovery-proof";
import {requireOriginalProviderRequestResult,type ActualOriginalProviderObject,type OriginalProviderWriteAdmission} from "./provider-request-proof";
import {classifySourceInventory,providerInventoryDigest} from "./transfer-inventory-proof";
import type {TransferInventoryConfiguration,TransferInventoryEntry} from "../../../scripts/media-transfer.mjs";
import {transferConflict,transferDigest} from "./transfer-proof";
const processIdentity=z.object({pid:z.number().int().positive(),startTicks:z.string().regex(/^[0-9]+$/)}).strict();
const snapshotSchema=z.object({format:z.literal("freeholder.media-writer-drain/v1"),boot:z.uuid(),unit:z.literal("freeholder.service"),invocation:z.string().regex(/^[a-f0-9]{32}$/),group:z.string().regex(/^\/[A-Za-z0-9_.\/-]+$/).refine(value=>!value.includes("..")),processes:z.array(processIdentity).min(1).max(4096),recovery:z.object({format:z.literal("freeholder.media-transfer-drain/v1"),planId:z.uuid(),namespace:z.string().regex(/^[a-f0-9]{64}$/),snapshot:z.record(z.string(),z.unknown())}).strict().optional()}).strict();
export interface OriginalExecutorStop{
 id:string;namespace:string;state:string;sourceRevision:string;executorIdentity:string;
 originalProcesses:unknown;stopProofDigest:string|null;createdAt:Date;verifiedAt:Date|null;releasedAt:Date|null;
}
export interface OriginalQuiescentCaller extends ReturnedOriginalCaller{
 runtimeId:string;namespace:string;createdAt:Date;
}
export interface OriginalQuiescentRequest extends OriginalPhysicalRequest{createdAt:Date}
function time(value:Date|null):number{return value?.getTime()??NaN;}
/** The supplied stop must be read from the immutable actual executor ledger,
 * never synthesized from an owner-provided outcome or elapsed time. SQL and
 * the owning fresh-human recovery phase independently bind the same witness.
 */
export function requireQuiescentOriginalPut(caller:OriginalQuiescentCaller,requests:readonly OriginalQuiescentRequest[],stop:OriginalExecutorStop|null){
 if(caller.returnedAt&&requests.every(row=>row.returnedAt))return{write:requireFinishedOriginalPut(caller,requests),mode:"actual_finish"as const,stop:null};
 requireOriginalExecutorStop(caller,requests,stop);
 const writes=requests.filter(row=>row.descriptor.kind==="object.put");
 if(writes.length!==1||!writes[0]!.descriptor.createOnly||!writes[0]!.descriptor.key||!writes[0]!.descriptor.sha256||writes[0]!.descriptor.bytes===undefined||time(writes[0]!.createdAt)>time(stop.createdAt)||requests.some(row=>["object.delete","multipart.create","multipart.complete","multipart.abort"].includes(row.descriptor.kind)))transferConflict("Stopped original applied recovery requires one exact pre-fence create-only PUT; ambiguous retries or other mutations remain debt.");
 return{write:writes[0]!,mode:"independent_stop"as const,stop};
}

/** Shared exact LOCAL executor witness. This proves no future local dispatch;
 * it never proves a request already accepted remotely has finished. */
export function requireOriginalExecutorStop(caller:OriginalQuiescentCaller,requests:readonly OriginalQuiescentRequest[],stop:OriginalExecutorStop|null):asserts stop is OriginalExecutorStop{
 if(!stop||!["verified","released"].includes(stop.state)||stop.state==="verified"&&stop.releasedAt!==null||stop.state==="released"&&(!Number.isFinite(time(stop.releasedAt))||time(stop.releasedAt)<time(stop.verifiedAt))||stop.namespace!==caller.namespace||!stop.stopProofDigest||!/^[a-f0-9]{64}$/.test(stop.stopProofDigest)||!/^[a-f0-9]{40}$/.test(stop.sourceRevision)||!Number.isFinite(time(stop.createdAt))||!Number.isFinite(time(stop.verifiedAt))||time(stop.verifiedAt)<time(stop.createdAt)||!Number.isFinite(time(caller.createdAt))||time(caller.createdAt)>time(stop.createdAt))transferConflict("An actual unfinished original caller needs its exact independently verified executor stop, not a timeout,404 or written assertion.");
 const parsed=snapshotSchema.safeParse(stop.originalProcesses),runtime=caller.runtimeIdentity;
 if(!parsed.success||!("kind"in runtime)||runtime.kind!=="linux"||runtime.instance!==caller.runtimeId||stop.executorIdentity!==`linux-systemd:${runtime.boot}`||parsed.data.boot!==runtime.boot||new Set(parsed.data.processes.map(row=>row.pid)).size!==parsed.data.processes.length||!parsed.data.processes.some(row=>row.pid===runtime.pid&&row.startTicks===runtime.startTicks))transferConflict("The original runtime birth is not covered by this exact executor process witness. Other platforms need their own authentic executor proof.");
 if(!requests.length||requests.some(row=>row.callId!==caller.id||transferDigest(row.runtimeIdentity)!==transferDigest(runtime)||row.descriptorDigest!==transferDigest(row.descriptor)||row.descriptor.binding.namespace!==caller.namespace||!Number.isFinite(time(row.createdAt))||time(row.createdAt)>time(stop.verifiedAt)))transferConflict("Every exact original physical request must belong to the independently stopped runtime; no historical birth or request may be backfilled.");
}

/** A stop only establishes which local executor cannot issue another request.
 * Affirmative original provider nonce, full bytes and complete inventory must
 * independently establish that this SINGLE admitted PUT actually applied. */
export function requireStoppedPutRecoveryProof(input:{caller:OriginalQuiescentCaller;requests:readonly OriginalQuiescentRequest[];stop:OriginalExecutorStop;actual:ActualOriginalProviderObject;first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 const original=requireQuiescentOriginalPut(input.caller,input.requests,input.stop);
 if(original.mode!=="independent_stop")transferConflict("Use the actual-finish path without inventing a stopped executor.");
 return requirePositiveOriginalInventory(original.write,input.actual,input.first,input.confirmed);
}

function requirePositiveOriginalInventory(write:OriginalProviderWriteAdmission,actual:ActualOriginalProviderObject,first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]},confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}){
 const revision=requireOriginalProviderRequestResult(write,actual);
 if(providerInventoryDigest(first.configuration,first.entries)!==providerInventoryDigest(confirmed.configuration,confirmed.entries))transferConflict("Both complete original provider inventories must agree after independent stop.");
 const classified=classifySourceInventory(first.configuration,first.entries.filter(row=>row.key===actual.key),[{id:write.id,key:actual.key,bytes:actual.bytes,originalRevision:revision}],actual.namespace);
 if(!classified.complete)transferConflict("Retained versions, sessions or conflicting physical provenance remain debt after executor stop.");
 return revision;
}
