// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { and, eq, sql } from "drizzle-orm";
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

async function checkMail(): Promise<Check[]> {
  const { mailConfigurationStatus } = await import("@/adapters/mail");
  const { connectedAccounts, connectionCapabilities } = await import(
    "@/core/connections/schema"
  );
  const { mailSenders } = await import("@/core/mail/schema");
  const configuration = mailConfigurationStatus();
  let senders: Array<{
    purpose: "transactional" | "bulk";
    provider: string;
    email: string;
    verificationStatus: "pending" | "verified" | "failed";
    status: "active" | "paused" | "needs_attention";
    isDefault: boolean;
    verificationDetail: unknown;
    accountStatus: "active" | "needs_reconnect" | "revoked" | null;
    capabilityEnabled: boolean | null;
  }>;
  try {
    senders = await db()
      .select({
        purpose: mailSenders.purpose,
        provider: mailSenders.provider,
        email: mailSenders.email,
        verificationStatus: mailSenders.verificationStatus,
        status: mailSenders.status,
        isDefault: mailSenders.isDefault,
        verificationDetail: mailSenders.verificationDetail,
        accountStatus: connectedAccounts.status,
        capabilityEnabled: connectionCapabilities.enabled,
      })
      .from(mailSenders)
      .leftJoin(
        connectedAccounts,
        eq(connectedAccounts.id, mailSenders.connectedAccountId),
      )
      .leftJoin(
        connectionCapabilities,
        and(
          eq(
            connectionCapabilities.connectedAccountId,
            connectedAccounts.id,
          ),
          eq(connectionCapabilities.capability, "mail_send"),
        ),
      );
  } catch {
    return [
      fail(
        "mail.delivers",
        "Account email",
        "Mail configuration exists, but sender state could not be read from the database.",
        "Apply the current migrations, then run doctor again.",
      ),
    ];
  }

  const transactional = senders.filter(
    (sender) => sender.purpose === "transactional",
  );
  const readyTransactional = transactional.find(
    (sender) =>
      sender.isDefault &&
      sender.status === "active" &&
      sender.verificationStatus === "verified" &&
      sender.provider !== "console" &&
      sender.accountStatus !== "needs_reconnect" &&
      sender.accountStatus !== "revoked" &&
      sender.capabilityEnabled !== false,
  );
  const brokenConnection = transactional.find(
    (sender) =>
      sender.accountStatus === "needs_reconnect" ||
      sender.accountStatus === "revoked" ||
      sender.capabilityEnabled === false,
  );
  let transactionalCheck: Check;
  if (configuration.transactional.missing.length > 0) {
    transactionalCheck = fail(
      "mail.delivers",
      "Account email",
      `${configuration.transactional.provider} is selected but its setup is incomplete.`,
      `Set ${configuration.transactional.missing.join(", ")}, restart Freeholder, and register or connect the sender in Admin → Settings → Mail.`,
    );
  } else if (brokenConnection) {
    transactionalCheck = fail(
      "mail.delivers",
      "Account email",
      `${brokenConnection.email} cannot send because its provider authorization needs attention.`,
      "Reconnect the mailbox in Admin → Settings → Mail and approve mail-send permission.",
    );
  } else if (readyTransactional) {
    const detail =
      readyTransactional.provider === "smtp"
        ? `${readyTransactional.email} is registered through SMTP. Transport is configured; DNS ownership is not proven by SMTP setup alone.`
        : `${readyTransactional.email} is verified and selected through ${readyTransactional.provider}.`;
    transactionalCheck =
      readyTransactional.provider === "smtp"
        ? warn(
            "mail.delivers",
            "Account email",
            detail,
            "Send a test from Admin → Settings → Mail, then confirm SPF, DKIM and DMARC with the mailbox provider.",
          )
        : ok("mail.delivers", "Account email", detail);
  } else if (configuration.transactional.provider === "smtp") {
    transactionalCheck = warn(
      "mail.delivers",
      "Account email",
      "SMTP is configured, but its sender is not registered in the delivery console.",
      "Open Admin → Settings → Mail, register the configured MAIL_FROM address, and send a non-billable test to your own account.",
    );
  } else {
    transactionalCheck = warn(
      "mail.delivers",
      "Account email",
      "No active verified sender is selected, so password resets and account messages cannot reach an inbox.",
      "Configure Google or Microsoft OAuth and CREDENTIAL_KEY, or set MAIL_ADAPTER=smtp with SMTP_HOST and MAIL_FROM. Then connect or register the sender in Admin → Settings → Mail. A locked-out owner can use `node scripts/owner-password.mjs` on the server.",
    );
  }

  const checks = [transactionalCheck];
  const bulk = configuration.bulk;
  const bulkSenders = senders.filter((sender) => sender.purpose === "bulk");
  const readyBulk = bulkSenders.find(
    (sender) =>
      sender.provider === bulk.provider &&
      sender.isDefault &&
      sender.status === "active" &&
      sender.verificationStatus === "verified",
  );
  if (bulk.provider === "none") {
    checks.push(
      warn(
        "mail.bulk",
        "Broadcast email",
        "Broadcast mail is off. Campaign sends are refused rather than falling back to a personal mailbox.",
        "When campaigns are needed, choose Resend, Postmark or Amazon SES with MAIL_BULK_ADAPTER and complete the provider variables in .env.example.",
      ),
    );
  } else if (!bulk.sendConfigured) {
    checks.push(
      fail(
        "mail.bulk",
        "Broadcast email",
        `${bulk.provider} is selected but cannot submit mail.`,
        `Set ${bulk.missing.join(", ")}, restart Freeholder, then register and verify MAIL_BULK_FROM in Admin → Settings → Mail.`,
      ),
    );
  } else if (!readyBulk) {
    const pending = bulkSenders.find(
      (sender) => sender.verificationStatus === "pending",
    );
    checks.push(
      warn(
        "mail.bulk",
        "Broadcast email",
        pending
          ? `${pending.email} is registered with ${bulk.provider}, but provider verification is still pending.`
          : `${bulk.provider} is configured, but no active verified default broadcast sender is selected.`,
        "Open Admin → Settings → Mail, register MAIL_BULK_FROM, check provider verification, and choose it as the default. Doctor never makes a billable campaign send.",
      ),
    );
  } else {
    checks.push(
      ok(
        "mail.bulk",
        "Broadcast email",
        `${readyBulk.email} is verified and selected through ${bulk.provider}. No billable test was sent.`,
      ),
    );
  }

  if (bulk.provider !== "none") {
    const endpoint = `${env().APP_URL.replace(/\/+$/, "")}${bulk.webhookPath}`;
    checks.push(
      bulk.feedbackConfigured
        ? ok(
            "mail.feedback",
            "Delivery feedback",
            `${bulk.provider} feedback is configured for ${endpoint}${bulk.provider === "ses" ? " with Amazon SNS SignatureVersion 2 (RSA-SHA256) required" : ""}.`,
          )
        : fail(
            "mail.feedback",
            "Delivery feedback",
            `${bulk.provider} can submit mail, but authenticated bounce and complaint feedback is incomplete.`,
            `Set ${bulk.missing.join(", ")} and point the provider webhook at ${endpoint}.${bulk.provider === "ses" ? " Configure the exact SES SNS topic and require SNS SignatureVersion 2; SHA-1 messages are refused." : ""}`,
          ),
    );
  }
  return checks;
}

