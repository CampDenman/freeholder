// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {randomUUID,createHash} from 'node:crypto';
import postgres from 'postgres';
import {afterAll,describe,it,expect,vi} from 'vitest';
import {db,closeDb} from '@/core/db';
import * as admission from '@/core/runtime/deployment-admission';
import * as jobs from '@/core/jobs';
import {endCall,sendSignal,startCall} from '@/modules/members/calls';
const url=process.env.DATABASE_URL,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
describe.runIf(Boolean(url))('C10.33 first producer registers outside caller transaction',()=>{
  const control=postgres(url!,{max:2}),operator=postgres(url!,{max:1});
  afterAll(async()=>{await jobs.stopJobs();await control.end();await operator.end();await closeDb();});
  it('an exclusive hold queued behind admitted work does not block that work on a second-connection registration',async()=>{
    const name='test.coldProducer',operationId=randomUUID(),hash=createHash('sha256').update('5'.repeat(64)).digest('hex');
    jobs.registerJob(jobs.defineJob({name,summary:'Synthetic cold producer lock order',handler:async()=>{}}));
    await jobs.prepareServiceJobRuntime();
    let entered!:()=>void,proceed!:()=>void;const admitted=new Promise<void>(resolve=>entered=resolve),continueWork=new Promise<void>(resolve=>proceed=resolve);
    const actual=admission.newDeploymentWorkAllowed;let intercepted=false;
    const spy=vi.spyOn(admission,'newDeploymentWorkAllowed').mockImplementation(async tx=>{
      const allowed=await actual(tx);if(!intercepted){intercepted=true;entered();await continueWork;}return allowed;
    });
    const work=db().transaction(tx=>jobs.enqueueJob(tx,name,{synthetic:'accepted only after commit'}));
    await admitted;
    let pid=0;const hold=operator.begin(async tx=>{
      pid=Number((await tx`SELECT pg_backend_pid() pid`)[0]!.pid);await tx`SET LOCAL lock_timeout='200ms'`;
      return (await tx`SELECT fh_deployment_hold_begin(${operationId}::uuid,${hash},${'d'.repeat(40)}) status`)[0]!.status as Record<string,unknown>;
    });
    const observed=hold.then(value=>({ok:true as const,value}),(error:unknown)=>({ok:false as const,code:typeof error==='object' && error!==null && 'code' in error?String(error.code):'unknown'}));
    try{
      let queued=false;for(let i=0;i<50;i++){
        if(pid){const rows=await control`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND classid=1691709 AND objid=33 AND mode='ExclusiveLock' AND NOT granted) waiting`;if(rows[0]!.waiting){queued=true;break;}}
        await wait(2);
      }
      expect(queued).toBe(true);proceed();const result=await observed;await work;
      expect(result).toMatchObject({ok:true});
      if(result.ok){expect(result.value.pendingJobs).toBeGreaterThanOrEqual(1);expect(result.value.readyToStop).toBe(false);}
    }finally{
      proceed();spy.mockRestore();await work.catch(()=>{});await observed;
      await control`SELECT fh_deployment_hold_release(${operationId}::uuid,${hash},'private_restored')`.catch(()=>{});
      const queued=await work.catch(()=>null),producer=await jobs.startJobProducer();
      if(queued && producer){
        await producer.work(name,{pollingIntervalSeconds:0.5},async()=>{});
        for(let i=0;i<50;i++){if((await producer.getJobById(name,queued.id))?.state==='completed')break;await wait(100);}
        expect((await producer.getJobById(name,queued.id))?.state).toBe('completed');await producer.offWork(name,{wait:true});
      }
    }
  },20_000);
  it('fails closed for unprepared direct queue callers, while a cold held service graph can signal and End an accepted call',async()=>{
    await jobs.stopJobs();
    await expect(db().transaction(tx=>jobs.enqueueJob(tx,'test.coldProducer'))).rejects.toThrow(/not prepared/);
    const operationId=randomUUID(),hash=createHash('sha256').update('4'.repeat(64)).digest('hex'),caller=randomUUID(),callee=randomUUID(),call=randomUUID();
    await control`INSERT INTO roles(key,name)VALUES('deployment-cold-member','Synthetic member') ON CONFLICT DO NOTHING`;
    await control`INSERT INTO users(id,email,role)VALUES(${caller},${caller+'@example.test'},'deployment-cold-member'),(${callee},${callee+'@example.test'},'deployment-cold-member')`;
    await control`INSERT INTO member_calls(id,caller_id,callee_id,media,state)VALUES(${call},${caller},${callee},'voice','active')`;
    await control`SELECT fh_deployment_hold_begin(${operationId}::uuid,${hash},${'d'.repeat(40)})`;
    const actor={kind:'user' as const,userId:caller,role:'customer',grants:[]};
    try{
      await expect(startCall.call({handle:'synthetic-not-looked-up',media:'voice'},actor)).rejects.toMatchObject({code:'conflict'});
      await sendSignal.call({callId:call,kind:'offer',payload:{type:'offer',sdp:'synthetic fixture only'}},actor);
      await expect(endCall.call({id:call},actor)).resolves.toEqual({ok:true});
      expect((await control`SELECT state FROM member_calls WHERE id=${call}`)[0]!.state).toBe('ended');
      expect((await control`SELECT phase FROM deployment_admission_holds WHERE operation_id=${operationId}`)[0]!.phase).toBe('draining');
    }finally{
      await control`SELECT fh_deployment_hold_release(${operationId}::uuid,${hash},'private_restored')`;
      await jobs.stopJobs();await control`DELETE FROM member_calls WHERE id=${call}`;await control`DELETE FROM users WHERE id IN(${caller},${callee})`;
    }
  },30_000);
});
