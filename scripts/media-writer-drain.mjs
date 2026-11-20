// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: operator-only Linux systemd executor. No provider I/O, secrets
// or claim links are read. Capture precedes stop; verification never sends STOP.
import {readFile,readdir} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash,randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import postgres from "postgres";
import {requireTransferDrainAssociation} from "./media-transfer-drain-proof.mjs";
const exec=promisify(execFile);
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict=()=>{throw Error("The exact original writer process group has not been proven stopped. The namespace remains fenced.");};
async function unit(){
 const {stdout}=await exec("systemctl",["show","freeholder.service","--property=MainPID,ControlGroup,InvocationID,ActiveState,SubState"],{encoding:"utf8",maxBuffer:65536});
 const values=Object.fromEntries(stdout.trim().split("\n").map(line=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1)];}));
 if(values.ControlGroup&&(!/^\/[A-Za-z0-9_.\/-]+$/.test(values.ControlGroup)||values.ControlGroup.includes("..")))conflict();
 return values;
}
async function processIdentity(pid){
 try{
  const text=await readFile(`/proc/${pid}/stat`,"utf8"),end=text.lastIndexOf(") "),fields=text.slice(end+2).trim().split(/\s+/);
  if(end<0||!fields[19]||!/^\d+$/.test(fields[19]))conflict();
  return{pid,startTicks:fields[19]};
 }catch(error){if(error?.code==="ENOENT")return null;throw error;}
}
async function members(group){
 const pids=new Set();let visited=0;
 async function scan(path,depth){
  if(++visited>4096||depth>32)conflict();
  const text=await readFile(`${path}/cgroup.procs`,"utf8");
  for(const value of text.trim()?text.trim().split(/\s+/):[]){const pid=Number(value);if(!Number.isSafeInteger(pid)||pid<=1)conflict();pids.add(pid);}
  for(const entry of await readdir(path,{withFileTypes:true}))if(entry.isDirectory())await scan(`${path}/${entry.name}`,depth+1);
 }
 await scan(`/sys/fs/cgroup${group}`,0);
 return(await Promise.all([...pids].map(processIdentity))).filter(Boolean).sort((a,b)=>a.pid-b.pid);
}
export async function runMediaWriterDrain({sql,action,namespace,sourceRevision,id,planId}){
 if(process.platform!=="linux"||process.getuid?.()!==0)throw Error("Run the writer-drain executor as root on the original Linux host.");
 if(!/^[a-f0-9]{64}$/.test(namespace)||!/^([a-f0-9]{40})$/.test(sourceRevision)||!["capture","verify","release"].includes(action))throw Error("Explicit original namespace, source revision and capture/verify action are required.");
 if(planId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(planId))throw Error("Use the exact original transfer plan UUID for a recovery association.");
 const boot=(await readFile("/proc/sys/kernel/random/boot_id","utf8")).trim();
 if(action==="capture"){
  const drainId=randomUUID();
  // Durable namespace admission closes BEFORE the process inventory is read.
  const recovery=await sql.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(1691709,82)`;
   await tx`select set_config('freeholder.media_transfer_operator_v1','1',true)`;
   await tx`insert into media_storage_writer_drains(id,namespace,state,source_revision,executor_identity) values(${drainId},${namespace},'capturing',${sourceRevision},${`linux-systemd:${boot}`})`;
   if(!planId)return null;
   const[plan]=await tx`select id from media_storage_transfer_plans where id=${planId}::uuid and state not in ('complete','cancelled')`;
   if(!plan)conflict();
   const[row]=await tx`select freeholder_media_transfer_recovery_snapshot(${planId}::uuid,${namespace}) as snapshot`;
   if(!row?.snapshot)conflict();
   return requireTransferDrainAssociation({format:"freeholder.media-transfer-drain/v1",planId,namespace,snapshot:row.snapshot},{planId,namespace,snapshot:row.snapshot});
  });
  const original=await unit(),processes=await members(original.ControlGroup);
  if(original.ActiveState!=="active"||!original.InvocationID||!processes.length||!processes.some(value=>value.pid===Number(original.MainPID)))conflict();
  const snapshot={format:"freeholder.media-writer-drain/v1",boot,unit:"freeholder.service",invocation:original.InvocationID,group:original.ControlGroup,processes,...(recovery?{recovery}:{})};
  await sql.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(1691709,82)`;
   await tx`select set_config('freeholder.media_transfer_operator_v1','1',true)`;
   const changed=await tx`update media_storage_writer_drains set original_processes=${tx.json(snapshot)},state='captured',updated_at=now() where id=${drainId} and state='capturing' returning id`;
   if(changed.length!==1)conflict();
  });
  return{drainId,state:"captured",...(recovery?{planId:recovery.planId}:{}),next:"Stop freeholder.service using the original host's operator session, then run verify with this drain ID."};
 }
 if(action==="release"){
  await sql.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(1691709,82)`;
   await tx`select set_config('freeholder.media_transfer_operator_v1','1',true)`;
   const [original]=await tx`select * from media_storage_writer_drains where id=${id} and namespace=${namespace} and source_revision=${sourceRevision} for update`;
   if(!original||original.state!=="verified"||!original.verified_at||!original.stop_proof_digest)conflict();
   const active=await tx`select id from media_storage_transfer_plans where (source_namespace=${namespace} or target_namespace=${namespace}) and state not in ('complete','cancelled') limit 1`;
   const uncertain=await tx`select id from media_object_writes where storage_namespace=${namespace} and state in ('unverified','started','unknown') limit 1`;
   const[association]=await tx`select freeholder_media_transfer_recovery_drain_releasable(${id}::uuid) as releasable`;
   const[ordinary]=await tx`select freeholder_media_original_drain_releasable(${id}::uuid) as releasable`;
   if(original.original_processes?.recovery){const[current]=await tx`select freeholder_media_transfer_recovery_snapshot(${original.original_processes.recovery.planId}::uuid,${namespace}) as snapshot`;requireTransferDrainAssociation(original.original_processes.recovery,{planId,namespace,snapshot:current?.snapshot});}
   if((active.length||original.original_processes?.recovery)?!association?.releasable:!ordinary?.releasable)conflict();
   if(uncertain.length||planId!==undefined&&original.original_processes?.recovery?.planId!==planId)conflict();
   await tx`update media_storage_writer_drains set state='released',released_at=now(),updated_at=now() where id=${id} and state='verified'`;
  });
  return{drainId:id,state:"released",originalStopWitnessPreserved:true};
 }
 const [drain]=await sql`select * from media_storage_writer_drains where id=${id} and namespace=${namespace} and source_revision=${sourceRevision}`;
 if(!drain||drain.state!=="captured"||drain.executor_identity!==`linux-systemd:${boot}`)conflict();
 const original=drain.original_processes;
 if(original?.format!=="freeholder.media-writer-drain/v1"||original.boot!==boot||original.unit!=="freeholder.service"||!original.processes?.length)conflict();
 const current=await unit();
 if(!["inactive","failed"].includes(current.ActiveState)||Number(current.MainPID)!==0)conflict();
 for(const process of original.processes){const alive=await processIdentity(process.pid);if(alive?.startTicks===process.startTicks)conflict();}
 // The original group may have been removed after systemd reaped it.
 try{if((await members(original.group)).length)conflict();}catch(error){if(error?.code!=="ENOENT")throw error;}
 const proof={original,sourceRevision,namespace,verifiedBoot:boot,unitState:current.ActiveState,allOriginalProcessesAbsent:true,originalCgroupEmpty:true};
 const stopProofDigest=digest(proof);
 await sql.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(1691709,82)`;
  await tx`select set_config('freeholder.media_transfer_operator_v1','1',true)`;
  const changed=await tx`update media_storage_writer_drains set state='verified',stop_proof_digest=${stopProofDigest},verified_at=now(),updated_at=now() where id=${id} and state='captured' and original_processes=${tx.json(original)} returning id`;
  if(changed.length!==1)conflict();
 });
 return{drainId:id,state:"verified",stopProofDigest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const value=name=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:undefined;};
 const sql=postgres(process.env.DATABASE_URL,{max:1,connection:{TimeZone:"UTC"},onnotice:()=>{}});
 try{console.log(JSON.stringify(await runMediaWriterDrain({sql,action:value("action"),namespace:value("namespace"),sourceRevision:value("source-revision"),id:value("id"),planId:value("plan-id")})));}
 catch{console.error("Original writer drain is not verified. Keep the fenced namespace and restore its exact operator evidence.");process.exitCode=1;}
 finally{await sql.end();}
}