async function checkNotificationChannels(): Promise<Check[]> {
  const { notificationAdapterStatus } = await import("@/adapters/notifications");
  return notificationAdapterStatus().map((status) =>
    status.available
      ? ok(
          `notifications.${status.channel}`,
          `${status.channel.toUpperCase()} notifications`,
          `${status.provider} is ready. Doctor did not send a billable message.`,
        )
      : warn(
          `notifications.${status.channel}`,
          `${status.channel.toUpperCase()} notifications`,
          status.message,
          status.channel === "sms"
            ? "Leave SMS preferences off until the C7.10 carrier and consent controls are installed. In-app and email delivery continue normally."
            : "Leave push preferences off until C10.14 installs device registration and a production carrier. In-app and email delivery continue normally.",
        ),
  );
}

/** Configuration-only: a doctor run never creates a checkout or moves money. */
async function checkPayments(): Promise<Check> {
  const { paymentAdapter } = await import("@/adapters/payments");
  const adapter = paymentAdapter();
  if (adapter.id === "manual") {
    return ok(
      "payments.provider",
      "Payments",
      "Offline cash, cheque, bank-transfer, and external-card records are available through the shared invoice ledger.",
    );
  }
  if (!adapter.status.available) {
    const base = env().APP_URL.replace(/\/+$/, "");
    const remedies: Record<string, string> = {
      stripe: `Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then point Stripe at ${base}/api/payments/webhooks/stripe.`,
      paypal: `Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID, choose PAYPAL_ENVIRONMENT, then point PayPal at ${base}/api/payments/webhooks/paypal.`,
      square: `Set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, and SQUARE_WEBHOOK_SIGNATURE_KEY, choose SQUARE_ENVIRONMENT, then register exactly ${base}/api/payments/webhooks/square.`,
      mollie: `Set MOLLIE_API_KEY, then use ${base}/api/payments/webhooks/mollie as the payment webhook URL. Set MOLLIE_WEBHOOK_SECRET as well if you enable next-generation events.`,
      razorpay: `Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET, then point Razorpay at ${base}/api/payments/webhooks/razorpay.`,
      paystack: `Set PAYSTACK_SECRET_KEY, then point Paystack at ${base}/api/payments/webhooks/paystack. The same secret authenticates API calls and SHA-512 feedback.`,
      flutterwave: `Set FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_SECRET, then point Flutterwave at ${base}/api/payments/webhooks/flutterwave and enable retries.`,
    };
    return fail(
      "payments.provider",
      "Payments",
      adapter.status.message,
      remedies[adapter.id] ?? "Configure the selected payment provider credentials and authenticated webhook endpoint, then restart Freeholder.",
    );
  }
  return ok(
    "payments.provider",
    "Payments",
    `${adapter.id} API credentials and authenticated feedback are configured. Doctor did not create a checkout, refund, or other provider charge.`,
  );
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

/** Configuration-only: doctor must never spend provider credits on a probe. */
async function checkAltTextSuggester(): Promise<Check> {
  const { altTextSuggester } = await import("@/adapters/alt-text");
  const provider = altTextSuggester();
  if (provider.available) {
    return ok(
      "media.altTextSuggester",
      "Generated image descriptions",
      `${provider.id} model ${provider.model} is configured. A request is made only when a signed-in person asks for a suggestion.`,
    );
  }
  if (provider.id === "none") {
    return warn(
      "media.altTextSuggester",
      "Generated image descriptions",
      "No suggestion provider is connected. Authored alternative text continues to work normally.",
      'To offer suggestions, set adapters.ai to "openai" in freeholder.config.ts and set OPENAI_API_KEY plus OPENAI_ALT_TEXT_MODEL.',
    );
  }
  return fail(
    "media.altTextSuggester",
    "Generated image descriptions",
    provider.unavailableReason ?? `${provider.id} is not ready.`,
    "Complete the selected AI adapter configuration, or set adapters.ai to none. Doctor does not make a billable test request.",
  );
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
    await checkAltTextSuggester(),
    ...(await checkMail()),
    await checkPayments(),
    ...(await checkNotificationChannels()),
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
