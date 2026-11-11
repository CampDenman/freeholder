// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.40: execution identities are bound by boot, never by request input.
import { AsyncLocalStorage } from "node:async_hooks";
import { parsePermission } from "@freeholder/plugin-kit";
import type { Actor, ModuleGrant, Tx } from "@/core/service";

export interface PluginExecution {
  readonly name: string;
  readonly version: string;
  readonly permissions: readonly string[];
}

const execution = new AsyncLocalStorage<PluginExecution | undefined>();
const auditOrigin = new AsyncLocalStorage<PluginExecution | undefined>();
const transaction = new AsyncLocalStorage<{ tx: Tx; failures: Set<string> }>();
let services = new WeakMap<object, PluginExecution>();
let blocks = new WeakMap<object, PluginExecution>();
const plugins = new Map<string, PluginExecution>();
const bootDisabled = new Set<string>();

export function pluginNamespace(name: string): string {
  return name.replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
}

/** Plugin contributions cannot impersonate core events or enqueue core jobs. */
export function pluginOwnsTopic(plugin: PluginExecution, topic: string): boolean {
  return topic.startsWith(`${pluginNamespace(plugin.name)}.`);
}

export function registerPluginExecution(plugin: PluginExecution): PluginExecution {
  const existing = plugins.get(plugin.name);
  if (existing) {
    if (existing.version !== plugin.version || JSON.stringify(existing.permissions) !== JSON.stringify(plugin.permissions)) throw new Error("Conflicting plugin execution metadata.");
    return existing;
  }
  for (const permission of plugin.permissions) parsePermission(permission);
  const captured = Object.freeze({ name: plugin.name, version: plugin.version, permissions: Object.freeze([...plugin.permissions]) });
  plugins.set(plugin.name, captured);
  return captured;
}

export function bindPluginService(definition: { name: string }, plugin: PluginExecution): void {
  if (!definition.name.startsWith(`${pluginNamespace(plugin.name)}.`)) throw new Error("A plugin may register services only in its own namespace.");
  const existing = services.get(definition);
  if (existing && existing !== plugin) throw new Error("A service already belongs to another plugin.");
  services.set(definition, plugin);
}

export function bindPluginBlock(definition: object, plugin: PluginExecution): void {
  const existing = blocks.get(definition);
  if (existing && existing !== plugin) throw new Error("A block already belongs to another plugin.");
  blocks.set(definition, plugin);
}

export const pluginServiceOwner = (definition: object): PluginExecution | undefined => services.get(definition);
export const pluginBlockOwner = (definition: object): PluginExecution | undefined => blocks.get(definition);
export const currentPluginExecution = (): PluginExecution | undefined => execution.getStore();
export const currentPluginAudit = (): PluginExecution | undefined => auditOrigin.getStore();
export const insideServiceTransaction = (): boolean => transaction.getStore() !== undefined;
export const currentServiceTransaction = (): Tx | undefined => transaction.getStore()?.tx;
export const withServiceTransaction = <T>(tx: Tx, failures: Set<string>, work: () => T): T => transaction.run({ tx, failures }, work);
export function deferPluginFailures(names: Iterable<string>): boolean {
  const pending = transaction.getStore(); if (!pending) return false;
  for (const name of names) pending.failures.add(name);
  return true;
}
export const listPluginExecutions = (): readonly PluginExecution[] => [...plugins.values()];
export const disablePluginAtBoot = (name: string): void => { bootDisabled.add(name); };
export const pluginFailedAtBoot = (name: string): boolean => bootDisabled.has(name);

export function pluginActor(plugin: PluginExecution, caller?: Actor): Extract<Actor, { kind: "plugin" }> {
  const grants: ModuleGrant[] = [];
  for (const raw of plugin.permissions) {
    const permission = parsePermission(raw);
    if (permission.access !== "external") grants.push({ module: pluginNamespace(permission.module), access: permission.access });
  }
  return { kind: "plugin", name: plugin.name, grants, request: caller?.request };
}

/** Only plugin contributions enter this context; core keeps its own authority. */
export function withPluginExecution<T>(plugin: PluginExecution, work: () => T): T {
  return execution.run(plugin, () => auditOrigin.run(plugin, work));
}

/** A permitted core operation composes with core's own transaction/authority. */
export function withCoreExecution<T>(work: () => T): T {
  return execution.run(undefined, work);
}

/** Trusted lifecycle recovery has its own system audit identity. */
export function withPlatformExecution<T>(work: () => T): T {
  return execution.run(undefined, () => auditOrigin.run(undefined, work));
}

export function resetPluginExecutionsForTests(): void {
  services = new WeakMap(); blocks = new WeakMap(); plugins.clear(); bootDisabled.clear();
}
