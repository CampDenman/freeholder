// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from "node:crypto";
import Link from "next/link";
import {listStorageTransfers,storageTransferConfiguration} from "@/core/media/transfer-service";
import {Card,Callout} from "@/ui/primitives";
import {getT} from "../../../../i18n";
import {requireStaffActor} from "../../guard";
import {PlanTransferForm} from "./TransferForms";
import {transferLabels} from "./labels";
export const dynamic="force-dynamic";
export default async function StorageTransfersPage(){
 const actor=await requireStaffActor("media","manage"),t=await getT(),labels=transferLabels(t);
 let configured:Awaited<ReturnType<typeof storageTransferConfiguration.call>>|undefined,rows:Awaited<ReturnType<typeof listStorageTransfers.call>>["rows"]=[];
 try{configured=await storageTransferConfiguration.call({},actor);rows=(await listStorageTransfers.call({},actor)).rows;}catch{}
 const needsStepUp=actor.kind==="user"&&actor.security!==undefined&&!actor.security.stepUpValid;
 return <div className="grid min-w-0 gap-6"><div><h1 className="text-xl font-bold">{labels.title}</h1><p className="mt-2 text-sm text-ink-muted">{labels.intro}</p></div><Link href="/admin/media" className="font-semibold text-accent underline">{labels.back}</Link>
 {configured?<Card className="grid min-w-0 gap-4"><dl className="grid gap-2 text-sm"><dt className="font-semibold">{labels.source}</dt><dd className="break-all" dir="ltr">{configured.source.kind} · {configured.source.location.bucket}</dd><dt className="font-semibold">{labels.target}</dt><dd className="break-all" dir="ltr">{configured.target.kind} · {configured.target.location.bucket}</dd></dl>{needsStepUp?<Callout><a href="/security/verify?returnTo=%2Fadmin%2Fmedia%2Ftransfers" className="underline">{labels.verify}</a></Callout>:<PlanTransferForm requestKey={randomUUID()} labels={labels}/>}</Card>:<Callout>{labels.configure}</Callout>}
 {!rows.length?<Callout>{labels.empty}</Callout>:rows.map(row=><Card key={row.id} className="grid gap-2"><Link href={`/admin/media/transfers/${row.id}`} className="font-semibold text-accent underline">{labels.open}</Link><p>{t(`media.transfer.state.${row.state}`)}</p><p className="text-sm text-ink-muted">{labels.files}: {row.objects} · {labels.verified}: {row.verified} · {labels.retired}: {row.retired}</p>{row.pendingRecovery?<Callout>{labels.recovery}</Callout>:null}</Card>)}
 </div>;
}
