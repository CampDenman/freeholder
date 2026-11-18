#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# Prove the PACKAGED image applies every migration to an empty database -- and
# say why in full when it cannot.
#
# instrumentation.node.ts prints only an error's code or class name, because a
# production log must never carry SQL, a connection string or a provider
# payload. That rule is right, and it is also why a packaged-boot failure is
# undiagnosable from CI today: the playground gate reports
# "migration unavailable (Error)" and nothing more, which identifies no file,
# no statement and no cause. This gate runs the image's own shipped runner
# against a throwaway database on a disposable CI host, where the error is safe
# to print, and it runs BEFORE the playground gate so the first red names the
# cause instead of a symptom three gates later.
set -eu
test "${CI:-}" = true || { echo 'This gate requires a disposable CI host.' >&2; exit 1; }
image="${CI_IMAGE:?Build the CI image first}"
database=image_migration_probe

# Its own database, not the shared test one: migrations must prove they apply
# to an EMPTY schema, which is the state every new deploy starts from.
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $database" postgres
psql -v ON_ERROR_STOP=1 -q -c "create database $database" postgres

# --network host reaches the job's postgres service, the same way the liveness
# probe step already does. The runner is the one the image boots with, not a
# copy of it, so a packaging mistake fails here too.
docker run --rm --network host \
  -e "DATABASE_URL=postgres://$PGUSER:$PGPASSWORD@127.0.0.1:5432/$database" \
  --entrypoint node "$image" --input-type=module -e '
    const { default: postgres } = await import("postgres");
    const { runMigrationsOnDedicatedSession } = await import("/app/src/core/migrate-runner.mjs");
    const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await runMigrationsOnDedicatedSession(client, { migrationsFolder: "db/migrations" });
      console.log("The packaged image applied every migration to an empty database.");
    } catch (error) {
      // Throwaway database, throwaway host, CI log: printing the error here is
      // the entire purpose of this gate.
      console.error(`name=${error?.name} code=${error?.code}`);
      console.error(String(error?.message ?? "").slice(0, 4000));
      console.error(String(error?.stack ?? "").slice(0, 4000));
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  '
