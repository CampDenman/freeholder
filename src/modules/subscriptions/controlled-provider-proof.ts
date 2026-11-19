// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual new controlled callers never borrow legacy phase or later-reader proof.
import { getTableColumns, sql, type InferSelectModel, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { verifiedProviderReadProof } from "./provider-read-signatures";
import { CONTROLLED_HISTORICAL_FIN_PROTOCOL } from "@/adapters/payments/merchant-controlled-safe-response-contract";
import { resolveControlledVerificationView } from "./controlled-provider-safe-response-proof";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts,subscriptionControlledFinishes,subscriptionControlledStops,subscriptionControlledVerifications,subscriptionControlledChargeOrigins,subscriptionControlledClosures } from "./controlled-provider-schema";
export const CONTROLLED_CALL_PURPOSE="subscription_controlled_provider_caller.v1";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledCaller=z.object({id:z.uuid(),pid:z.number().int().positive(),host:z.string().min(1).max(500),startedAt:z.iso.datetime(),bootId:z.string().nullable(),pidNamespace:z.string().nullable(),startTicks:z.string().nullable()}).strict();
type Operation=typeof subscriptionControlledOperations.$inferSelect;
type Call=typeof subscriptionControlledCalls.$inferSelect;
type Finish=typeof subscriptionControlledFinishes.$inferSelect;
type Stop=typeof subscriptionControlledStops.$inferSelect;
export function originalControlledCall(operation:Operation,call:Call){
 const proof=verifiedProviderReadProof(call.admission,"admission"),p=proof?.payload,birth=controlledCaller.safeParse(p?.caller);
 return proof&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.operationId===operation.id&&p.callId===call.id&&call.operationId===operation.id
  &&p.resourceId===operation.resourceId&&p.requestDigest===operation.requestDigest&&merchantTaxDigest(operation.originalRequest)===operation.requestDigest
  &&p.kind===operation.kind&&sha.safeParse(p.completionDigest).success&&p.admittedSourceRevision===operation.previousEvidenceRevision
  &&birth.success&&birth.data.id===p.callerId&&merchantTaxDigest(call.admission)===call.admissionDigest?proof:null;
}
function finishedWithOriginal(operation:Operation,call:Call,finish:Finish,original:ReturnType<typeof originalControlledCall>){
 const proof=verifiedProviderReadProof(finish.proof,"finish"),p=proof?.payload;
 return !!original&&!!proof&&finish.callId===call.id&&proof.publicKey===original.publicKey&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.callId===call.id
  &&p.operationId===operation.id&&p.resourceId===operation.resourceId&&p.requestDigest===operation.requestDigest&&p.admissionDigest===call.admissionDigest
  &&p.callerId===original.payload.callerId&&p.completionDigest===original.payload.completionDigest&&["returned","threw"].includes(String(p.outcome))
  &&p.outcome===finish.actualResult.outcome&&p.factsDigest===merchantTaxDigest(finish.actualResult)&&finish.proofDigest===merchantTaxDigest(finish.proof);
}
export function finishedControlledCall(operation:Operation,call:Call,finish:Finish|null,original?:ReturnType<typeof originalControlledCall>){
 if(!finish)return false;
 return finishedWithOriginal(operation,call,finish,original===undefined?originalControlledCall(operation,call):original);
}
function stoppedWithOriginal(operation:Operation,call:Call,stop:Stop,original:ReturnType<typeof originalControlledCall>){
 const proof=verifiedProviderReadProof(stop.proof,"stop_review"),p=proof?.payload;
 return !!original&&!!proof&&stop.callId===call.id&&p?.purpose===CONTROLLED_CALL_PURPOSE&&p.callId===call.id&&p.operationId===operation.id&&p.resourceId===operation.resourceId
  &&p.requestDigest===operation.requestDigest&&p.admissionDigest===call.admissionDigest&&p.callerId===original.payload.callerId
  &&merchantTaxDigest(p.originalAdmission)===merchantTaxDigest(call.admission)&&typeof p.reviewedBy==="string"&&/^user:[a-f0-9-]{36}$/.test(p.reviewedBy)
  &&["original_process_absent","unobservable_host_review"].includes(String(p.mechanicalCheck))&&sha.safeParse(p.hostingEvidenceDigest).success&&sha.safeParse(p.currentEvidenceRevision).success
  &&stop.proofDigest===merchantTaxDigest(stop.proof);
}
export function stoppedControlledCall(operation:Operation,call:Call,stop:Stop|null,original?:ReturnType<typeof originalControlledCall>){
 if(!stop)return false;
 return stoppedWithOriginal(operation,call,stop,original===undefined?originalControlledCall(operation,call):original);
}
type JournalRows={
 operations:Operation[];calls:Call[];
 facts:Array<typeof subscriptionControlledFacts.$inferSelect>;
 finishes:Finish[];stops:Stop[];
 verifications:Array<typeof subscriptionControlledVerifications.$inferSelect>;
 chargeOrigins:Array<typeof subscriptionControlledChargeOrigins.$inferSelect>;
 closures:Array<typeof subscriptionControlledClosures.$inferSelect>;
};
const journalRowFamilies=["operations","calls","facts","finishes","stops","verifications","chargeOrigins","closures"] as const;
const journalFamilies=["resources",...journalRowFamilies] as const;
const journalCount=z.number().int().min(0).max(5001);
const journalContent=z.object({
 domain:z.literal("controlled_journal_pg_content.v1"),resourceId:z.uuid(),fingerprint:sha,
 counts:z.object({resources:journalCount.max(1),operations:journalCount,calls:journalCount,facts:journalCount,finishes:journalCount,stops:journalCount,verifications:journalCount,chargeOrigins:journalCount,closures:journalCount.max(2)}).strict(),
 physicalCount:z.number().int().nonnegative().max(45009),physicalBytes:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
type JournalContent=z.infer<typeof journalContent>;
const journalWire=z.object({domain:z.unknown(),resourceId:z.unknown(),fingerprint:z.unknown(),counts:z.unknown(),physicalCount:z.unknown(),physicalBytes:z.unknown(),inventory:z.unknown()}).strict();
function refuseJournalContent():never{throw new ServiceError("conflict","The complete original controlled journal changed or its PostgreSQL content cannot be certified; retain every actual row and read it independently again.");}
function countJournalRows(rows:JournalRows){return 1+rows.closures.length+rows.chargeOrigins.length+rows.operations.length+rows.calls.length+rows.facts.length+rows.finishes.length+rows.stops.length+rows.verifications.length;}
function sameJournalContent(a:JournalContent,b:JournalContent){return a.domain===b.domain&&a.resourceId===b.resourceId&&a.fingerprint===b.fingerprint&&a.physicalCount===b.physicalCount&&a.physicalBytes===b.physicalBytes&&journalFamilies.every(family=>a.counts[family]===b.counts[family]);}
/** Only the actual present column types are losslessly carried in this wire.
 * A future bigint/numeric/array/custom column must get its own reviewed decoder,
 * never round through a JSON number. This does not narrow any current row. */
function journalColumns<T extends PgTable>(table:T){
 const columns=getTableColumns(table);
 for(const column of Object.values(columns)){
  const simple=(column.columnType==="PgUUID"&&column.dataType==="string"&&column.getSQLType()==="uuid")
   ||(column.columnType==="PgText"&&column.dataType==="string"&&column.getSQLType()==="text")
   ||(column.columnType==="PgInteger"&&column.dataType==="number"&&column.getSQLType()==="integer")
   ||(column.columnType==="PgJsonb"&&column.dataType==="json"&&column.getSQLType()==="jsonb")
   ||(column.columnType==="PgTimestamp"&&column.dataType==="date"&&/^timestamp(?: \(\d+\))? with time zone$/.test(column.getSQLType()));
  if(!simple)refuseJournalContent();
 }
 return columns;
}
function journalRowWire<T extends PgTable>(table:T,alias:string):SQL{
 const fields=Object.entries(journalColumns(table)).flatMap(([key,column])=>{
  const value=sql`${sql.identifier(alias)}.${sql.identifier(column.name)}`;
  return[sql`${key}::text`,column.dataType==="json"?sql`(${value})::text`:value];
 });
 return sql`jsonb_build_object(${sql.join(fields,sql`,`)})`;
}
function decodeJournalRows<T extends PgTable>(table:T,wire:unknown):Array<InferSelectModel<T>>{
 const columns=journalColumns(table),keys=Object.keys(columns);
 const rows=z.array(z.record(z.string(),z.unknown())).max(5001).safeParse(wire);
 if(!rows.success)refuseJournalContent();
 return rows.data.map(row=>{
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))refuseJournalContent();
  const values=Object.entries(columns).map(([key,column])=>{
   const value=row[key];if(value===null){if(column.notNull)refuseJournalContent();return[key,null];}
   if(column.dataType==="number"?(typeof value!=="number"||!Number.isInteger(value)||value< -2147483648||value>2147483647):typeof value!=="string")refuseJournalContent();
   const decoded:unknown=column.mapFromDriverValue(value);
   if(column.dataType==="date"&&(!(decoded instanceof Date)||!Number.isFinite(decoded.getTime())))refuseJournalContent();
   return[key,decoded];
  });
  return Object.fromEntries(values) as InferSelectModel<T>;
 });
}
/** Certificate and optional MISS rows share one statement snapshot. Primary-key
 * joins are equivalent to the original IN predicates and retain every order,
 * limit and empty result. The added resource family certifies root changes. */
