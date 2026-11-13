// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual worker cancellation is checked before each new I/O.
import {AsyncLocalStorage} from "node:async_hooks";
import type {JobExecutionContext} from "@/core/jobs";
const worker=new AsyncLocalStorage<{context:JobExecutionContext;active:boolean}>();
export async function withStorageTransferJob<T>(context:JobExecutionContext,work:()=>Promise<T>):Promise<T>{const scope={context,active:true};try{return await worker.run(scope,work);}finally{scope.active=false;}}
export async function checkStorageTransferJob():Promise<void>{const scope=worker.getStore();if(scope?.active)await scope.context.throwIfCancelled();}
