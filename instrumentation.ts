// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Where the platform actually starts. Next calls register() once per server
// instance, which is the closest thing an App Router app has to a main().
//
// The build phase is skipped deliberately: `next build` runs with
// NODE_ENV=production but without the secrets a running instance needs, so
// booting here would turn "no SESSION_SECRET configured yet" into a failed
// build rather than a clear refusal to serve traffic.
import { bootOnce } from "@/core/boot";
import coreManifest from "@/core/manifest";

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  await bootOnce([coreManifest]);
}
