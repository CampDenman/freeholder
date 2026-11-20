// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: portable actual finish never implies a kernel stop witness.
import { describe, expect, it } from "vitest";
import { originalLinuxCallerIdentity, storageCallerIdentityFromKernel } from "@/core/media/physical-caller-runtime";
const instance="00000000-0000-4000-8000-000000000001",boot="00000000-0000-4000-8000-000000000002";
const stat=(pid:number,ticks:string)=>`${pid} (synthetic worker) S ${Array(18).fill("0").join(" ")} ${ticks} 0 0`;
describe("C1.12/C11.08 actual caller runtime identity",()=>{
 it("allows a known finished Node caller without proc or systemd and claims no kernel stop proof",()=>{
  const identity=storageCallerIdentityFromKernel(instance,123);expect(identity).toEqual({kind:"node",instance,pid:123});expect(originalLinuxCallerIdentity(identity)).toBeNull();
 });
 it("retains actual original kernel boot/PID/start ticks without Number rounding",()=>{
  const identity=storageCallerIdentityFromKernel(instance,123,boot,stat(123,"18446744073709551615"));expect(identity).toMatchObject({kind:"linux",instance,pid:123,boot,startTicks:"18446744073709551615"});expect(originalLinuxCallerIdentity(identity)).toEqual({boot,pid:123,startTicks:"18446744073709551615"});
 });
 it("does not mint kernel proof from missing, malformed or another process's metadata",()=>{
  for(const [actualBoot,actualStat]of [[boot,stat(124,"900")],["not-a-boot-id",stat(123,"900")],[boot,stat(123,"not-ticks")],[boot,"123 (unclosed"]])expect(originalLinuxCallerIdentity(storageCallerIdentityFromKernel(instance,123,actualBoot,actualStat))).toBeNull();
 });
 it("can inspect an intact earlier original Linux record without rewriting it or inventing an instance birth",()=>{
  const original={boot,pid:123,startTicks:"9007199254740993"},before={...original};expect(originalLinuxCallerIdentity(original)).toEqual(original);expect(original).toEqual(before);
 });
});
