// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.47/C11.08: original receipt identity crosses the post-commit boundary.
import { afterEach,describe,expect,it,vi } from "vitest";
import { registerStorageObservationReconciler,reconcileCommittedStorageObservation } from "@/core/media/observation-hooks";
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const unregister of cleanup.splice(0))unregister();});
describe("committed storage observation domain recovery",()=>{
 it("passes only the original receipt ID to each registered domain",async()=>{
  const one=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined),two=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined);
  cleanup.push(registerStorageObservationReconciler("test.source",one),registerStorageObservationReconciler("test.transfer",two));
  await reconcileCommittedStorageObservation("original-receipt");
  expect(one.mock.calls).toEqual([["original-receipt"]]);expect(two.mock.calls).toEqual([["original-receipt"]]);
 });
 it("runs the other domain even when one fails, without exposing its private error",async()=>{
  const next=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined);
  cleanup.push(registerStorageObservationReconciler("test.first",async()=>{throw new Error("Synthetic private response body must stay out of caller error");}),registerStorageObservationReconciler("test.second",next));
  await expect(reconcileCommittedStorageObservation("retained-physical-fact")).rejects.toThrow("The physical storage observation was retained; dependent recovery is still pending.");
  expect(next.mock.calls).toEqual([["retained-physical-fact"]]);
 });
 it("does not let a second definition silently replace an original reconciler",()=>{
  const original=async()=>{},other=async()=>{};
  cleanup.push(registerStorageObservationReconciler("test.original",original));
  expect(()=>registerStorageObservationReconciler("test.original",other)).toThrow("already registered");
 });
 it("removes only its own registered callback",async()=>{
  const callback=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined);
  const remove=registerStorageObservationReconciler("test.removed",callback);cleanup.push(remove);remove();
  await reconcileCommittedStorageObservation("later-fact");expect(callback).not.toHaveBeenCalled();
 });
});
