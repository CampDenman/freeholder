// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from "node:crypto";
import Link from "next/link";
import {storageTransferStatus} from "@/core/media/transfer-service";
import {listStorageTransferRecovery} from "@/core/media/transfer-recovery";
import {Card,Callout} from "@/ui/primitives";
import {getT} from "../../../../../i18n";
import {requireStaffActor} from "../../../guard";
import {AdvanceTransferForm,ReviewTransferForm} from "../TransferForms";
import {transferLabels} from "../labels";
export const dynamic="force-dynamic";
export default async function StorageTransferPage({params}:{params:Promise<{id:string}>}){
 const{id}=await params,actor=await requireStaffActor("media","manage"),t=await getT(),labels=transferLabels(t);
 const[status,recovery]=await Promise.all([storageTransferStatus.call({id},actor),listStorageTransferRecovery.call({id},actor)]);
 const needsStepUp=actor.kind==="user"&&actor.security!==undefined&&!actor.security.stepUpValid;
 return <div className="grid min-w-0 gap-6"><h1 className="text-xl font-bold">{labels.title}</h1><Link href="/admin/media/transfers" className="font-semibold text-accent underline">{labels.back}</Link><Card className="grid gap-4"><p>{t(`media.transfer.state.${status.state}`)}</p><p className="text-sm">{labels.files}: {status.objects} · {labels.verified}: {status.verified} · {labels.retired}: {status.retired}</p>{status.pendingRecovery?<Callout>{labels.recovery}</Callout>:null}<AdvanceTransferForm id={id} requestKey={randomUUID()} labels={labels}/></Card>
 {needsStepUp?<Callout><a href={`/security/verify?returnTo=${encodeURIComponent(`/admin/media/transfers/${id}`)}`} className="underline">{labels.verify}</a></Callout>:null}
 {recovery.rows.map(row=><Card key={row.id} className="grid min-w-0 gap-4"><p className="font-semibold">{t(`media.transfer.operation.${row.kind}`)}</p><p className="break-all font-mono text-sm" dir="ltr">{row.key}</p>{!needsStepUp?<ReviewTransferForm planId={id} row={row} labels={labels}/>:null}</Card>)}
 </div>;
}
