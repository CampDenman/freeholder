// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.47/C11.08: dependent domains follow committed physical facts.
import {withCoreExecution} from "@/core/plugins/context";
type Reconciler=(receiptId:string)=>Promise<void>;
const reconcilers=new Map<string,Reconciler>();
/** Startup-only domain registration; the callback receives no fabricated actor,
 * service context or ownership claim. It must admit its real recovery/retry
 * work through the domain's shared service, using original scope membership.
 */
export function registerStorageObservationReconciler(name:string,reconcile:Reconciler):()=>void{
 if(!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(name))throw new Error("Storage observation reconcilers need a stable domain name.");
 const prior=reconcilers.get(name);
 if(prior&&prior!==reconcile)throw new Error(`Storage observation reconciler ${name} is already registered.`);
 reconcilers.set(name,reconcile);
 return()=>{if(reconcilers.get(name)===reconcile)reconcilers.delete(name);};
}
/** The receipt transaction MUST have committed before invoking this function.
 * A failure is separate recovery debt, never an absent physical write. Every
 * domain still runs; domains also need periodic retry for old-image/crash gaps.
 * Each callback is core recovery work registered at startup, so it runs under
 * core execution: an ambient plugin identity belonging to whichever caller
 * committed the physical fact must not downgrade its own system services.
 * The plugin remains the audit origin.
 */
export async function reconcileCommittedStorageObservation(receiptId:string):Promise<void>{
 let failed=false;
 // Sequential callbacks avoid inventing a cross-domain database lock order.
 for(const [,reconcile] of [...reconcilers].sort(([a],[b])=>a<b?-1:a>b?1:0)){
  try{await withCoreExecution(()=>reconcile(receiptId));}catch{failed=true;}
 }
 if(failed)throw new Error("The physical storage observation was retained; dependent recovery is still pending.");
}