async function readJournalContent(tx:Tx,resourceId:string,includeInventory:boolean){
 journalColumns(subscriptionControlledResources);
 const rows=includeInventory?await tx.execute(sql`/* controlled-journal-content-certificate.v1 */
  WITH actual_resource AS MATERIALIZED(SELECT r.id FROM subscription_controlled_resources r WHERE r.id=${resourceId}::uuid),
  actual_operations AS MATERIALIZED(SELECT o.* FROM subscription_controlled_operations o WHERE o.resource_id=${resourceId}::uuid ORDER BY o.ordinal LIMIT 5001),
  actual_calls AS MATERIALIZED(SELECT c.* FROM subscription_controlled_calls c JOIN actual_operations o ON o.id=c.operation_id ORDER BY c.id LIMIT 5001),
  actual_facts AS MATERIALIZED(SELECT f.* FROM subscription_controlled_facts f JOIN actual_calls c ON c.id=f.call_id ORDER BY f.call_id,f.ordinal LIMIT 5001),
  actual_finishes AS MATERIALIZED(SELECT f.* FROM subscription_controlled_finishes f JOIN actual_calls c ON c.id=f.call_id ORDER BY f.call_id LIMIT 5001),
  actual_stops AS MATERIALIZED(SELECT s.* FROM subscription_controlled_stops s JOIN actual_calls c ON c.id=s.call_id ORDER BY s.call_id LIMIT 5001),
  actual_verifications AS MATERIALIZED(SELECT v.* FROM subscription_controlled_verifications v JOIN actual_operations o ON o.id=v.operation_id ORDER BY v.operation_id LIMIT 5001),
  actual_origins AS MATERIALIZED(SELECT o.* FROM subscription_controlled_charge_origins o WHERE o.resource_id=${resourceId}::uuid ORDER BY o.receipt_id LIMIT 5001),
  actual_closures AS MATERIALIZED(SELECT c.* FROM subscription_controlled_closures c WHERE c.resource_id=${resourceId}::uuid LIMIT 2),
  head AS MATERIALIZED(SELECT h.* FROM subscription_controlled_journal_heads h WHERE h.resource_id=${resourceId}::uuid)
  SELECT 'controlled_journal_pg_content.v1'::text AS domain,${resourceId}::text AS "resourceId",
   coalesce(h.fingerprint,encode(sha256(convert_to('[]','UTF8')),'hex')) AS fingerprint,
   coalesce(h.counts,jsonb_build_object('resources',0,'operations',0,'calls',0,'facts',0,'finishes',0,'stops',0,'verifications',0,'chargeOrigins',0,'closures',0)) AS counts,
   coalesce(h.physical_count,0) AS "physicalCount",coalesce(h.physical_bytes,0)::text AS "physicalBytes",jsonb_build_object(
    'operations',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledOperations,"o")} ORDER BY o.ordinal) FROM actual_operations o),'[]'::jsonb),
    'calls',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledCalls,"c")} ORDER BY c.id) FROM actual_calls c),'[]'::jsonb),
    'facts',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledFacts,"f")} ORDER BY f.call_id,f.ordinal) FROM actual_facts f),'[]'::jsonb),
    'finishes',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledFinishes,"f")} ORDER BY f.call_id) FROM actual_finishes f),'[]'::jsonb),
    'stops',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledStops,"s")} ORDER BY s.call_id) FROM actual_stops s),'[]'::jsonb),
    'verifications',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledVerifications,"v")} ORDER BY v.operation_id) FROM actual_verifications v),'[]'::jsonb),
    'chargeOrigins',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledChargeOrigins,"o")} ORDER BY o.receipt_id) FROM actual_origins o),'[]'::jsonb),
    'closures',coalesce((SELECT jsonb_agg(${journalRowWire(subscriptionControlledClosures,"c")}) FROM actual_closures c),'[]'::jsonb)
   ) AS inventory FROM (VALUES(1)) AS required(_) LEFT JOIN actual_resource r ON TRUE LEFT JOIN head h ON TRUE
   WHERE (r.id IS NULL)=(h.resource_id IS NULL)`)
  :await tx.execute(sql`WITH actual_resource AS MATERIALIZED(SELECT r.id FROM subscription_controlled_resources r WHERE r.id=${resourceId}::uuid),
   head AS MATERIALIZED(SELECT h.* FROM subscription_controlled_journal_heads h WHERE h.resource_id=${resourceId}::uuid)
   SELECT 'controlled_journal_pg_content.v1'::text AS domain,${resourceId}::text AS "resourceId",
   coalesce(h.fingerprint,encode(sha256(convert_to('[]','UTF8')),'hex')) AS fingerprint,
   coalesce(h.counts,jsonb_build_object('resources',0,'operations',0,'calls',0,'facts',0,'finishes',0,'stops',0,'verifications',0,'chargeOrigins',0,'closures',0)) AS counts,
   coalesce(h.physical_count,0) AS "physicalCount",coalesce(h.physical_bytes,0)::text AS "physicalBytes",NULL AS inventory
   FROM (VALUES(1)) AS required(_) LEFT JOIN actual_resource r ON TRUE LEFT JOIN head h ON TRUE
   WHERE (r.id IS NULL)=(h.resource_id IS NULL)`);
 const[actual]=rows;
 const wire=journalWire.safeParse(actual);if(!wire.success)refuseJournalContent();
 const{inventory,...fields}=wire.data,bytes=z.string().regex(/^(0|[1-9][0-9]*)$/).safeParse(fields.physicalBytes);
 if(!bytes.success)refuseJournalContent();
 const parsed=journalContent.safeParse({...fields,physicalBytes:Number(bytes.data)});if(!parsed.success)refuseJournalContent();
 const content=parsed.data,physicalCount=journalFamilies.reduce((sum,family)=>sum+content.counts[family],0);
 if(content.resourceId!==resourceId||content.physicalCount!==physicalCount||(!includeInventory&&inventory!==null))refuseJournalContent();
 if(1+physicalCount-content.counts.resources>5000)throw new ServiceError("conflict","Restore the complete bounded original controlled caller/fact inventory; truncated history cannot authorize another operation.");
 return{content,inventory};
}
function decodeJournalInventory(inventory:unknown):JournalRows{
 const parsed=z.object({operations:z.unknown(),calls:z.unknown(),facts:z.unknown(),finishes:z.unknown(),stops:z.unknown(),verifications:z.unknown(),chargeOrigins:z.unknown(),closures:z.unknown()}).strict().safeParse(inventory);
 if(!parsed.success)refuseJournalContent();
 return{operations:decodeJournalRows(subscriptionControlledOperations,parsed.data.operations),calls:decodeJournalRows(subscriptionControlledCalls,parsed.data.calls),facts:decodeJournalRows(subscriptionControlledFacts,parsed.data.facts),finishes:decodeJournalRows(subscriptionControlledFinishes,parsed.data.finishes),stops:decodeJournalRows(subscriptionControlledStops,parsed.data.stops),verifications:decodeJournalRows(subscriptionControlledVerifications,parsed.data.verifications),chargeOrigins:decodeJournalRows(subscriptionControlledChargeOrigins,parsed.data.chargeOrigins),closures:decodeJournalRows(subscriptionControlledClosures,parsed.data.closures)};
}
function requireJournalMembership(rows:JournalRows,content:JournalContent){
 if(journalRowFamilies.some(family=>rows[family].length!==content.counts[family]))refuseJournalContent();
 if(countJournalRows(rows)!==1+content.physicalCount-content.counts.resources)refuseJournalContent();
}
function firstBy<T>(rows:readonly T[],key:(row:T)=>string){const indexed=new Map<string,T>();for(const row of rows)if(!indexed.has(key(row)))indexed.set(key(row),row);return indexed;}
function validateJournalBase(rows:JournalRows,resourceId:string){
 const{operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures}=rows;
 const operationsById=firstBy(operations,row=>row.id),callsById=firstBy(calls,row=>row.id),factsById=firstBy(facts,row=>row.id),finishesByCall=firstBy(finishes,row=>row.callId),stopsByCall=firstBy(stops,row=>row.callId);
 const factsByCall=new Map<string,typeof facts>();for(const fact of facts){const siblings=factsByCall.get(fact.callId)??[];siblings.push(fact);factsByCall.set(fact.callId,siblings);}
 verifications.sort((left,right)=>(operationsById.get(left.operationId)?.ordinal??0)-(operationsById.get(right.operationId)?.ordinal??0));
 const count=countJournalRows(rows);
 if(count>5000)throw new ServiceError("conflict","Restore the complete bounded original controlled caller/fact inventory; truncated history cannot authorize another operation.");
 if(operations.some((operation,index)=>operation.resourceId!==resourceId||operation.ordinal!==index+1||merchantTaxDigest(operation.originalRequest)!==operation.requestDigest)
  ||new Set(calls.map(row=>row.operationId)).size!==calls.length)throw new ServiceError("conflict","Restore every original contiguous operation and its single actual physical invocation.");
 for(const fact of facts){const siblings=factsByCall.get(fact.callId)??[];
  if(fact.actualDigest!==merchantTaxDigest(fact.actual)||siblings.some((row,index)=>row.ordinal!==index+1))throw new ServiceError("conflict","Preserve the complete ordered original raw occurrences without replacement or truncation.");
 }
 // Validated object identities are reused only within this synchronous pass.
 const validatedCalls=new Map<Call,{operation:Operation;call:Call;finish:Finish|null;stop:Stop|null;finished:boolean;stopped:boolean}>();
 for(const call of calls){const operation=operationsById.get(call.operationId),finish=finishesByCall.get(call.id)??null,stop=stopsByCall.get(call.id)??null;
  const original=operation?originalControlledCall(operation,call):null;
  if(!operation||!original)throw new ServiceError("conflict","Restore authentic original controlled request/admission/actual finish or independent stop; never reconstruct or supersede it.");
  const finished=finish?finishedWithOriginal(operation,call,finish,original):false;
  if(finish&&!finished)throw new ServiceError("conflict","Restore authentic original controlled request/admission/actual finish or independent stop; never reconstruct or supersede it.");
  const stopped=stop?stoppedWithOriginal(operation,call,stop,original):false;
  if(stop&&!stopped||finish&&stop)throw new ServiceError("conflict","Restore authentic original controlled request/admission/actual finish or independent stop; never reconstruct or supersede it.");
  validatedCalls.set(call,{operation,call,finish,stop,finished,stopped});
 }
 for(const verification of verifications){const operation=operationsById.get(verification.operationId),call=callsById.get(verification.callId),finish=finishesByCall.get(verification.callId);
  const validated=call?validatedCalls.get(call):undefined;
  if(!operation||!call||call.operationId!==operation.id||!finish||!validated||validated.operation!==operation||validated.call!==call||validated.finish!==finish||!validated.finished||finish.actualResult.outcome!=="returned"
   ||verification.actualResult.protocol!==CONTROLLED_HISTORICAL_FIN_PROTOCOL&&merchantTaxDigest(finish.actualResult.result)!==verification.actualResultDigest||merchantTaxDigest(verification.actualResult)!==verification.actualResultDigest)
   throw new ServiceError("conflict","A verified result must remain the exact actual original returned SDK value and signed caller.");
 }
 for(const origin of chargeOrigins){const operation=operationsById.get(origin.operationId),call=callsById.get(origin.callId),fact=factsById.get(origin.factId);
  if(!operation||!call||!fact||origin.resourceId!==resourceId||call.operationId!==operation.id||fact.callId!==call.id||fact.actual.kind!=="cash_observed")
   throw new ServiceError("conflict","Preserve the exact canonical receipt's actual original resource, operation, caller and positive bank fact.");
 }
 if(closures.some(row=>row.proofDigest!==merchantTaxDigest(row.proof)))throw new ServiceError("conflict","Preserve the exact original financial closure receipt.");
 const unfinished=calls.filter(call=>!finishesByCall.has(call.id)&&!stopsByCall.has(call.id)).map(row=>row.id);
 return {operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures,unfinished,count,revision:merchantTaxDigest({operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures})};
}
type RetainedJournal={content:JournalContent;rows:JournalRows;revision:string;bytes:number;physicalCount:number};
type VerificationView=Awaited<ReturnType<typeof resolveControlledVerificationView>>;
type RetainedViews={certificate:string;views:VerificationView[]};
// Raw base data only, bounded to this actual Tx; no views or authority verdicts.
const decodedControlledJournals=new WeakMap<Tx,Map<string,RetainedJournal>>();
const controlledVerificationViews=new WeakMap<Tx,Map<string,RetainedViews>>();
const journalCertificates=new WeakMap<object,string>();
export function controlledJournalPgCertificate(history:object){const certificate=journalCertificates.get(history);if(!certificate)throw new ServiceError("conflict","Require the journal's actual fresh PostgreSQL content certificate.");return certificate;}
const journalRetention={resources:4,rows:10000,bytes:16*1024*1024} as const;
function freezeJournalSnapshot(value:unknown):void{if(value&&typeof value==="object"){for(const child of Object.values(value))freezeJournalSnapshot(child);Object.freeze(value);}}
function cloneJournalValue(value:unknown):unknown{
 if(value===null||typeof value!=="object")return value;
 if(value instanceof Date)return new Date(value.getTime());
 if(Array.isArray(value)){const length=value.length,clone=new Array<unknown>(length);for(let index=0;index<length;index++)if(index in value)clone[index]=cloneJournalValue(value[index]);return clone;}
 const source=value as Record<string,unknown>,keys=Object.keys(source),clone:Record<string,unknown>={};
 for(let index=0;index<keys.length;index++){const key=keys[index]!;clone[key]=cloneJournalValue(source[key]);}
 return clone;
}
function retainJournalBase(tx:Tx,content:JournalContent,rows:JournalRows,revision:string){
 const retained=decodedControlledJournals.get(tx)??new Map<string,RetainedJournal>();retained.delete(content.resourceId);
 if(content.counts.resources!==1||content.physicalBytes>journalRetention.bytes||content.physicalCount>journalRetention.rows)return;
 const bytes=Buffer.byteLength(JSON.stringify(rows),"utf8");if(bytes>journalRetention.bytes)return;
 const snapshot=cloneJournalValue(rows) as JournalRows;freezeJournalSnapshot(snapshot);
 const entry={content,rows:snapshot,revision,bytes,physicalCount:content.physicalCount};
 while(retained.size>=journalRetention.resources||[...retained.values()].reduce((sum,value)=>sum+value.bytes,bytes)>journalRetention.bytes||[...retained.values()].reduce((sum,value)=>sum+value.physicalCount,content.physicalCount)>journalRetention.rows){const oldest=retained.keys().next().value;if(oldest===undefined)return;retained.delete(oldest);}
 retained.set(content.resourceId,entry);decodedControlledJournals.set(tx,retained);
}
/** Every reuse and return is preceded by fresh complete PG certification. Raw
 * rows are cloned; only deterministic deeply frozen safe views may be reused
 * for the same actual content certificate, never an authority verdict. */
