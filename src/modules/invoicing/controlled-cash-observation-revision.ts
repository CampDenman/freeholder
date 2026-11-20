// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: full current coverage and exact returned-own historical comparison.
import { ServiceError } from "@/core/service";
import type { ControlledCashInspectionAncestry } from "@/modules/subscriptions/controlled-provider-cash-inspection-ancestry";
export type ObservationFingerprintDomain="postgres_row"|"dependency_canonical"|"schedule_stable";
export type ObservationFingerprint={table:string;id:string;fingerprint:string;domain:ObservationFingerprintDomain};
function refuse():never{throw new ServiceError("conflict","Restore the complete exact observation history; unrelated occurrences, ambiguous hashes and unfinished readers cannot disappear from a causal comparison.");}
/** The two existing digest encodings are deliberately distinct. Their bytes
 * never become interchangeable merely because they identify the same row.
 * Only the verifier's authenticated actual returned-own entries may be absent
 * from the historical view; the full current view always contains them. */
export function controlledObservationEntries(rows:readonly ObservationFingerprint[],own?:Pick<ControlledCashInspectionAncestry,"entries">){
 const full=new Map<string,Partial<Record<ObservationFingerprintDomain,string>>>();
 for(const row of rows){
  if(!/^[a-z_][a-z0-9_.]*$/.test(row.table)||!row.id||!/^[a-f0-9]{64}$/.test(row.fingerprint)||!["postgres_row","dependency_canonical","schedule_stable"].includes(row.domain))refuse();
  const key=`${row.table}:${row.id}`,entry=full.get(key)??{},previous=entry[row.domain];
  if(previous&&previous!==row.fingerprint)refuse();entry[row.domain]=row.fingerprint;full.set(key,entry);
  if(full.size>5000)refuse();
 }
 const causal=new Map(full),seen=new Set<string>();
 for(const row of own?.entries??[]){
  const key=`${row.table}:${row.id}`,entry=full.get(key);
  if(seen.has(key)||!entry||entry.schedule_stable||entry.postgres_row&&entry.postgres_row!==row.fingerprint||entry.dependency_canonical&&entry.dependency_canonical!==row.dependencyFingerprint)refuse();
  seen.add(key);causal.delete(key);
 }
 const ordered=(entries:typeof full)=>[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,...value}));
 return{full:ordered(full),causal:ordered(causal),physicalRowCount:full.size};
}
