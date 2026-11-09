// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deployment inventory is deliberately global. A test must clean its disposable
// database, not weaken that production query to ignore another suite's work.
import type postgres from "postgres";
import { truncateSpine } from "./spine";

export async function resetDeploymentFixture(connection: postgres.Sql): Promise<void> {
  const url = process.env.DATABASE_URL;
  const explicitFixture = process.env.TEST_DATABASE_URL === url;
  const ciFixture = Boolean(process.env.CI && url && new URL(url).pathname.endsWith("_test"));
  if (process.env.NODE_ENV !== "test" || !url || (!explicitFixture && !ciFixture)) {
    throw new Error("Deployment fixture reset requires the configured disposable test database.");
  }
  await truncateSpine();
  // No app worker or scheduler runs in these suites when this hook executes.
  // Keep both pending jobs and saved schedules out of subsequent race controls.
  await connection`TRUNCATE pgboss.job, pgboss.schedule,
    deployment_admission_runtimes, deployment_admission_holds`;
}
