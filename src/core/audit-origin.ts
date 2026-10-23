// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where an audit row came from, beyond who the actor was (C1.38, 2026-10-23).
//
// Its own module, below both the service runtime and the job runtime, so the
// job producer can step out of a seeding scope without importing the service
// layer that imports it.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The audit actor for platform work done while installing a site's starting
 * content (the demo seed at boot). Still recorded — the trail stays complete
 * and honest about what wrote each row — but distinguishable from the
 * platform's ongoing work, so an owner's "What changed" can leave the bulk
 * install out (2026-10-23: a reset playground's feed was fifteen identical
 * "Freeholder updated pages" rows).
 */
export const SEED_AUDIT_ACTOR = "system:seed";

const seeding = new AsyncLocalStorage<true>();

/**
 * Run `work` as seeding: every audit row a system actor writes inside it —
 * including composed calls, `callAsSystem` and the listeners an outermost call
 * dispatches after commit, which all stay in this async context — is recorded
 * as `SEED_AUDIT_ACTOR`. Authorization is untouched: the actor is still
 * `{ kind: "system" }`; only the audit string differs.
 */
export function runAsSeed<T>(work: () => Promise<T>): Promise<T> {
  return seeding.run(true, work);
}

/** Whether the current async context is inside `runAsSeed`. */
export function isSeeding(): boolean {
  return seeding.getStore() === true;
}

/**
 * Run `start` outside any seeding scope. Long-lived work started lazily — the
 * job producer, its workers, timers and event emitters — inherits the async
 * context it was created in for as long as it runs. Started from inside the
 * seed, it would mark every later row it writes as seed work and hide it from
 * the owner; started through this, it never carries the marker.
 */
export function outsideSeeding<T>(start: () => T): T {
  return seeding.exit(start);
}
