// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor (MASTER.md §17, §18, and the preflight half of §39.4).
//
// §17 calls this "the contract that makes community recipes trustworthy — a
// recipe isn't done until doctor passes green on a fresh deploy of it". So the
// job is not to describe configuration; it is to *try* it. Anybody can read an
// environment variable back to somebody. What an owner needs to know is
// whether the bucket accepts a file, whether the mail server answers, and
// whether the schema in the database is the one this build expects.
//
// Every check therefore does the cheapest real thing rather than the most
// thorough plausible thing:
//
//   - storage writes an object, reads it back, and deletes it
//   - mail opens a connection and says hello
//   - the database is asked which migrations it has actually run
//
// And every failure carries the sentence that fixes it. A check that reports
// "storage misconfigured" has told an owner what they already knew.
import { sql } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import { env } from "@/core/env";
import { db } from "@/core/db";

export type Verdict = "ok" | "warn" | "fail";

export interface Check {
  /** Dotted and stable, so a recipe or a monitor can name one. */
  id: string;
  /** What was examined, in the words an owner would use. */
  title: string;
  verdict: Verdict;
  /** What is true. One sentence, no jargon, no stack traces. */
  detail: string;
  /** What to do about it. Present whenever the verdict is not ok. */
  remedy?: string;
}

export interface DoctorReport {
  verdict: Verdict;
  checks: Check[];
  ranAt: string;
}

const ok = (id: string, title: string, detail: string): Check => ({
  id,
  title,
  verdict: "ok",
  detail,
});
const warn = (id: string, title: string, detail: string, remedy: string): Check => ({
  id,
  title,
  verdict: "warn",
  detail,
  remedy,
});
const fail = (id: string, title: string, detail: string, remedy: string): Check => ({
  id,
  title,
  verdict: "fail",
  detail,
  remedy,
});

