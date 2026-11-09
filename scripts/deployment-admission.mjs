// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.33 trusted local host operator. No HTTP/MCP grant or owner impersonation.
// Authority is the existing root Docker/OS boundary; stdin never enters logs.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function parseDeploymentOperatorRequest(value){
  const allowed=new Set(['action','operationId','token','sourceRevision','proof']);
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!allowed.has(k))
    || !['begin','status','seal','resume','release'].includes(value.action) || !ID.test(value.operationId)
    || !/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{40}$/.test(value.sourceRevision)
    || (['release','resume'].includes(value.action)?!['published','private_restored'].includes(value.proof):value.proof!==undefined))throw Error('deployment_request_invalid');
  return {...value,tokenHash:createHash('sha256').update(value.token).digest('hex')};
}
export async function runDeploymentOperator(value,connection){
  const input=parseDeploymentOperatorRequest(value);
  const out=await connection.begin(async tx=>{
    await tx.unsafe("SET LOCAL statement_timeout='15000ms'");await tx.unsafe("SET LOCAL lock_timeout='5000ms'");
    const parameters=[input.operationId,input.tokenHash];
    const query=input.action==='begin'?'SELECT fh_deployment_hold_begin($1::uuid,$2,$3) AS result'
      :input.action==='release'?'SELECT fh_deployment_hold_release($1::uuid,$2,$3) AS result'
      :input.action==='resume'?'SELECT fh_deployment_hold_resume($1::uuid,$2,$3) AS result'
      :input.action==='seal'?'SELECT fh_deployment_hold_seal($1::uuid,$2) AS result':'SELECT fh_deployment_hold_status($1::uuid,$2) AS result';
    if(input.action==='begin')parameters.push(input.sourceRevision);if(['release','resume'].includes(input.action))parameters.push(input.proof);
    const rows=await tx.unsafe(query,parameters);const result=rows[0]?.result;
    if(result?.version!=='freeholder-deployment-admission-v1' || result.operationId!==input.operationId || result.sourceRevision!==input.sourceRevision)throw Error('deployment_response_unknown');
    return result;
  });
  return out;
}
async function main(){
  if(process.getuid?.()!==0)throw Error('deployment_operator_requires_root');
  let size=0;const parts=[];for await(const chunk of process.stdin){size+=chunk.length;if(size>4096)throw Error('deployment_request_bound');parts.push(chunk);}
  const value=JSON.parse(Buffer.concat(parts).toString('utf8'));parseDeploymentOperatorRequest(value);
  const {default:postgres}=await import('postgres');if(!process.env.DATABASE_URL)throw Error('deployment_database_unavailable');
  const connection=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:3,onnotice:()=>{}});
  try{console.log(JSON.stringify(await runDeploymentOperator(value,connection)));}finally{await connection.end({timeout:2});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  const safe=new Set(['deployment_request_invalid','deployment_request_bound','deployment_operator_requires_root','deployment_database_unavailable','deployment_response_unknown','deployment_hold_owner_mismatch','deployment_hold_busy','deployment_work_not_drained']);
  console.error(JSON.stringify({ok:false,code:safe.has(error?.message)?error.message:'deployment_operator_unknown',heldStateUnknown:true}));process.exitCode=1;
});
