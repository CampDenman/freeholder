// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Structural comparison only. The actual fenced SQL inventory supplies both
// snapshots; this function supplies neither process-stop nor provider proof.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=()=>{throw Error("The exact captured transfer recovery cohort changed. Keep the namespace fenced and its original stop witness intact.");};
function canonical(value){
 if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
 if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
 if(typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
 fail();
}
export function requireTransferDrainAssociation(captured,{planId,namespace,snapshot}){
 if(!uuid.test(planId??"")||!/^[a-f0-9]{64}$/.test(namespace??"")||captured?.format!=="freeholder.media-transfer-drain/v1"||captured.planId!==planId||captured.namespace!==namespace||captured.snapshot?.plan?.id!==planId||![captured.snapshot.plan.sourceNamespace,captured.snapshot.plan.targetNamespace].includes(namespace)||!snapshot)fail();
 for(const[name,bound]of Object.entries({objects:10000,callers:10000,requests:100000,receipts:10000}))if(!Array.isArray(captured.snapshot[name])||captured.snapshot[name].length>bound||!Array.isArray(snapshot[name])||snapshot[name].length>bound)fail();
 if(!captured.snapshot.objects.length||canonical(captured.snapshot)!==canonical(snapshot))fail();
 return captured;
}
