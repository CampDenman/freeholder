// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: process identity is context; time and a heartbeat never prove exit.
import { randomUUID } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";

export interface MerchantPhysicalCaller {
  id: string; pid: number; host: string; startedAt: string;
  bootId: string | null; pidNamespace: string | null; startTicks: string | null;
}
function birthTicks(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  const ticks = fields[19]; // Linux field22, after the command and state.
  if (!ticks || !/^\d+$/.test(ticks)) throw new Error("process_birth_unknown");
  return ticks;
}
function optional<T>(read: () => T): T | null { try { return read(); } catch { return null; } }
interface LocalFinish { paymentId: string; nonce: string; outcome: "returned" | "threw"; providerRef: string | null; paymentRef: string | null }
interface CallerState { identity: MerchantPhysicalCaller; finished: Map<string, LocalFinish> }
const slot = Symbol.for("freeholder.merchant.physical-caller.v1");
const processState = globalThis as typeof globalThis & { [slot]?: CallerState };
const state: CallerState = processState[slot] ??= {
  identity: { id: randomUUID(), pid: process.pid, host: hostname(), startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    bootId: optional(() => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()),
    pidNamespace: optional(() => readlinkSync("/proc/self/ns/pid")), startTicks: optional(() => birthTicks(process.pid)) },
  finished: new Map<string, LocalFinish>(),
};
export function merchantPhysicalCaller(): MerchantPhysicalCaller { return { ...state.identity }; }

/** Only an exact observable birth can prove a caller still lives or has ended. */
export function merchantCallerLiveness(caller: MerchantPhysicalCaller): "live" | "absent" | "unobservable" {
  const own = state.identity;
  if (!Number.isSafeInteger(caller.pid) || caller.pid <= 0) return "unobservable";
  if (!caller.bootId || !caller.pidNamespace || !caller.startTicks || caller.bootId !== own.bootId || caller.pidNamespace !== own.pidNamespace || caller.host !== own.host) return "unobservable";
  try { return birthTicks(caller.pid) === caller.startTicks ? "live" : "absent"; }
  catch (error) { return error instanceof Error && "code" in error && error.code === "ENOENT" ? "absent" : "unobservable"; }
}
export function retainLocalMerchantCallFinish(dispatchId: string, paymentId: string, nonce: string, outcome: "returned" | "threw", value?: unknown): void {
  const candidate = value && typeof value === "object" && "providerRef" in value ? value.providerRef : undefined;
  const settlement = value && typeof value === "object" && "paymentRef" in value ? value.paymentRef : undefined;
  const providerRef = typeof candidate === "string" && /^(?:cs|pi)_[A-Za-z0-9_]+$/.test(candidate) && candidate.length <= 200 ? candidate : null;
  const paymentRef = typeof settlement === "string" && /^pi_[A-Za-z0-9_]+$/.test(settlement) && settlement.length <= 200 ? settlement : null;
  state.finished.set(dispatchId, { paymentId, nonce, outcome, providerRef, paymentRef });
}
export function localMerchantCallFinish(dispatchId: string) { return state.finished.get(dispatchId); }
export function localMerchantCallFinishes(paymentId: string) { return [...state.finished].filter(([, entry]) => entry.paymentId === paymentId); }
export function forgetLocalMerchantCallFinish(dispatchId: string): void { state.finished.delete(dispatchId); }