export async function controlledProviderJournal(tx:Tx,resourceId:string){
 const before=await readJournalContent(tx,resourceId,false);
 const retained=decodedControlledJournals.get(tx)?.get(resourceId),hit=retained!==undefined&&sameJournalContent(retained.content,before.content);
 let history:ReturnType<typeof validateJournalBase>;
 if(hit&&retained){
  const rows=cloneJournalValue(retained.rows) as JournalRows,{operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures}=rows;
  const finishesByCall=firstBy(finishes,row=>row.callId),stopsByCall=firstBy(stops,row=>row.callId);
  const unfinished=calls.filter(call=>!finishesByCall.has(call.id)&&!stopsByCall.has(call.id)).map(row=>row.id);
  history={operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures,unfinished,count:countJournalRows(rows),revision:retained.revision};
 }else{
  const atomic=await readJournalContent(tx,resourceId,true);if(!sameJournalContent(before.content,atomic.content))refuseJournalContent();
  const rows=decodeJournalInventory(atomic.inventory);requireJournalMembership(rows,atomic.content);history=validateJournalBase(rows,resourceId);
 }
 requireJournalMembership(history,before.content);
 const{operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures,unfinished,count,revision}=history;
 const operationsById=firstBy(operations,row=>row.id),callsById=firstBy(calls,row=>row.id),finishesByCall=firstBy(finishes,row=>row.callId);
 const retainedViews=controlledVerificationViews.get(tx)?.get(resourceId),reuseViews=retainedViews?.certificate===before.content.fingerprint;
 const verificationViews=reuseViews&&retainedViews?retainedViews.views:await Promise.all(verifications.map(verification=>{
  const operation=operationsById.get(verification.operationId),call=callsById.get(verification.callId),finish=finishesByCall.get(verification.callId);
  if(!operation||!call||!finish)throw new ServiceError("conflict","Restore the validated original verification ancestry before resolving its safe view.");
  return resolveControlledVerificationView(tx,operation,call,finish,verification);
 }));
 const after=await readJournalContent(tx,resourceId,false);if(!sameJournalContent(before.content,after.content))refuseJournalContent();
 if(!reuseViews){const byResource=controlledVerificationViews.get(tx)??new Map<string,RetainedViews>();if(byResource.size>=journalRetention.resources){const oldest=byResource.keys().next().value;if(oldest!==undefined)byResource.delete(oldest);}Object.freeze(verificationViews);byResource.set(resourceId,{certificate:after.content.fingerprint,views:verificationViews});controlledVerificationViews.set(tx,byResource);}
 if(!hit)retainJournalBase(tx,after.content,{operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures},revision);
 const result={operations,calls,facts,finishes,stops,verifications,verificationViews,chargeOrigins,closures,unfinished,count,revision};journalCertificates.set(result,after.content.fingerprint);return result;
}
export async function assertControlledCallersQuiesced(tx:Tx,resourceId:string){
 const history=await controlledProviderJournal(tx,resourceId);
 if(history.unfinished.length)throw new ServiceError("conflict","The actual original controlled provider caller remains unfinished. Its genuine finish or independent actual runtime stop must precede a new caller.");
 return history;
}
/** Exact physical SQL fingerprints stay private. Full accounting of these
 * families must be composed with the original resource/profile/cash graph. */
export const controlledProviderSqlHash=(row:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
