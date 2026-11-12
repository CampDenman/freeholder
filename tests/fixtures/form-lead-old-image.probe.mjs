// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.34/C11.08: opt-in actual qualified N-1 runtime across normal migration79.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const artifact = process.env.FREEHOLDER_OLD_LEAD_ARTIFACT;
const node = process.env.FREEHOLDER_OLD_LEAD_NODE;
const database = process.env.TEST_DATABASE_URL;
const root = resolve(import.meta.dirname, "../..");
if (!artifact || !node || !database) throw Error("Supply the preserved prior-runtime artifact, its Node executable and an explicit disposable test database.");
const dbUrl = new URL(database);
if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname) || !/^[a-z][a-z0-9_]*test[a-z0-9_]*$/.test(dbUrl.pathname.slice(1))) throw Error("This probe only accepts an explicitly disposable loopback test database.");
const artifactHash = () => readFile(artifact).then(bytes => createHash("sha256").update(bytes).digest("hex"));
const originalArtifactHash = await artifactHash();
const originalBuildId = await readFile(resolve(dirname(artifact), ".next/BUILD_ID"), "utf8");
const appPort = Number(process.env.FREEHOLDER_OLD_LEAD_PORT ?? 3175);
const providerPort = Number(process.env.FREEHOLDER_OLD_LEAD_PROVIDER_PORT ?? 3176);
if (![appPort, providerPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536) || appPort === providerPort) throw Error("Use two distinct unprivileged loopback ports.");
const address = `http://127.0.0.1:${appPort}`;
const secret = "a11y-deterministic-session-secret-key-32+";
const signature = value => createHmac("sha256", secret).update(value).digest("base64url");
const owner = randomUUID(), form = randomUUID();
const token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
const providerCalls = [];
const healthResponses = [];
const provider = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  providerCalls.push({ method: request.method, path: request.url, body: JSON.parse(body) });
  response.writeHead(201, { "content-type": "application/json" });
  response.end(JSON.stringify({ accepted: true, id: `fictional-original-lead-${providerCalls.length}` }));
});
let child;
const output = [];
const closeChild = async () => {
  if (!child) return;
  const active = child; child = undefined;
  if (active.exitCode !== null) return;
  const exited = new Promise(resolveExit => active.once("exit", resolveExit));
  const timer = setTimeout(() => { if (active.exitCode === null) active.kill("SIGKILL"); }, 10_000);
  active.kill("SIGTERM");
  try { await exited; } finally { clearTimeout(timer); }
};
const startChild = async () => {
  child = spawn(node, [artifact], {
    cwd: dirname(artifact),
    env: {
      PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: database, APP_URL: address, HOSTNAME: "127.0.0.1", PORT: String(appPort),
      FREEHOLDER_JOBS: "off", FREEHOLDER_SKIP_MIGRATE: "1", FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1",
      LOCAL_STORAGE_ROOT: `/tmp/freeholder-lead-old-image-storage-${dbUrl.pathname.slice(1)}`,
      SESSION_SECRET: secret,
      CREDENTIAL_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      BOOTSTRAP_SECRET: "browser-test-only-bootstrap-secret-32-characters",
      LEAD_SINK_PROVIDER: "paradise", PARADISEMODERN_URL: `http://127.0.0.1:${providerPort}`,
      PARADISEMODERN_API_KEY: "fictional-local-lead-provider-key",
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", value => output.push(value.toString()));
  child.stderr.on("data", value => output.push(value.toString()));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error("The prior-runtime artifact exited before local HTTP readiness.");
    try {
      const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1000) });
      healthResponses.push({ status: response.status, body: await response.text() });
      // Jobs are intentionally off, so transport readiness is distinct from a
      // deployment health acceptance. Real form/provider positive controls follow.
      return;
    } catch { /* Poll only this explicitly started local process. */ }
    await delay(200);
  }
  throw Error("The prior-runtime artifact did not reach local HTTP readiness.");
};
const adminUrl = new URL(database); adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.href, { max: 1, onnotice() {} });
try {
  const name = dbUrl.pathname.slice(1);
  assert.equal((await admin`select datname from pg_database where datname=${name}`).length, 0, "Never replace an existing evidence database");
  await admin.unsafe(`create database ${name}`);
} finally { await admin.end(); }
const client = postgres(database, { max: 1, onnotice() {} });
try {
  const stages = await mkdtemp("/tmp/freeholder-lead-old-image-migrations-");
  await cp(resolve(root, "db/migrations"), stages, { recursive: true });
  const journal = JSON.parse(await readFile(resolve(stages, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter(entry => entry.idx <= 78);
  await writeFile(resolve(stages, "meta/_journal.json"), JSON.stringify(journal));
  await migrate(drizzle(client), { migrationsFolder: stages });
  const [beforeCount] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(beforeCount.count, 79);
  await client`insert into users(id,email,role) values(${owner},'fictional-old-image-owner@example.test','owner')`;
  await client`insert into totp_factors(user_id,encrypted_secret) values(${owner},'fictional-local-owner-factor')`;
  await client`insert into sessions(user_id,token_hash,expires_at,two_factor_verified_at,step_up_at) values(${owner},${createHmac("sha256",secret).update(token).digest("hex")},now()+interval '1 hour',now(),now())`;
  await client`insert into business_profile(name,country,base_currency,timezone,setup_completed_at) values('Fictional old-image lead','CA','CAD','America/Vancouver',now())`;
  await client`insert into forms(id,slug,name,fields) values(${form},'fictional-old-lead','Fictional old lead',${JSON.stringify([{key:"email",label:"Email",kind:"email",required:true},{key:"message",label:"Message",kind:"multiline",required:true}])}::jsonb)`;
  await new Promise(resolveListen => provider.listen(providerPort, "127.0.0.1", resolveListen));
  const invoke = (name, body) => fetch(`${address}/api/v1/${name}`, { method: "POST", headers: { "content-type": "application/json", origin: address, "x-csrf-token": csrf, cookie: `freeholder_session=${token}; freeholder_csrf=${csrf}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const submission = () => {
    const issued = String(Date.now() - 30_000);
    const values = { email: "fictional-old-image-enquiry@example.test", message: "Fictional private historical lead answer", form_stamp: `${issued}.${signature(issued)}` };
    const digest = createHash("sha256").update(JSON.stringify(Object.keys(values).sort().map(key => [key, values[key]]))).digest("base64url");
    const sealedAt = String(Date.now());
    return { slug: "fictional-old-lead", values, screening: `v1.unscreened.${sealedAt}.${signature(["forms-screening","v1","unscreened",sealedAt,"fictional-old-lead",digest].join("|"))}` };
  };
  await startChild();
  const accepted = await invoke("forms.submit", submission());
  assert.equal(accepted.ok, true, `Ordinary prior-runtime submission must work: ${await accepted.text()}`);
  assert.equal(providerCalls.length, 1, "Positive control must really reach the intercepted local provider");
  assert.deepEqual(providerCalls.map(call => [call.method, call.path]), [["POST", "/api/collect/lead"]]);
  const listed = await invoke("forms.listSubmissions", { formId: form });
  assert.equal(listed.ok, true);
  assert.match(await listed.text(), /Fictional private historical lead answer/);
  await closeChild(); // No warm admitted caller is left running across the migration.
  const tables = ["contacts", "forms", "form_submissions"];
  const snapshot = {};
  for (const table of tables) snapshot[table] = JSON.parse(JSON.stringify(await client.unsafe(`select * from ${table} order by id`)));
  await migrate(drizzle(client), { migrationsFolder: resolve(root, "db/migrations") });
  const [afterCount] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(afterCount.count, 80);
  await startChild();
  const refusedRead = await invoke("forms.listSubmissions", { formId: form });
  assert.equal(refusedRead.ok, false, "Actual cold prior-runtime answer reads must refuse after migration79");
  const refusedWrite = await invoke("forms.submit", submission());
  assert.equal(refusedWrite.ok, false, "Actual prior-runtime submission must refuse before provider delivery");
  await closeChild();
  assert.equal(providerCalls.length, 1, "A refused old runtime must not make another physical provider request");
  for (const table of tables) {
    let rows = JSON.parse(JSON.stringify(await client.unsafe(`select * from ${table} order by id`)));
    if (table === "form_submissions") rows = rows.map(({ submitted_data, ...old }) => ({ ...old, data: submitted_data }));
    assert.deepEqual(rows, snapshot[table], `${table} must survive migration and both refused old-runtime requests`);
  }
  const legacy = await client`select kind,state,original_base_url,resource_digest,attempts from form_lead_copies`;
  assert.deepEqual(Array.from(legacy), [{ kind: "legacy_review", state: "unknown", original_base_url: null, resource_digest: null, attempts: [] }]);
  assert.equal(await artifactHash(), originalArtifactHash);
  assert.equal(await readFile(resolve(dirname(artifact), ".next/BUILD_ID"), "utf8"), originalBuildId);
  assert.match(output.join(""), /form_submissions.*data|column.*data.*does not exist/s);
  console.log(JSON.stringify({ proof: "actual unchanged prior-runtime78 HTTP positive control, full stop/drain, normal79 migration, cold read/write refusal before another physical provider request", migrations: 80, physicalProviderCalls: providerCalls.length, healthResponses, bootstrapSha256: originalArtifactHash, buildId: originalBuildId.trim(), originalTablesPreserved: tables, legacyUnknownUnbound: true }));
} finally {
  await closeChild();
  if (provider.listening) await new Promise(resolveClose => provider.close(resolveClose));
  await client.end();
  await writeFile(process.env.FREEHOLDER_OLD_LEAD_RUNTIME_LOG ?? "/tmp/freeholder-lead-old-image-runtime.log", output.join(""));
}
