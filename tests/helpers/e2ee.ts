// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: real MLS devices for tests — the engine browsers run, with a memory
// store, calling the services directly as the member.
import { ServiceError, type Actor } from "@/core/service";
import { E2eeDevice, type DeviceRecord, type E2eeStore, type E2eeTransport, type ReadMessage, type StoredKeyPackage } from "@/modules/members/e2ee/engine";
import { claimKeyPackages, e2eeCommit, e2eeSync, publishKeyPackages, registerDevice, sendCallKey, sendEncrypted } from "@/modules/members/e2ee/service";

type Member = Extract<Actor, { kind: "user" }>;

export function memoryStore(): E2eeStore {
  let device: DeviceRecord | null = null;
  const packages = new Map<string, StoredKeyPackage>();
  const groups = new Map<string, { state: Uint8Array | null; cursor: number }>();
  const messages = new Map<string, Map<string, ReadMessage>>();
  const callKeys = new Map<string, string>();
  return {
    device: async () => device,
    saveDevice: async (d) => { device = d; },
    keyPackage: async (id) => packages.get(id) ?? null,
    saveKeyPackages: async (list) => { for (const p of list) packages.set(p.id, p); },
    dropKeyPackage: async (id) => { packages.delete(id); },
    group: async (id) => groups.get(id) ?? null,
    saveGroup: async (id, state, cursor) => { groups.set(id, { state, cursor }); },
    messages: async (id) => new Map(messages.get(id) ?? []),
    saveMessage: async (id, mid, m) => { messages.set(id, new Map(messages.get(id) ?? []).set(mid, m)); },
    dropMessage: async (id, mid) => { messages.get(id)?.delete(mid); },
    callKey: async (id) => callKeys.get(id) ?? null,
    saveCallKey: async (id, key) => { callKeys.set(id, key); },
    clear: async () => { device = null; packages.clear(); groups.clear(); messages.clear(); callKeys.clear(); },
  };
}

/** The services, called as the member, with errors carrying their codes as the server actions do. */
export function directTransport(actor: Member): E2eeTransport {
  const wrap = <I, O>(service: { call(input: I, actor: Member): Promise<O> }) => async (input: I) => {
    try {
      return await service.call(input, actor);
    } catch (error) {
      if (error instanceof ServiceError) throw Object.assign(new Error(error.message), { code: error.code });
      throw error;
    }
  };
  return {
    register: wrap(registerDevice),
    publish: wrap(publishKeyPackages),
    sync: wrap(e2eeSync),
    claim: wrap(claimKeyPackages),
    commit: wrap(e2eeCommit),
    send: wrap(sendEncrypted),
    sendCallKey: wrap(sendCallKey),
  };
}

export const deviceFor = (actor: Member, label: string) => new E2eeDevice(actor.userId, memoryStore(), directTransport(actor), label);
