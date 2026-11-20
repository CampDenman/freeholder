// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: actual HTTP and MCP unknown-error boundaries never inspect error properties.
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NodeCrypto from "node:crypto";
import { errorResponse } from "@/core/http/respond";
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { logUnhandledFailure } from "@/core/safe-failure-log";
const seam=vi.hoisted(():{call:ReturnType<typeof vi.fn>;uuid?:string}=>({call:vi.fn()}));
vi.mock("node:crypto",async original=>{const actual=await original<typeof NodeCrypto>();return{...actual,randomUUID:()=>seam.uuid??actual.randomUUID()};});
vi.mock("@/core/runtime",()=>({ready:async()=>undefined}));
vi.mock("@/core/http/actor",()=>({actorFromRequest:async()=>({kind:"anonymous"})}));
vi.mock("@/mcp/tools",()=>({hiddenFromMcp:()=>false,toolsFor:()=>[],serviceForTool:()=>({def:{name:"canary.tool"},call:seam.call})}));
import { handleMcp } from "@/mcp/server";
const privateCanary="PRIVATE_provider_secret_query_params_stack_cause";
function hostile() {
 const value={query:privateCanary,params:[privateCanary],cause:{provider:{body:privateCanary}},stack:privateCanary};
 Object.defineProperties(value,{name:{get(){throw new Error(privateCanary);}},code:{get(){throw new Error(privateCanary);}},message:{get(){throw new Error(privateCanary);}}});
 return value;
}
afterEach(()=>{vi.restoreAllMocks();delete seam.uuid;});
function safeRecord(calls:unknown[][],surface:string) {
 expect(calls).toHaveLength(1);expect(calls[0]).toHaveLength(1);
 const event=z.object({event:z.literal("unhandled_failure"),surface:z.enum(["http","mcp"]),category:z.literal("internal"),code:z.literal("internal"),requestId:z.uuid()}).strict().parse(calls[0]?.[0]);
 expect(event.surface).toBe(surface);
 expect(JSON.stringify(calls)).not.toContain(privateCanary);
}
describe("fixed unhandled-failure logging",()=>{
 it("throws a fresh fixed failure without logging a malformed generator value",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);seam.uuid=privateCanary;
  expect(()=>logUnhandledFailure("http")).toThrowError("Cannot allocate an internal failure reference.");expect(log).not.toHaveBeenCalled();
 });
 it("keeps the actual HTTP generic500 and never reads hostile error accessors",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const response=errorResponse(hostile(),{kind:"anonymous"});
  expect(response.status).toBe(500);expect(await response.json()).toEqual({error:{code:"internal",message:"Something went wrong."}});
  safeRecord(log.mock.calls,"http");
 });
 it("keeps known ServiceError status, safe message and retry headers without an unknown log",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const response=errorResponse(new ServiceError("permission","Sign in first."),{kind:"anonymous"});
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:{code:"permission",message:"Sign in first."}});expect(log).not.toHaveBeenCalled();
 });
 it("uses its own UUID for each event without accepting caller identity",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);logUnhandledFailure("http");logUnhandledFailure("http");
  const first:unknown=log.mock.calls[0]?.[0],second:unknown=log.mock.calls[1]?.[0];expect(first).not.toEqual(second);
 });
 it("keeps actual MCP tools/call JSON-RPC identity and generic isError behavior",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);seam.call.mockRejectedValueOnce(hostile());
  const response=await handleMcp(new Request("http://localhost/api/mcp",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer test-transport","x-request-id":privateCanary},body:JSON.stringify({jsonrpc:"2.0",id:73,method:"tools/call",params:{name:"canary.tool",arguments:{untrusted:privateCanary}}})}),{name:"Canary",version:"1"});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({jsonrpc:"2.0",id:73,result:{content:[{type:"text",text:"Something went wrong running that tool."}],isError:true}});
  safeRecord(log.mock.calls,"mcp");
 });
 it("preserves the known MCP service error without logging the request",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);seam.call.mockRejectedValueOnce(new ServiceError("conflict","Review the original payment."));
  const response=await handleMcp(new Request("http://localhost/api/mcp",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer test-transport"},body:JSON.stringify({jsonrpc:"2.0",id:74,method:"tools/call",params:{name:"canary.tool"}})}),{name:"Canary",version:"1"});
  expect(await response.json()).toEqual({jsonrpc:"2.0",id:74,result:{content:[{type:"text",text:"Review the original payment."}],isError:true}});expect(log).not.toHaveBeenCalled();
 });
});
