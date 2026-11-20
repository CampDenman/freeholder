// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture-only provider DELETE fault injection, and why `storage().delete` is
// no longer the place to inject one.
//
// `storage()` wraps its adapter in `withManagedStorageMutations`
// (`src/adapters/storage/managed.ts`), whose `delete` refuses unconditionally:
// "Use the shared original-file removal service so its exact physical bytes and
// caller can be verified." Physical removal now runs through
// `retireOriginalMediaObject` (`src/core/media/original-retirement.ts`), which
// resolves the privately configured original provider with
// `configuredOriginalRequestStore` and calls `deleteVersioned` inside an
// admitted transfer-call scope.
//
// So `vi.spyOn(storage(), "delete")` mocks a method the product never calls.
// It does not fail the run — it silently does nothing, and a case that expected
// a refusal instead observes a real, successful erasure. Inject the fault at
// the provider the product actually reaches, the same way
// `tests/core/media-write-recovery.test.ts` does.
//
// Use this ONLY to model provider behaviour. The guards under test —
// "the original pinned physical object remains", unresolved-operation
// bookkeeping, receipt completion — stay exactly as the product wrote them.
import { vi } from "vitest";
import { fixtureStorage } from "./raw-storage";

export type OriginalDeleteFault =
  /** The request never reaches the provider: nothing is dispatched, so the
   * admitted DELETE receipt stays `started` and no request row is written. */
  | { kind: "outage"; message: string }
  /** The request IS dispatched and its outcome never comes back, so the
   * request and its receipt settle as `unknown` and the bytes remain. This is
   * the state `confirmStoppedUnappliedDelete` is written to reconcile. */
  | { kind: "unresolved"; message: string }
  /** The provider removed the bytes; the acknowledgement was lost in return. */
  | { kind: "lost_acknowledgement"; message: string }
  /** The provider acknowledged a DELETE that did not apply: bytes remain. */
  | { kind: "unapplied" };

/** Faults every `deleteVersioned` on the ORIGINAL local request store until the
 * returned handle is restored. Returns a counter of physical delete attempts. */
export async function faultOriginalProviderDelete(fault: OriginalDeleteFault) {
  const local = await import("@/adapters/storage/local");
  const create = local.createLocalRequestStore;
  const attempts = vi.fn();
  const factory = vi.spyOn(local, "createLocalRequestStore").mockImplementation((config, observer) => {
    const requests = create(config, observer), remove = requests.deleteVersioned.bind(requests);
    vi.spyOn(requests, "deleteVersioned").mockImplementation(async (key, revision) => {
      attempts();
      if (fault.kind === "outage") throw new Error(fault.message);
      if (fault.kind === "unresolved") {
        // Enter the real request scope so the dispatch is recorded, then fail
        // inside it: a mutation whose operation throws settles as "unknown".
        await observer({ kind: "object.delete", binding: requests.binding, key, expectedRevision: revision }, async () => {
          throw new Error(fault.message);
        });
        return;
      }
      const body = fault.kind === "unapplied" ? await fixtureStorage().get(key) : undefined;
      await remove(key, revision);
      if (fault.kind === "lost_acknowledgement") throw new Error(fault.message);
      // The acknowledged request is real; only its physical effect is undone,
      // so the product still has to prove absence before it retires anything.
      if (body) await fixtureStorage().put(key, body, "application/octet-stream");
    });
    return requests;
  });
  return { attempts, restore: () => factory.mockRestore() };
}
