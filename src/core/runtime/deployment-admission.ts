// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.33. All new-start checks and operator hold/seal share this transaction
// lock. Already-admitted transactions commit before the hold becomes visible.
import {AsyncLocalStorage} from 'node:async_hooks';
import {sql} from 'drizzle-orm';
import {db,type Database} from '@/core/db';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
type Query=Pick<Tx,'execute'>;
export interface DeploymentHold{operationId:string;sourceRevision:string;phase:'draining'|'sealed'|'resuming'}
const continuation=new AsyncLocalStorage<{active:boolean}>();
export function withDeploymentContinuation<T>(work:()=>Promise<T>):Promise<T>{
  const scope={active:true};return continuation.run(scope,async()=>{try{return await work();}finally{scope.active=false;}});
}
async function shared(tx:Query){await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(1691709,33)`);}
async function current(tx:Query):Promise<DeploymentHold|null>{
  const rows=await tx.execute(sql`SELECT operation_id,source_revision,phase FROM deployment_admission_holds WHERE released_at IS NULL`);
  if(rows.length>1)throw Error('deployment_hold_inventory_unknown');
  const row=rows[0];return row?{operationId:String(row.operation_id),sourceRevision:String(row.source_revision),phase:row.phase as DeploymentHold['phase']}:null;
}
export function readDeploymentHold():Promise<DeploymentHold|null>{return current(db());}
/** No caller-supplied bypass: only trusted ongoing-call/job server context. */
export async function newDeploymentWorkAllowed(tx:Query):Promise<boolean>{
  await shared(tx);const hold=await current(tx);return !hold || hold.phase==='resuming' || (hold.phase==='draining' && continuation.getStore()?.active===true);
}
/** Call creation never inherits a job/continuation exception. */
export async function newDeploymentCallAllowed(tx:Query):Promise<boolean>{await shared(tx);return !(await current(tx));}
export async function deploymentWorkInventory():Promise<{calls:number;pendingJobs:number;activeJobs:number}>{
  const rows=await db().execute(sql`SELECT fh_deployment_inventory() AS inventory`);const value=rows[0]?.inventory as Record<string,unknown>|undefined;
  if(!value || !['calls','pendingJobs','activeJobs'].every(k=>Number.isSafeInteger(value[k]) && Number(value[k])>=0))throw Error('deployment_inventory_unknown');
  return {calls:Number(value.calls),pendingJobs:Number(value.pendingJobs),activeJobs:Number(value.activeJobs)};
}
export async function admitDeploymentRuntime(instanceId:string):Promise<{hold:DeploymentHold|null}>{
  return db().transaction(async tx=>{await shared(tx);const hold=await current(tx);
    // ABI capability for the actual source version, not a database-owner security boundary.
    await tx.execute(sql`select set_config('freeholder.merchant_collection_runtime_v1','1',true)`);
    await tx.execute(sql`INSERT INTO deployment_admission_runtimes(instance_id,hold_operation_id,state)VALUES(${instanceId}::uuid,${hold?.operationId??null}::uuid,${hold && hold.phase!=='resuming'?'draining':'running'})
      ON CONFLICT(instance_id)DO UPDATE SET hold_operation_id=excluded.hold_operation_id,state=excluded.state,updated_at=now()`);
    return {hold:hold?.phase==='resuming'?null:hold};
  });
}
export async function acknowledgeDeploymentDrain(instanceId:string,operationId:string):Promise<boolean>{
  return db().transaction(async tx=>{await shared(tx);const hold=await current(tx);if(hold?.operationId!==operationId)return false;
    const rows=await tx.execute(sql`UPDATE deployment_admission_runtimes SET state='drained',updated_at=now() WHERE instance_id=${instanceId}::uuid AND hold_operation_id=${operationId}::uuid RETURNING instance_id`);return rows.length===1;
  });
}
export async function markDeploymentRuntimeStopped(instanceId:string):Promise<void>{
  await db().transaction(async tx=>{await shared(tx);const hold=await current(tx);
    if(hold)await tx.execute(sql`UPDATE deployment_admission_runtimes SET state=CASE WHEN state='drained' THEN 'drained' ELSE 'draining' END,hold_operation_id=${hold.operationId}::uuid,updated_at=now() WHERE instance_id=${instanceId}::uuid`);
    else await tx.execute(sql`UPDATE deployment_admission_runtimes SET state='stopped',updated_at=now() WHERE instance_id=${instanceId}::uuid`);
  });
}
/** Source-owned extension through the existing pg-boss connection/privilege.
 * No foreign trigger is overwritten and no cron row is cancelled or excluded.
 */
export async function ensureDeploymentCronFence():Promise<void>{
  await db().transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1691709,34)`);
    await tx.execute(sql`SET LOCAL lock_timeout='2000ms'`);
    const exists=await tx.execute(sql`SELECT oid FROM pg_trigger WHERE tgrelid=to_regclass('pgboss.job') AND tgname='freeholder_deployment_cron_admission'`);
    if(!exists.length)await tx.execute(sql`CREATE TRIGGER freeholder_deployment_cron_admission BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION fh_deployment_cron_admission()`);
    const verified=await tx.execute(sql`SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('pgboss.job') AND tgname='freeholder_deployment_cron_admission'
      AND tgfoid=to_regprocedure('fh_deployment_cron_admission()') AND tgenabled='O' AND tgtype=7 AND tgnargs=0 AND tgqual IS NULL AND NOT tgisinternal`);
    if(verified.length!==1)throw Error('deployment_cron_fence_unknown');
  });
}
