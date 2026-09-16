// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Process-only liveness. Dependency and worker failures belong to readiness;
// restarting a healthy web process cannot repair either one.
import { PLATFORM_VERSION } from "@/core/platform";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true, version: PLATFORM_VERSION });
}