/** The message from an unknown throw, without the stack. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkEnvironment(): Promise<Check[]> {
  const e = env();
  const production = e.NODE_ENV === "production";
  const checks: Check[] = [];

  if (!e.SESSION_SECRET) {
    checks.push(
      production
        ? fail(
            "env.sessionSecret",
            "Session secret",
            "SESSION_SECRET is not set, so nobody can stay signed in.",
            'Generate one: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"',
          )
        : warn(
            "env.sessionSecret",
            "Session secret",
            "SESSION_SECRET is not set. Development sessions will not survive a restart.",
            "Set SESSION_SECRET in .env before deploying anywhere real.",
          ),
    );
  } else if (e.SESSION_SECRET.length < 32) {
    checks.push(
      fail(
        "env.sessionSecret",
        "Session secret",
        `SESSION_SECRET is ${e.SESSION_SECRET.length} characters; sessions are only as hard to forge as it is.`,
        "Use at least 32 random characters.",
      ),
    );
  } else {
    checks.push(
      ok("env.sessionSecret", "Session secret", "Set, and long enough."),
    );
  }

  // §5's canonical URLs, §9's cookies and every emailed link are built from
  // APP_URL. Wrong here is wrong in a search index and in somebody's inbox.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(e.APP_URL);
  if (production && local) {
    checks.push(
      fail(
        "env.appUrl",
        "Site address",
        `APP_URL is ${e.APP_URL}, so canonical links, sitemaps and password-reset emails all point at this machine.`,
        "Set APP_URL to the address visitors actually use, including https://.",
      ),
    );
  } else if (production && e.APP_URL.startsWith("http://")) {
    checks.push(
      warn(
        "env.appUrl",
        "Site address",
        "APP_URL is http, so session cookies cannot be marked Secure.",
        "Serve the site over https and set APP_URL accordingly.",
      ),
    );
  } else {
    checks.push(ok("env.appUrl", "Site address", `Serving as ${e.APP_URL}.`));
  }

  return checks;
}

async function checkDatabase(): Promise<Check[]> {
  const checks: Check[] = [];
  if (!env().DATABASE_URL) {
    return [
      fail(
        "db.connection",
        "Database",
        "DATABASE_URL is not set, so there is nothing to serve from.",
        "Point DATABASE_URL at a Postgres 15+ database. See .env.example.",
      ),
    ];
  }

  try {
    const [row] = await db().execute<{ version: string }>(
      sql`select current_setting('server_version') as version`,
    );
    const version = Number.parseInt(row?.version ?? "0", 10);
    checks.push(
      version >= 15
        ? ok("db.connection", "Database", `Connected to Postgres ${row?.version}.`)
        : warn(
            "db.connection",
            "Database",
            `Connected to Postgres ${row?.version}. Freeholder is developed against 15 and later.`,
            "Upgrade when convenient; nothing is known to be broken below it.",
          ),
    );
  } catch (error) {
    return [
      fail(
        "db.connection",
        "Database",
        `Could not connect: ${reason(error)}`,
        "Check DATABASE_URL, and that the database is running and reachable.",
      ),
    ];
  }

  // The check that actually matters after a deploy: is the schema the one this
  // build expects? A missing migration is invisible until the first request
  // touches the table it added.
  try {
    const files = (await readdir("db/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applied = await db().execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    const run = Number(applied[0]?.count ?? 0);
    checks.push(
      run >= files.length
        ? ok(
            "db.migrations",
            "Schema",
            `All ${files.length} migrations have been applied.`,
          )
        : fail(
            "db.migrations",
            "Schema",
            `${files.length - run} of ${files.length} migrations have not been applied.`,
            "Restart the app — it migrates at boot — or run `pnpm db:migrate`.",
          ),
    );
  } catch {
    // Not fatal: the migration table lives in drizzle's own schema and a
    // recipe that migrates out of band may not have it.
    checks.push(
      warn(
        "db.migrations",
        "Schema",
        "Could not read the migration history, so the schema version is unknown.",
        "If the site is serving pages, this is probably a permissions detail rather than a problem.",
      ),
    );
  }

  return checks;
}

async function checkStorage(): Promise<Check> {
  // A real round trip. Credentials that parse and a bucket that refuses writes
  // look identical from the outside until an owner uploads a photograph.
  const probe = `doctor/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  try {
    const { storage } = await import("@/adapters/storage");
    const store = storage();
    const body = new TextEncoder().encode("freeholder doctor");
    await store.put(probe, body, "text/plain");
    const read = await store.get(probe);
    await store.delete(probe);
    if (!read || new TextDecoder().decode(read) !== "freeholder doctor") {
      return fail(
        "storage.roundTrip",
        "File storage",
        "A file was written and came back different or empty.",
        "Check the bucket's permissions — writes appear to be silently dropped.",
      );
    }
    return ok(
      "storage.roundTrip",
      "File storage",
      `Wrote, read and deleted a test file (${store.isPublic ? "public" : "private"} bucket).`,
    );
  } catch (error) {
    return fail(
      "storage.roundTrip",
      "File storage",
      `Could not store a file: ${reason(error)}`,
      "Check adapters.storage in freeholder.config.ts and the S3_* variables. Uploads will fail until this passes.",
    );
  }
}

async function checkMail(): Promise<Check> {
  try {
    const { mail } = await import("@/adapters/mail");
    const adapter = mail();
    if (!adapter.delivers) {
      return warn(
        "mail.delivers",
        "Email",
        "No mail is configured, so password resets and notifications are written to the log instead of being sent.",
        "Set MAIL_ADAPTER=smtp with SMTP_HOST and MAIL_FROM. Until then, a locked-out owner needs `node scripts/owner-password.mjs` on the server.",
      );
    }
    return ok("mail.delivers", "Email", `Configured to send through ${adapter.id}.`);
  } catch (error) {
    return fail(
      "mail.delivers",
      "Email",
      `Mail is configured but could not be set up: ${reason(error)}`,
      "Check MAIL_ADAPTER and the SMTP_* variables.",
    );
  }
}

async function checkJobs(): Promise<Check> {
  const { listJobs } = await import("@/core/jobs");
  const jobs = [...listJobs().values()];
  const scheduled = jobs.filter((job) => job.schedule).length;

  if (env().FREEHOLDER_JOBS === "off") {
    return warn(
      "jobs.worker",
      "Background work",
      "Jobs are switched off in this process. Nothing sweeps expired sessions, and events a crash stranded are never redelivered.",
      "Make sure another process runs the worker, or unset FREEHOLDER_JOBS.",
    );
  }
  if (jobs.length === 0) {
    return fail(
      "jobs.worker",
      "Background work",
      "No jobs are registered, which should be impossible — core ships several.",
      "The platform did not finish booting. Check the log for an error at startup.",
    );
  }
  return ok(
    "jobs.worker",
    "Background work",
    `${jobs.length} jobs registered, ${scheduled} on a schedule.`,
  );
}

/** The command that makes a key, quoted once so two remedies cannot drift. */
const GENERATE_KEY = [
  "Generate one with:",
  "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
].join(" ");

/**
 * The key that encrypts an owner's connected accounts (§41).
 *
 * Absent is fine until something is connected — an instance that has never
 * linked a Google account has nothing to protect. Once one exists the key is
 * load-bearing, and §41 is explicit that doctor should say so rather than
 * letting the first sync be where an owner finds out.
 */
async function checkCredentialKey(): Promise<Check[]> {
  const { credentialKeyConfigured, credentialKeyWorks } = await import(
    "@/core/connections/crypto"
  );
  const configured = credentialKeyConfigured();

  let connected = false;
  try {
    const { hasConnections } = await import("@/core/connections/service");
    connected = await hasConnections();
  } catch {
    // No database is already a failing check of its own; this one has nothing
    // to add to it.
    return [];
  }

  if (!configured) {
    return [
      connected
        ? fail(
            "security.credentialKey",
            "Connected accounts",
            "Accounts are connected but CREDENTIAL_KEY is not set, so their stored credentials cannot be read.",
            `Restore the key you used when connecting them. If it is gone, disconnect and reconnect each account. ${GENERATE_KEY}`,
          )
        : warn(
            "security.credentialKey",
            "Connected accounts",
            "CREDENTIAL_KEY is not set. Nothing needs it yet, and connecting a Google or Microsoft account will.",
            `Set it before connecting anything. ${GENERATE_KEY}`,
          ),
    ];
  }

  try {
    if (!credentialKeyWorks()) {
      return [
        fail(
          "security.credentialKey",
          "Connected accounts",
          "CREDENTIAL_KEY is set but a test encryption did not survive a round trip.",
          "Check that the key is 32 bytes, as 64 hex characters or base64url.",
        ),
      ];
    }
  } catch (error) {
    return [
      fail(
        "security.credentialKey",
        "Connected accounts",
        `CREDENTIAL_KEY is set but unusable: ${reason(error)}`,
        "It must be 32 bytes, as 64 hex characters or base64url.",
      ),
    ];
  }

  return [
    ok(
      "security.credentialKey",
      "Connected accounts",
      connected
        ? "The key that protects your connected accounts is working."
        : "Ready to store connected accounts securely.",
    ),
  ];
}

