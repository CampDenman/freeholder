#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C1.38: run only on a disposable CI Docker host.
set -eu
test "${CI:-}" = true || { echo 'This gate requires a disposable CI host.' >&2; exit 1; }
export FREEHOLDER_IMAGE="${CI_IMAGE:?Build the CI image first}"
export PLAYGROUND_DOMAIN=demo.example.test
export PLAYGROUND_DB_PASSWORD="$(openssl rand -hex 32)"
export PLAYGROUND_SESSION_SECRET="$(openssl rand -hex 32)"
compose() { docker compose --project-name freeholder-playground --file deploy/docker-selfhost/playground/compose.yml "$@"; }
# On failure, say WHY. `compose logs` alone reports only
# "migration unavailable (Error)", because instrumentation.node.ts prints an
# error's code or class name and never its message -- right for a production
# log, useless here. This playground is disposable, its password came from
# `openssl rand`, and the log goes nowhere but this CI job, so the error itself
# is safe to print. It runs the image's OWN shipped runner, in the app
# container, with the app's environment and network: if migration succeeds here
# while boot reports it failing, the fault is in the boot path, not the
# migration.
diagnose() {
  echo '--- the shipped migration runner, in the app container ---'
  compose exec -T app node -e '
    (async () => {
      const { default: postgres } = await import("postgres");
      const { runMigrationsOnDedicatedSession } = await import("/app/src/core/migrate-runner.mjs");
      const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
      try {
        await runMigrationsOnDedicatedSession(client, { migrationsFolder: "db/migrations" });
        console.log("Migration SUCCEEDED from inside the app container: the migration phase is not what is failing.");
      } catch (error) {
        console.error(`name=${error?.name} code=${error?.code}`);
        console.error(String(error?.message ?? "").slice(0, 4000));
        console.error(String(error?.stack ?? "").slice(0, 4000));
      } finally { await client.end(); }
    })().catch((error) => console.error("probe itself failed:", error?.message));
  ' 2>&1 || echo 'the probe could not run in the app container'
}
cleanup() { result=$?; if [ "$result" != 0 ]; then compose logs --tail 100 app; diagnose; fi; compose down --timeout 10 >/dev/null 2>&1 || true; docker network rm freeholder-playground-proxy >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal freeholder-playground-proxy
compose up -d
app=$(compose ps -q app)
ready=0
for attempt in $(seq 1 90); do
  if docker exec "$app" node -e 'fetch("http://localhost:3000/api/health").then(async r=>{const b=await r.json();if(!r.ok||!b.ok||!b.jobs?.ready)process.exit(1)}).catch(()=>process.exit(1))'; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then compose logs --tail 80 app; exit 1; fi
docker exec "$app" node -e '
  (async()=> {
    const r=await fetch("http://localhost:3000/playground");
    const html=await r.text();
    if(!r.ok || !html.includes("Enter the playground")) throw Error("Missing entry page");
    const robots=await fetch("http://localhost:3000/robots.txt").then(r=>r.text());
    if(!robots.includes("Disallow: /")) throw Error("Demo must refuse indexing");
    const action=html.match(/name="(\$ACTION_ID_[^"]+)"/);
    if(!action) throw Error("Missing entry action");
    const form=new FormData();form.set(action[1], "");
    const entry=await fetch("http://localhost:3000/playground", {method:"POST", body:form, redirect:"manual", headers:{origin:"http://localhost:3000"}});
    if(entry.status!==303 || !entry.headers.get("location")?.endsWith("/admin")) throw Error("Entry refused: "+entry.status);
    const cookie=entry.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const admin=await fetch("http://localhost:3000/admin",{headers:{cookie},redirect:"manual"});
    if(admin.status!==200) throw Error("Visitor cannot enter admin: "+admin.status);
    const pages=await fetch("http://localhost:3000/admin/pages",{headers:{cookie}}).then(r=>r.text());
    const editPath=pages.match(/href="(\/admin\/pages\/[a-f0-9-]{36})"/)?.[1];
    if(!editPath) throw Error("No editable sample page");
    const editor=await fetch("http://localhost:3000"+editPath,{headers:{cookie}});
    if(!editor.ok || !(await editor.text()).includes("Add a block")) throw Error("Visitor editor did not render");
    try { await fetch("https://example.com",{signal:AbortSignal.timeout(1500)}); throw Error("EGRESS_ALLOWED"); }
    catch(error) { if(error.message==="EGRESS_ALLOWED") throw error; }
    console.log("Playground boots read-only, signs in a visitor, renders the page editor and blocks outbound delivery.");
  })().catch(e=>{console.error(e.message);process.exit(1)});
'
