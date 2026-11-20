// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { withControlledSafeResponseSession } from "@/adapters/payments/stripe-controlled-safe-response";
import { CONTROLLED_SAFE_PRODUCER_BY_KIND } from "@/adapters/payments/merchant-controlled-safe-response-contract";

type ControlledRequest = { operationId?: string; requestDigest?: string; bootstrapOperationId?: string; bootstrapRequestDigest?: string };

export function controlledSafeAdapterSession<T extends object>(provider: T): T {
 return new Proxy(provider, { get(target, key, receiver) {
  const member: unknown = Reflect.get(target, key, receiver);
  if (typeof member !== "function" || typeof key !== "string") return member;
  const kind = Object.entries(CONTROLLED_SAFE_PRODUCER_BY_KIND).find(([, producer]) => producer === key)?.[0];
  if (!kind) return member;
  return async (request: ControlledRequest) => {
   const result: unknown = await withControlledSafeResponseSession({
    operationId: request.operationId ?? request.bootstrapOperationId ?? "", callId: randomUUID(), requestDigest: request.requestDigest ?? request.bootstrapRequestDigest ?? "", resourceId: randomUUID(), kind,
   }, async () => {
    const pending = Reflect.apply(member, target, [request]) as Promise<unknown>;
    return pending;
   });
   return result;
  };
 } });
}
