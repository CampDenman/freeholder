// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Is this instance actually wired up?
//
// Not a liveness ping — the process answering at all proves that. This answers
// the harder question: are the modules booted *in the graph serving requests*?
//
// It exists because the answer was silently "no" in production for three
// phases. `instrumentation.ts` boots in its own module graph, so the service
// registry and event listeners it populated were invisible to request
// handling; the first feature to depend on them (cms seeding a site when setup
// completes) failed with no error anywhere. Counts, not names: enough to prove
// wiring, nothing an unauthenticated caller can use.
//
// CI asserts this is non-zero after starting the image, and scripts/doctor.ts
// (§17) will read it once it exists.
import { PLATFORM_VERSION } from "@/core/platform";
import { getJobRuntimeEvidence } from "@/core/jobs/health";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const report = await ready();
    const jobs = await getJobRuntimeEvidence();
    // An installed plugin that could not be wired makes this instance a
    // different product from the one that was deployed, so it is not ready.
    //
    // It used to be: a plugin was disabled, `modules.length` still counted it,
    // readiness answered ok, and the platform promoted the broken instance over
    // the healthy one it was replacing — 36 routes short, with nothing in the
    // logs. Counting a disable as readiness is how that happened, so a disable
    // now fails readiness and says how many.
    const ok = jobs.ready && report.disabled.length === 0;
    return Response.json(
      {
        ok,
        version: PLATFORM_VERSION,
        modules: report.modules.length,
        services: report.services.length,
        listeners: report.listeners.length,
        // A count, not the names or reasons: the same rule as every other
        // number here. Which plugin and why is on stderr and behind Doctor.
        disabled: report.disabled.length,
        jobs,
      },
      { status: ok ? 200 : 503 },
    );
  } catch {
    // Database errors may contain query values. Public readiness needs only a
    // red result, and detailed diagnosis belongs behind the Doctor permission.
    console.error("[freeholder] readiness failed");
    return Response.json({ ok: false }, { status: 503 });
  }
}
