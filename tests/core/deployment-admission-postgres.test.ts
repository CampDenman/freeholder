// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {randomUUID,createHash} from 'node:crypto';
import postgres from 'postgres';
import {PgBoss} from 'pg-boss';
import {sql} from 'drizzle-orm';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {db,closeDb} from '@/core/db';
import {newDeploymentCallAllowed,newDeploymentWorkAllowed,withDeploymentContinuation,admitDeploymentRuntime,
  acknowledgeDeploymentDrain,markDeploymentRuntimeStopped} from '@/core/runtime/deployment-admission';
import {startCall} from '@/modules/members/calls';
import {startGroupCall} from '@/modules/members/group-calls';
import {runDeploymentOperator} from '../../scripts/deployment-admission.mjs';

const hasDatabase=Boolean(process.env.DATABASE_URL),sourceRevision='a'.repeat(40),token='7'.repeat(64);
describe.runIf(hasDatabase)('C10.33 real PostgreSQL same-lock call admission fence',()=>{
  const connection=postgres(process.env.DATABASE_URL!,{max:3});let queue:PgBoss;
  const request=(operationId:string,action:string,proof?:string)=>({action,operationId,token,sourceRevision,...(proof?{proof}:{})});
  beforeAll(async()=>{queue=new PgBoss({connectionString:process.env.DATABASE_URL!,schedule:false,supervise:false,max:1});await queue.start();});
  afterAll(async()=>{await queue?.stop({graceful:true});await connection.end();await closeDb();});
  it('waits for the admitted transaction to commit before exposing the hold and never hides its late call',async()=>{
    const operationId=randomUUID(),runtime=randomUUID(),caller=randomUUID(),callee=randomUUID(),call=randomUUID();
    await connection`INSERT INTO roles(key,name,is_system)VALUES('deployment-test-member','Synthetic member',false) ON CONFLICT DO NOTHING`;
    await connection`INSERT INTO users(id,email,role)VALUES(${caller},${caller+'@example.test'},'deployment-test-member'),(${callee},${callee+'@example.test'},'deployment-test-member')`;
    await admitDeploymentRuntime(runtime);
    let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),blocked=new Promise<void>(resolve=>release=resolve);
    const admitted=db().transaction(async tx=>{expect(await newDeploymentCallAllowed(tx)).toBe(true);enter();await blocked;
      await tx.execute(sql`INSERT INTO member_calls(id,caller_id,callee_id,media,state)VALUES(${call}::uuid,${caller}::uuid,${callee}::uuid,'voice','ringing')`);});
    await entered;let completed=false;const begin=runDeploymentOperator(request(operationId,'begin'),connection).then(result=>{completed=true;return result;});
    await new Promise(resolve=>setTimeout(resolve,80));expect(completed).toBe(false);release();await admitted;
    try{
      const held=await begin;expect(held.calls).toBe(1);expect(held.readyToStop).toBe(false);
      expect(await db().transaction(newDeploymentCallAllowed)).toBe(false);
      expect(await withDeploymentContinuation(()=>db().transaction(newDeploymentCallAllowed))).toBe(false);
      expect(await db().transaction(newDeploymentWorkAllowed)).toBe(false);
      expect(await withDeploymentContinuation(()=>db().transaction(newDeploymentWorkAllowed))).toBe(true);
      let delayed!:Promise<boolean>;
      const spawnLater=()=>new Promise<boolean>((resolve,reject)=>{setTimeout(()=>{db().transaction(newDeploymentWorkAllowed).then(resolve,reject);},10);});
      await withDeploymentContinuation(async()=>{delayed=spawnLater();expect(await db().transaction(newDeploymentWorkAllowed)).toBe(true);});
      expect(await delayed).toBe(false);
      await expect(withDeploymentContinuation(async()=>{delayed=spawnLater();throw Error('synthetic accepted handler failure');})).rejects.toThrow();
      expect(await delayed).toBe(false);
      await withDeploymentContinuation(async()=>{await withDeploymentContinuation(async()=>{expect(await db().transaction(newDeploymentWorkAllowed)).toBe(true);});expect(await db().transaction(newDeploymentWorkAllowed)).toBe(true);});
      for(const service of [startCall,startGroupCall])await expect(service.def.handler({}as never,{tx:db(),actor:{kind:'system'}}as never)).rejects.toMatchObject({code:'conflict'});
      await markDeploymentRuntimeStopped(runtime);expect((await runDeploymentOperator(request(operationId,'status'),connection)).pendingRuntimes).toBe(1);
      expect(await acknowledgeDeploymentDrain(runtime,randomUUID())).toBe(false);expect(await acknowledgeDeploymentDrain(runtime,operationId)).toBe(true);
      await expect(runDeploymentOperator(request(operationId,'seal'),connection)).rejects.toBeDefined();
      // This is the same transaction boundary used by an accepted End; no new-call guard runs here.
      await withDeploymentContinuation(()=>db().transaction(async tx=>{expect(await newDeploymentWorkAllowed(tx)).toBe(true);await tx.execute(sql`UPDATE member_calls SET state='ended',ended_at=now() WHERE id=${call}::uuid`);}));
      const sealed=await runDeploymentOperator(request(operationId,'seal'),connection);expect(sealed.phase).toBe('sealed');expect(sealed.readyToStop).toBe(true);
      expect(await withDeploymentContinuation(()=>db().transaction(newDeploymentWorkAllowed))).toBe(false);
      const rows=await connection`SELECT * FROM deployment_admission_holds WHERE operation_id=${operationId}`;expect(JSON.stringify(rows)).not.toContain(token);expect(rows[0]!.token_sha256).toBe(createHash('sha256').update(token).digest('hex'));
      await expect(runDeploymentOperator({...request(operationId,'release','private_restored'),token:'8'.repeat(64)},connection)).rejects.toBeDefined();
    }finally{
      await runDeploymentOperator(request(operationId,'release','private_restored'),connection);
      await connection`DELETE FROM member_calls WHERE id=${call}`;await connection`DELETE FROM users WHERE id IN(${caller},${callee})`;
      await markDeploymentRuntimeStopped(runtime);
    }
    expect(await db().transaction(newDeploymentCallAllowed)).toBe(true);
    await expect(runDeploymentOperator(request(operationId,'begin'),connection)).rejects.toBeDefined();
  });
  it('refuses foreign holds and source mismatches without releasing another operation or guessing missing runtimes drained',async()=>{
    const operationId=randomUUID();await runDeploymentOperator(request(operationId,'begin'),connection);
    try{
      await expect(runDeploymentOperator(request(randomUUID(),'begin'),connection)).rejects.toBeDefined();
      await expect(runDeploymentOperator({...request(operationId,'release','published'),sourceRevision:'b'.repeat(40)},connection)).rejects.toBeDefined();
      const status=await runDeploymentOperator(request(operationId,'status'),connection);expect(status.held).toBe(true);expect(status.readyToStop).toBe(false);
    }finally{await runDeploymentOperator(request(operationId,'release','private_restored'),connection);}
  });
});
