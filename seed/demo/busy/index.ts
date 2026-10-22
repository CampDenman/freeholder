// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The busy demo: Aurora Coast after six months on Freeholder (C1.38).
//
// The plain demo (seed/demo/content.ts) is a *site*: pages, chrome, a shop,
// bookable services, events. This layer is the *business* behind it — the
// people, the money, the calendar and the traffic a studio accumulates — so
// every admin screen an evaluator opens in the public playground is full.
//
// It is written as bulk inserts inside one transaction rather than thousands
// of service calls, because the playground resets hourly on half a CPU and
// the reset has a readiness budget. Each area seeder is still bound by the
// invariants the services enforce (one contact per lowercased email, ledgers
// that balance, statuses that agree with their timestamps), and
// tests/core/seed-demo-busy.test.ts checks those invariants on the result.
import type { Tx } from "@/core/service";
import type { AreaSeeder, World } from "./world";
import { seedCrm } from "./crm";
import { seedSales } from "./sales";
import { seedCalendar } from "./calendar";
import { seedContent } from "./content";
import { seedActivity } from "./activity";

/** In dependency order: everything after CRM refers to its contacts. */
export const AREAS: Array<[string, AreaSeeder]> = [
  ["crm", seedCrm],
  ["sales", seedSales],
  ["calendar", seedCalendar],
  ["content", seedContent],
  ["activity", seedActivity],
];

export async function seedBusyBusiness(
  tx: Tx,
  world: World,
): Promise<Record<string, Record<string, number>>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const [name, seeder] of AREAS) {
    const started = Date.now();
    counts[name] = { ...(await seeder(tx, world)), ms: Date.now() - started };
  }
  return counts;
}

export { world } from "./world";
export type { World } from "./world";
