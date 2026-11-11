// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private phases retain the caller and the authorization of one public operation.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor, Permission } from "./service";

type Invocation = { name: string; permission: Permission; kind: "query" | "mutation"; actor: Actor; active: boolean };
const invocation = new AsyncLocalStorage<Invocation>();

/** Only defineOrchestratedService enters this scope after ordinary authorization. */
export async function withOrchestration<T>(name: string, permission: Permission, kind: "query" | "mutation", actor: Actor, work: () => Promise<T>): Promise<T> {
  const state: Invocation = { name, permission, kind, actor, active: true };
  try { return await invocation.run(state, work); }
  finally { state.active = false; }
}

export function hasOrchestratedAuthorization(phase: { name: string; permission: Permission; kind: "query" | "mutation"; external?: boolean; orchestratedBy?: string }, actor: Actor): boolean {
  const current = invocation.getStore();
  return Boolean(current?.active && current.actor === actor && phase.external === false && phase.permission === "scoped" && current.permission === "scoped" && phase.orchestratedBy === current.name && (current.kind === "mutation" || phase.kind === "query") && phase.name.split(".")[0] === current.name.split(".")[0]);
}
