// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual finished callers need no Linux/systemd prerequisite.
import {serverRuntimeId} from "@/core/runtime-identity";
import { readFile } from "node:fs/promises";
import { z } from "zod";
export const mediaWriterRuntimeId = serverRuntimeId;
const pid = z.number().int().positive(), ticks = z.string().regex(/^[0-9]+$/);
export const currentStorageCallerRuntimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linux"), instance: z.uuid(), pid, boot: z.uuid(), startTicks: ticks }).strict(),
  z.object({ kind: z.literal("node"), instance: z.uuid(), pid }).strict(),
]);
// The earlier actual Linux record is readable as historical evidence only.
// No field is added to it and no legacy NULL birth is backfilled.
const earlierLinux = z.object({ boot: z.uuid(), pid, startTicks: ticks }).strict();
export const storageCallerRuntimeSchema = z.union([currentStorageCallerRuntimeSchema, earlierLinux]);
export type StorageCallerRuntimeIdentity = z.infer<typeof storageCallerRuntimeSchema>;
export type CurrentStorageCallerRuntimeIdentity = z.infer<typeof currentStorageCallerRuntimeSchema>;

export function storageCallerIdentityFromKernel(instance: string, processId: number, boot?: string, stat?: string): CurrentStorageCallerRuntimeIdentity {
  const portable = currentStorageCallerRuntimeSchema.parse({ kind: "node", instance, pid: processId });
  if (!boot || !stat) return portable;
  const end = stat.lastIndexOf(") "), first = stat.indexOf(" (");
  if (first < 1 || end <= first || stat.slice(0, first) !== String(processId)) return portable;
  const startTicks = stat.slice(end + 2).trim().split(/\s+/)[19];
  const kernel = currentStorageCallerRuntimeSchema.safeParse({ kind: "linux", instance, pid: processId, boot: boot.trim(), startTicks });
  return kernel.success ? kernel.data : portable;
}
export async function actualStorageCallerRuntimeIdentity(instance = mediaWriterRuntimeId): Promise<CurrentStorageCallerRuntimeIdentity> {
  if (process.platform === "linux") {
    try {
      const [boot, stat] = await Promise.all([readFile("/proc/sys/kernel/random/boot_id", "utf8"), readFile("/proc/self/stat", "utf8")]);
      return storageCallerIdentityFromKernel(instance, process.pid, boot, stat);
    } catch { /* No kernel witness is claimed. Actual return remains portable. */ }
  }
  return storageCallerIdentityFromKernel(instance, process.pid);
}
export function originalLinuxCallerIdentity(identity: StorageCallerRuntimeIdentity): { boot: string; pid: number; startTicks: string } | null {
  if ("kind" in identity && identity.kind === "node") return null;
  const parsed = earlierLinux.safeParse({ boot: "boot" in identity ? identity.boot : undefined, pid: identity.pid, startTicks: "startTicks" in identity ? identity.startTicks : undefined });
  return parsed.success ? parsed.data : null;
}
