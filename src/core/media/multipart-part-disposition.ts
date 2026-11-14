// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Only the actual current issuer's failure continuation can withhold its own
// still-private URL. This process-local authority is never a resumable claim.
import {AsyncLocalStorage} from "node:async_hooks";
import {transferConflict} from "./transfer-proof";
interface Disposition{callId:string;token:string;active:boolean;returned:boolean}
const actual=new AsyncLocalStorage<Disposition>();
export async function withOriginalPartDisposition<T>(caller:{id:string;token:string},work:()=>Promise<T>):Promise<T>{
 if(actual.getStore()?.active)transferConflict("An upload-link disposition cannot borrow another original issuer invocation.");
 const scope:Disposition={callId:caller.id,token:caller.token,active:true,returned:false};
 try{return await actual.run(scope,work);}finally{scope.active=false;}
}
export function requireOriginalPartWithheldAuthority(callId:string,token:string):void{
 const scope=actual.getStore();if(!scope?.active||scope.returned||scope.callId!==callId||scope.token!==token)transferConflict("A withheld upload link needs its actual owning local failure continuation; it cannot be asserted during recovery.");
}
export function markOriginalPartReturned(callId:string,token:string):void{
 requireOriginalPartWithheldAuthority(callId,token);actual.getStore()!.returned=true;
}
