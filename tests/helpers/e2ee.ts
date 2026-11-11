// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: real MLS devices for tests — the engine browsers run, with a memory
// store, calling the services directly as the member.
import { ServiceError, type Actor } from "@/core/service";
import { E2eeDevice, type E2eeTransport } from "@/modules/members/e2ee/engine";
import { claimKeyPackages, e2eeCommit, e2eeSync, publishKeyPackages, registerDevice, sendCallKey, sendEncrypted } from "@/modules/members/e2ee/service";
import { ackHistory, closeHistoryRequest, historyRequests, receivedHistory, requestHistory, sendHistory } from "@/modules/members/e2ee/history";

type Member = Extract<Actor, { kind: "user" }>;

export { memoryStore } from "./e2ee-store";
import { memoryStore } from "./e2ee-store";

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
    requestHistory: wrap(requestHistory),
    historyRequests: wrap(historyRequests),
    sendHistory: wrap(sendHistory),
    closeHistory: wrap(closeHistoryRequest),
    receivedHistory: wrap(receivedHistory),
    ackHistory: wrap(ackHistory),
  };
}

export const deviceFor = (actor: Member, label: string) => new E2eeDevice(actor.userId, memoryStore(), directTransport(actor), label);
