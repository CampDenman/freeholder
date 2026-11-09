// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {PgBoss} from 'pg-boss';
import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {closeDb} from '@/core/db';
import {ensureDeploymentCronFence,admitDeploymentRuntime,acknowledgeDeploymentDrain,markDeploymentRuntimeStopped} from '@/core/runtime/deployment-admission';
import {runDeploymentOperator} from '../../scripts/deployment-admission.mjs';
import {resetDeploymentFixture} from '../helpers/deployment';
const url=process.env.DATABASE_URL,token='6'.repeat(64),sourceRevision='c'.repeat(40);
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>Promise<boolean>,attempts=80){for(let i=0;i<attempts;i++){if(await check())return;await wait(100);}throw Error('synthetic scheduler fixture deadline');}
describe.runIf(Boolean(url))('C10.33 installed pg-boss cron admission and recovery',()=>{
  const connection=postgres(url!,{max:3});let boss:PgBoss;
  const op=(operationId:string,action:string,proof?:string)=>runDeploymentOperator({action,operationId,token,sourceRevision,...(proof?{proof}:{})},connection);
  beforeAll(async()=>{boss=new PgBoss({connectionString:url!,schedule:false,supervise:false,max:2});await boss.start();await ensureDeploymentCronFence();});
  beforeEach(()=>resetDeploymentFixture(connection));
  afterAll(async()=>{await boss.stop({graceful:true});await connection.end();await closeDb();});
  it('makes a previously accepted cron insertion visible before hold; holds new triggers without deleting or failing the accepted row',async()=>{
    const operationId=randomUUID(),runtime=randomUUID();let entered!:()=>void,release!:()=>void;
    const accepted=new Promise<void>(resolve=>entered=resolve),finish=new Promise<void>(resolve=>release=resolve);let jobId:string|null=null;
    await boss.createQueue('__pgboss__send-it');
    const insertion=connection.begin(async tx=>{
      jobId=await boss.send('__pgboss__send-it',{synthetic:'prehold accepted'}, {db:{executeSql:async(text:string,values:unknown[])=>({rows:await tx.unsafe(text,values as never[])})}});
      entered();await finish;
    });
    await accepted;let held=false;const begin=op(operationId,'begin').then(value=>{held=true;return value;});
    await wait(80);expect(held).toBe(false);release();await insertion;
    try{
      const status=await begin;expect(Number(status.pendingJobs)).toBeGreaterThanOrEqual(1);
      await expect(boss.send('__pgboss__send-it',{synthetic:'new held recurrence'})).rejects.toBeDefined();
      expect((await boss.getJobById('__pgboss__send-it',jobId!))?.state).toBe('created');
      await boss.work('__pgboss__send-it',{pollingIntervalSeconds:0.5},async()=>{});
      await until(async()=>(await boss.getJobById('__pgboss__send-it',jobId!))?.state==='completed');
      await boss.offWork('__pgboss__send-it',{wait:true});
      await admitDeploymentRuntime(runtime);await acknowledgeDeploymentDrain(runtime,operationId);
      expect((await op(operationId,'seal')).phase).toBe('sealed');
      await expect(boss.send('__pgboss__send-it',{synthetic:'new sealed recurrence'})).rejects.toBeDefined();
      expect((await op(operationId,'resume','private_restored')).phase).toBe('resuming');
      const resumed=await boss.send('__pgboss__send-it',{synthetic:'resumed recurrence'});expect(resumed).toBeTruthy();
      await boss.work('__pgboss__send-it',{pollingIntervalSeconds:0.5},async()=>{});
      await until(async()=>(await boss.getJobById('__pgboss__send-it',resumed!))?.state==='completed');await boss.offWork('__pgboss__send-it',{wait:true});
    }finally{await op(operationId,'release','private_restored');await markDeploymentRuntimeStopped(runtime);}
  });
  it('refuses to adopt a foreign trigger instead of overwriting its custody',async()=>{
    await connection`CREATE FUNCTION fh_synthetic_foreign_cron() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`;
    try{
      await connection`DROP TRIGGER freeholder_deployment_cron_admission ON pgboss.job`;
      await connection`CREATE TRIGGER freeholder_deployment_cron_admission BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION fh_synthetic_foreign_cron()`;
      await expect(ensureDeploymentCronFence()).rejects.toThrow('deployment_cron_fence_unknown');
      const row=await connection`SELECT tgfoid=to_regprocedure('fh_synthetic_foreign_cron()') AS untouched FROM pg_trigger WHERE tgrelid='pgboss.job'::regclass AND tgname='freeholder_deployment_cron_admission'`;
      expect(row[0]!.untouched).toBe(true);
    }finally{await connection`DROP TRIGGER IF EXISTS freeholder_deployment_cron_admission ON pgboss.job`;await ensureDeploymentCronFence();await connection`DROP FUNCTION fh_synthetic_foreign_cron()`;}
  });
  it('blocks actual scheduler ticks while held and resumes its unchanged saved schedule',async()=>{
    const operationId=randomUUID(),runtime=randomUUID(),name='deployment.schedule.'+randomUUID();
    const options={connectionString:url!,schedule:true,supervise:false,max:3,cronMonitorIntervalSeconds:1,clockMonitorIntervalSeconds:1,cronWorkerIntervalSeconds:1};
    let scheduler=new PgBoss(options);
    const errors:Error[]=[];scheduler.on('error',error=>errors.push(error));let deliveries=0;
    await scheduler.start();
    try{
      await ensureDeploymentCronFence();await scheduler.createQueue(name);await scheduler.work(name,{pollingIntervalSeconds:0.5},async()=>{deliveries++;});
      await scheduler.schedule(name,'* * * * * *',{synthetic:'actual scheduler only'});
      await until(async()=>deliveries>0);await op(operationId,'begin');
      // pg-boss files an occurrence in a 60-second singleton slot. Once the
      // pre-hold occurrence was accepted, the first refused recurrence can be
      // in the next slot; an eight-second wait depended on the wall clock.
      await until(async()=>errors.some(error=>error.message.includes('deployment_new_cron_held')),700);
      const saved=await scheduler.getSchedules(name);expect(saved.length).toBe(1);
      // Pre-hold accepted dispatcher/children finish; no accepted rows are cancelled.
      await until(async()=>{const rows=await connection`SELECT count(*)::int n FROM pgboss.job WHERE state='active' OR(state IN('created','retry') AND start_after<=now())`;return rows[0]!.n===0;});
      await scheduler.offWork('__pgboss__send-it',{wait:true});await scheduler.offWork(name,{wait:true});await scheduler.stop({graceful:true,close:false});
      await admitDeploymentRuntime(runtime);await acknowledgeDeploymentDrain(runtime,operationId);await op(operationId,'seal');
      const count=deliveries;await op(operationId,'resume','private_restored');
      // Canonical resumption constructs a fresh runtime. The installed scheduler
      // intentionally files even second-resolution rules in 60-second slots.
      scheduler=new PgBoss(options);scheduler.on('error',error=>errors.push(error));
      await scheduler.start();await scheduler.work(name,{pollingIntervalSeconds:0.5},async()=>{deliveries++;});
      await until(async()=>deliveries>count,700);expect((await scheduler.getSchedules(name))[0]?.cron).toBe(saved[0]?.cron);
      await scheduler.unschedule(name);await scheduler.offWork('__pgboss__send-it',{wait:true});await scheduler.offWork(name,{wait:true});
    }finally{await op(operationId,'release','private_restored');await markDeploymentRuntimeStopped(runtime);await scheduler.stop({graceful:true});}
  },160_000);
});
