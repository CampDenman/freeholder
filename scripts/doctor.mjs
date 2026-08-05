// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor, from a terminal (MASTER.md §17, §18).
//
// A thin client rather than a second implementation. The checks live in the
// application because they have to *try* things — write to the bucket, open
// the mail connection, read the migration history — and a script that
// reimplemented them to run standalone is a script that eventually disagrees
// with the product about what healthy means.
//
// So this signs in and asks. Owner credentials, because the report names how
// each adapter is failing and that is not something to hand to a stranger.
//
// Usage:
//   node scripts/doctor.mjs --url http://localhost:3000 --email you@example.com --password ...
//   node scripts/doctor.mjs --json          (for monitoring, and for CI)
//   FREEHOLDER_URL=... FREEHOLDER_EMAIL=... FREEHOLDER_PASSWORD=... node scripts/doctor.mjs
//
// Exit codes, for cron and for CI: 0 clean, 1 warnings, 2 failures.
//
// Set on `process.exitCode` rather than passed to `process.exit()`. Calling
// exit while an HTTP connection is still closing aborts Node mid-teardown —
// on Windows it trips a libuv assertion and the process dies with 127, which
// a CI job reads as "the command was not found" rather than "doctor warned".
// Letting the event loop drain costs nothing and reports the truth.
async function main() {
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const url = (
  arg("url", process.env.FREEHOLDER_URL ?? "http://localhost:3000")
).replace(/\/+$/, "");
const email = arg("email", process.env.FREEHOLDER_EMAIL);
const password = arg("password", process.env.FREEHOLDER_PASSWORD);

if (!email || !password) {
  console.error(
    "Doctor needs an owner sign-in: --email and --password, or FREEHOLDER_EMAIL\n" +
      "and FREEHOLDER_PASSWORD. The report says how each adapter is failing, which\n" +
      "is not something to serve to anybody who asks.",
  );
    return 2;
}

const signIn = await fetch(`${url}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) {
  console.error(`Could not sign in to ${url}: ${signIn.status}`);
  return 2;
}
const cookie = signIn.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");

const response = await fetch(`${url}/api/doctor`, { headers: { cookie } });
const report = await response.json();
if (!report.checks) {
  console.error(`Doctor did not answer: ${response.status}`);
  return 2;
}

// Machine-readable for monitoring, and for a caller that needs to reason
// about *which* check failed rather than that something did.
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  return report.verdict === "fail" ? 2 : report.verdict === "warn" ? 1 : 0;
}

const mark = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
for (const check of report.checks) {
  console.log(`${mark[check.verdict]} ${check.title}: ${check.detail}`);
  if (check.remedy) console.log(`         → ${check.remedy}`);
}
console.log("");
console.log(
  report.verdict === "ok"
    ? "Everything doctor can check is working."
    : report.verdict === "warn"
      ? "Working, with things worth knowing about."
      : "Something is broken. The failures above will stop this instance doing its job.",
);

  return report.verdict === "fail" ? 2 : report.verdict === "warn" ? 1 : 0;
}

process.exitCode = await main();
