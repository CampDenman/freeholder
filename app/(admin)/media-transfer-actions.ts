// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import {cookies} from "next/headers";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {planStorageTransfer,advanceStorageTransfer} from "@/core/media/transfer-service";
import {reviewStorageTransferCall} from "@/core/media/transfer-recovery";
import {queueStorageTransferStep} from "@/core/media/transfer-jobs";
import {getT} from "../i18n";
export interface TransferActionState {error?:string;saved?:boolean;id?:string}
const text=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value:"";};
async function actor(){return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);}
export async function planStorageTransferAction(_state:TransferActionState,form:FormData):Promise<TransferActionState>{const t=await getT();try{const result=await planStorageTransfer.call({requestKey:text(form,"requestKey"),drainId:text(form,"drainId")||undefined,confirmation:z.literal("COPY ADOPT AND RETIRE ORIGINAL STORAGE").parse(text(form,"confirmation"))},await actor());revalidatePath("/admin/media/transfers");return{saved:true,id:result.id};}catch{return{error:t("media.transfer.failed")};}}
export async function advanceStorageTransferAction(_state:TransferActionState,form:FormData):Promise<TransferActionState>{const t=await getT();try{const id=text(form,"id"),action=z.enum(["copy","adopt","retire"]).parse(text(form,"action")),principal=await actor();if(text(form,"background")==="yes")await queueStorageTransferStep.call({id,action,requestKey:text(form,"requestKey")},principal);else await advanceStorageTransfer.call({id,action},principal);revalidatePath(`/admin/media/transfers/${id}`);return{saved:true};}catch{return{error:t("media.transfer.failed")};}}
export async function reviewStorageTransferAction(_state:TransferActionState,form:FormData):Promise<TransferActionState>{const t=await getT();try{await reviewStorageTransferCall.call({callId:text(form,"callId"),expectedWitness:text(form,"expectedWitness"),stopDrainId:text(form,"stopDrainId")||undefined,originalKey:text(form,"originalKey")||undefined,originalSourceKey:text(form,"originalSourceKey")||undefined,outcome:z.enum(["applied","not_applied","retired"]).parse(text(form,"outcome")),retryOriginal:text(form,"retryOriginal")==="yes",providerFinalReference:text(form,"providerFinalReference"),providerEvidence:text(form,"providerEvidence"),confirmation:z.literal("ORIGINAL CALLER AND PROVIDER OUTCOME CONFIRMED").parse(text(form,"confirmation"))},await actor());revalidatePath("/admin/media/transfers");revalidatePath(`/admin/media/transfers/${text(form,"planId")}`);return{saved:true};}catch{return{error:t("media.transfer.failed")};}}
