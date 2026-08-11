// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor as a service (MASTER.md §17, §2 principle 7).
//
// One implementation, four doors: the admin screen, the REST API, MCP, and
// whatever a recipe's CI calls. The alternative — a script that reimplements
// the checks so it can run without the app — is how the script and the product
// come to disagree about what "healthy" means.
import { z } from "zod";
import { defineService } from "@/core/service";
import { runDoctor } from "@/core/doctor";

/**
 * Owner-only.
 *
 * The report names which adapters are configured and how they are failing,
 * which is exactly the reconnaissance somebody probing an instance would like.
 * `/api/health` stays public and stays shallow for the same reason.
 */
export const doctor = defineService({
  name: "platform.doctor",
  summary: "Check this instance's configuration and adapters.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: () => runDoctor(),
});

export default [doctor];