async function checkSecurity(): Promise<Check[]> {
  const e = env();
  const checks: Check[] = [];

  if (e.NODE_ENV === "production" && e.FREEHOLDER_UNSAFE_LOCAL_STORAGE === "1") {
    checks.push(
      warn(
        "security.localStorage",
        "Media on this machine",
        "Media is being kept on this server's disk, which is not backed up and does not survive a rebuild.",
        "Move to object storage (§18) unless you have your own backup of this directory.",
      ),
    );
  }

  if (e.NODE_ENV === "production" && e.FREEHOLDER_SEED_DEMO === "1") {
    checks.push(
      warn(
        "security.seedDemo",
        "Demo content",
        "FREEHOLDER_SEED_DEMO is set on a production instance. It installs the demo business into an empty site.",
        "Unset it once the real site has content — it refuses to overwrite, but leaving it set is confusing.",
      ),
    );
  }

  if (e.FREEHOLDER_STORAGE === "s3" && e.S3_PUBLIC === "true") {
    checks.push(
      warn(
        "security.publicMediaBucket",
        "Media bucket privacy",
        "The S3 bucket is public, so resumable direct upload is disabled until each original can be validated and scanned.",
        "Make the bucket private and leave S3_PUBLIC unset. Freeholder signs ready media URLs and proxies document downloads.",
      ),
    );
  }

  return checks;
}

async function checkMalwareScanner(): Promise<Check> {
  const e = env();
  if (e.MALWARE_SCANNER !== "clamav") {
    return warn(
      "media.malwareScanner",
      "Uploaded-file malware scanner",
      "No antivirus engine is connected. File signatures are still verified and documents are forced to download.",
      "Run clamd, set MALWARE_SCANNER=clamav and CLAMAV_HOST, then run doctor again.",
    );
  }
  try {
    const { malwareScanner } = await import("@/adapters/malware");
    const test = new Uint8Array(
      Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      ),
    );
    const result = await malwareScanner().scan({
      filename: "freeholder-doctor-eicar.txt",
      contentType: "text/plain",
      bytes: test.byteLength,
      body: (async function* () {
        yield test;
      })(),
    });
    if (result.status !== "infected") {
      return fail(
        "media.malwareScanner",
        "Uploaded-file malware scanner",
        `The scanner answered ${result.status} to its harmless standard test signature.`,
        "Check clamd connectivity and signature databases before accepting uploads.",
      );
    }
    return ok(
      "media.malwareScanner",
      "Uploaded-file malware scanner",
      "ClamAV detected the standard test signature over its streaming interface.",
    );
  } catch (error) {
    return fail(
      "media.malwareScanner",
      "Uploaded-file malware scanner",
      `ClamAV could not scan a test stream: ${reason(error)}`,
      "Check MALWARE_SCANNER, CLAMAV_HOST, CLAMAV_PORT and clamd availability.",
    );
  }
}

/**
 * Run every check.
 *
 * Sequential rather than parallel on purpose: the output reads as a list
 * somebody works down, and one adapter's timeout should not interleave its
 * error with another's.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: Check[] = [
    ...(await checkEnvironment()),
    ...(await checkDatabase()),
    await checkStorage(),
    await checkMalwareScanner(),
    await checkMail(),
    await checkJobs(),
    ...(await checkCredentialKey()),
    ...(await checkSecurity()),
  ];

  const verdict: Verdict = checks.some((check) => check.verdict === "fail")
    ? "fail"
    : checks.some((check) => check.verdict === "warn")
      ? "warn"
      : "ok";

  return { verdict, checks, ranAt: new Date().toISOString() };
}

/** The report as somebody would want to read it in a terminal. */
export function formatReport(report: DoctorReport): string {
  const mark = { ok: "  ok  ", warn: " warn ", fail: " FAIL " } as const;
  const lines = report.checks.map((check) => {
    const head = `${mark[check.verdict]} ${check.title}: ${check.detail}`;
    return check.remedy ? `${head}\n         → ${check.remedy}` : head;
  });
  const summary =
    report.verdict === "ok"
      ? "Everything doctor can check is working."
      : report.verdict === "warn"
        ? "Working, with things worth knowing about."
        : "Something is broken. The failures above will stop this instance doing its job.";
  return [...lines, "", summary].join("\n");
}
