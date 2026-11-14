// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: exercise the actual action and installed Next error boundary.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReactServerErrorHandler } from "next/dist/server/app-render/create-error-handler";
import { ServiceError } from "@/core/service";
const seam=vi.hoisted(()=>({call:vi.fn(),redirect:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined}),headers:async()=>new Headers()}));
vi.mock("next/cache",()=>({revalidatePath:()=>undefined}));
vi.mock("next/navigation",()=>({redirect:(value:string)=>{seam.redirect(value);}}));
vi.mock("@/core/http/actor",()=>({actorFromToken:async()=>({kind:"anonymous"})}));
vi.mock("@/modules/subscriptions/controlled-provider-stop",()=>({reviewControlledProviderCallerStopped:{call:seam.call}}));
vi.mock("@/modules/subscriptions/controlled-provider-execution",()=>({recoverControlledProviderOperation:{call:seam.call},recoverControlledProviderCalendar:{call:seam.call},stopControlledProviderCalendar:{call:seam.call}}));
vi.mock("@/modules/subscriptions/controlled-provider-zero-closure",()=>({closeControlledZeroProviderResource:{call:seam.call}}));
import { recoverControlledProviderOperationAction } from "../../app/controlled-provider-actions";
const privateCanary="PRIVATE_QUERY_PARAMS_PROVIDER_CLIENT_SECRET";
const form=()=>{const value=new FormData();value.set("subscriptionId","11111111-1111-4111-8111-111111111111");value.set("operationId","22222222-2222-4222-8222-222222222222");return value;};
afterEach(()=>{vi.restoreAllMocks();seam.redirect.mockReset();});
describe("controlled action logging boundary",()=>{
 it("replaces ALL unknown failures with a fresh fixed native error and preserves generic failure",async()=>{
  const hostile=new Error(privateCanary,{cause:{query:privateCanary,params:[privateCanary]}});hostile.name=privateCanary;Object.assign(hostile,{code:privateCanary,provider:{body:privateCanary}});
  seam.call.mockRejectedValueOnce(hostile);let caught:unknown;
  try{await recoverControlledProviderOperationAction(form());}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect(caught).not.toBe(hostile);expect(seam.redirect).not.toHaveBeenCalled();
  if(!(caught instanceof Error))throw new Error("The actual action must preserve an unhandled generic failure.");
  expect(caught.message).toBe("The controlled provider action failed.");expect(caught.cause).toBeUndefined();expect(caught.stack).not.toContain(privateCanary);
  const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const handler=createReactServerErrorHandler(false,false,new Map(),error=>console.error(error));
  handler(caught);
  expect(log).toHaveBeenCalledOnce();for(const call of log.mock.calls)for(const value of call){expect(String(value)).not.toContain(privateCanary);if(value instanceof Error){expect(value.stack).not.toContain(privateCanary);expect(value.cause).toBeUndefined();}}
 });
 it("retains the existing known-service failed redirect",async()=>{
  seam.call.mockRejectedValueOnce(new ServiceError("conflict","Review the current original source."));await recoverControlledProviderOperationAction(form());
  expect(seam.redirect).toHaveBeenCalledExactlyOnceWith("/admin/subscriptions/11111111-1111-4111-8111-111111111111?controlledResult=failed");
 });
});
