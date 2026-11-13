// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.09/C1.12/C11.08: only the real worker installs its execution context.
// Domain I/O checks the actual cancellation signal/queue state; this is not
// an admission, stop receipt or authority to acknowledge another job.
import { AsyncLocalStorage } from "node:async_hooks";
import type { JobExecutionContext } from "./index";
const executions = new AsyncLocalStorage<{ context: JobExecutionContext; active: boolean }>();
export async function withActualWorkerExecution<T>(context:JobExecutionContext,operation:()=>Promise<T>):Promise<T>{
 const scope={context,active:true};try{return await executions.run(scope,operation);}finally{scope.active=false;}
}
export async function checkActualWorkerCancellation():Promise<void>{
 const scope=executions.getStore();if(!scope)return;
 if(!scope.active)throw new Error("The actual worker execution ended; no new provider request may be admitted from its detached work.");
 await scope.context.throwIfCancelled();
}
