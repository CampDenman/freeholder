// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: late legacy Welcomes remain readable after server-side erasure;
// historical private pins cannot authorize new ciphertext or call secrets.
import { expect, it } from "vitest";
import { createCommit, createGroup, defaultCapabilities, defaultLifetime, encodeMlsMessage, generateKeyPackageWithKey } from "ts-mls";
import "@/modules/members/e2ee/server-init";
import { openMls } from "@/modules/members/e2ee/crypto";
import { joinLegacy, legacyDevices, migrationInfo } from "@/modules/members/e2ee/legacy";
import { b64, identityOf, suite, utf8 } from "@/modules/members/e2ee/wire";

it("opens an old Welcome after erasure, then removes the erased leaf before any new sharing",async()=>{
  const cs=await suite();
  const people=await Promise.all([1,2,3].map(async(n)=>{
    const userId=`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`, deviceId=crypto.randomUUID(), keys=await cs.signature.keygen();
    const kp=await generateKeyPackageWithKey({credentialType:"basic",identity:utf8(identityOf(userId,deviceId))},defaultCapabilities(),defaultLifetime,[],keys,cs);
    return {userId,deviceId,keys,kp,signatureKey:b64(keys.publicKey)};
  }));
  const [a,b,c]=people as [typeof people[number],typeof people[number],typeof people[number]];
  const groupId=crypto.randomUUID();
  const initial=await createGroup(utf8(groupId),a.kp.publicPackage,a.kp.privatePackage,[],cs);
  const committed=await createCommit({state:initial,cipherSuite:cs},{extraProposals:[b,c].map(person=>({proposalType:"add" as const,add:{keyPackage:person.kp.publicPackage}})),ratchetTreeExtension:true});
  const welcome=b64(encodeMlsMessage({version:"mls10",wireformat:"mls_welcome",welcome:committed.welcome!}));
  const directory=[a,b].map(({userId,deviceId,signatureKey})=>({userId,deviceId,signatureKey}));
  const legacy=await joinLegacy(welcome,b64(encodeMlsMessage({version:"mls10",wireformat:"mls_key_package",keyPackage:b.kp.publicPackage})),b.kp.privatePackage,directory);
  expect(legacyDevices(legacy).map(d=>d.deviceId).sort()).toEqual(people.map(d=>d.deviceId).sort());
  const context={groupId,identity:{userId:b.userId,deviceId:b.deviceId,privateKey:b64(b.keys.signKey),publicKey:b64(b.keys.publicKey)},directory,entitled:[a.deviceId,b.deviceId],expectedRoster:people.map(d=>d.deviceId),serverEpoch:1};
  type State={state:string;pending:{commit:string};epoch:number};
  const migrated=await openMls<State>({op:"migrate",context,groupInfo:await migrationInfo(legacy)});
  const accepted=await openMls<State>({op:"acceptPending",context,state:migrated.state,commit:migrated.pending.commit});
  context.serverEpoch=accepted.epoch;
  await expect(openMls({op:"encrypt",context,state:accepted.state,message:b64(utf8("must not share with erased leaf"))})).rejects.toThrow();
  const removal=await openMls<State>({op:"commit",context,state:accepted.state,add:[],remove:[c.deviceId]});
  const cleaned=await openMls<State>({op:"acceptPending",context,state:removal.state,commit:removal.pending.commit});
  context.serverEpoch=cleaned.epoch;
  await expect(openMls({op:"encrypt",context,state:cleaned.state,message:b64(utf8("only the remaining devices"))})).resolves.toHaveProperty("message");
});
