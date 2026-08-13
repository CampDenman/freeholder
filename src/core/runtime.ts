// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// "Is the platform wired up?" — and the answer being yes wherever it is asked.
//
// ── The bug this exists for ────────────────────────────────────────────────
//
// `instrumentation.ts` is the documented place to boot, and it does run. But
// the bundler compiles it into a **different module graph** from the app's
// routes, so the module-level state boot produces — the service registry in
// core/service.ts and the listener map in core/events.ts — belongs to
// instrumentation's copy of those modules. Request handling gets a second,
// empty copy.
//
// Nothing noticed for three phases, because nothing depended on it: services
// are imported and called as objects (`login.call(...)`), never looked up
// through the registry, and no module listened for an event. The first feature
// that actually needed boot — cms seeding a site when setup completes — was
// the first to break, silently, in production. A verified diagnostic route
// reported `services: 0, listeners: 0` from inside the app graph while boot
// had demonstrably run.
//
// ── The fix ───────────────────────────────────────────────────────────────
//
// Stop treating boot as a startup event and treat it as a precondition. Every
// graph boots its own copy, once, the first time it needs one. `bootOnce`
// memoizes the promise, so concurrent first requests share a single boot
// rather than racing to register the same services twice.
//
// Booting from the service layer rather than from each entry point is
// deliberate: routes, server actions, jobs and MCP tools all reach the
// platform through a service (§11), so this is the one chokepoint that cannot
// be forgotten by a new surface.
import { bootOnce, type BootReport } from "@/core/boot";
import manifests from "@/modules";

/**
 * Resolve once the platform is wired in *this* module graph.
 *
 * Safe to await on every call: after the first it is an already-resolved
 * promise, which costs a microtask. No static import cycle — `@/modules`
 * reaches only the manifests, and a manifest loads its services lazily.
 */
export function ready(): Promise<BootReport> {
  return bootOnce(manifests);
}
