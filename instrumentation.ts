// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where the platform actually starts. Next calls register() once per server
// instance, which is the closest thing an App Router app has to a main().
//
// Two guards, both load-bearing:
//
// The Edge runtime cannot run the platform. Next evaluates this file in *both*
// runtimes, and core reaches node:crypto through auth — so a static import
// would drag the whole spine into an Edge bundle that cannot execute it. The
// imports are dynamic and behind the runtime check so the Edge build never
// sees them.
//
// The build phase is skipped because `next build` runs with NODE_ENV set to
// production but without the secrets a running instance needs; booting here
// would turn "no SESSION_SECRET configured yet" into a failed build rather
// than a clear refusal to serve traffic.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Before boot, and before the first request: a fresh deploy otherwise starts
  // against an empty database and answers 500 on every page (§14 promises one
  // command, not one command and a schema migration nobody mentioned).
  const { migrateToLatest } = await import("@/core/migrate");
  const result = await migrateToLatest();
  console.log(
    result.ran
      ? "[freeholder] schema is up to date"
      : `[freeholder] migrations skipped: ${result.reason}`,
  );

  const { bootOnce } = await import("@/core/boot");
  const { default: manifests } = await import("@/modules");
  await bootOnce(manifests);

  // After boot, because installing the demo calls services that boot has to
  // have registered, and because a manifest's own services load lazily.
  const { seedDemoIfRequested } = await import("@/modules/seed/boot");
  await seedDemoIfRequested();

  // The worker last: every job is registered by boot, and starting before
  // that would mount an empty queue. Failure is logged rather than fatal —
  // an instance that cannot run background work should still serve pages,
  // and the outbox is durable while it waits.
  try {
    const { startJobs } = await import("@/core/jobs");
    await startJobs();
  } catch (error) {
    console.error("[jobs] worker did not start; the site is still serving", error);
  }
}
