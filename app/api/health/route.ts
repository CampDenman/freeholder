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
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const report = await ready();
    return Response.json({
      ok: true,
      modules: report.modules.length,
      services: report.services.length,
      listeners: report.listeners.length,
    });
  } catch (error) {
    console.error("[freeholder] boot failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
