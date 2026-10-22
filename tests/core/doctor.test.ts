// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Doctor (MASTER.md §17, §18).
//
// §17 calls doctor "the contract that makes community recipes trustworthy",
// which sets the bar: a doctor that says green on a broken instance is worse
// than no doctor, because somebody trusted it. So the tests are mostly about
// whether it can go red — and about the difference between a check that
// *tried* something and one that read a setting back.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { formatReport, runDoctor } from "@/core/doctor";
import { doctor } from "@/core/doctor/service";
import { checkTimezoneData, probeInstants, type ZoneProbe } from "@/core/doctor/timezone";
import { db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { resetEnvForTests } from "@/core/env";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("what doctor checks", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("reports on every subsystem an instance can misconfigure", async () => {
    const report = await runDoctor();
    const ids = report.checks.map((check) => check.id);
    const preflight = report.checks.find((check) => check.id === "update.preflight");
    expect(preflight?.verdict).toBe("warn");
    expect(preflight?.detail).toContain("No signed candidate");
    const policy = report.checks.find((check) => check.id === "update.policy");
    expect(policy?.verdict).toBe("warn");
    expect(policy?.detail).toContain("Automatic updates and rollback are unavailable");
    for (const id of [
      "env.sessionSecret",
      "env.appUrl",
      "db.connection",
      "db.migrations",
      "storage.roundTrip",
      "media.malwareScanner",
      "media.altTextSuggester",
      "mail.delivers",
      "mail.bulk",
      "payments.provider",
      "notifications.sms",
      "notifications.push",
      "jobs.worker",
      "update.seams.configuration",
      "update.seams.uploads",
      "update.coreFiles",
      "update.release",
      "update.channel",
      "update.feed.key",
      "update.check",
      "update.preflight",
      "update.n1",
      "update.policy",
      "platform.version",
    ]) {
      expect({ id, checked: ids.includes(id) }).toEqual({ id, checked: true });
    }
  });

  it("actually writes a file rather than reading a setting", async () => {
    // The distinction the whole design rests on. Credentials that parse and a
    // bucket that refuses writes look identical until an owner uploads a
    // photograph — so this check either round-trips an object or fails.
    const report = await runDoctor();
    const storage = report.checks.find((c) => c.id === "storage.roundTrip");
    expect(storage?.verdict).toBe("ok");
    expect(storage?.detail).toMatch(/Wrote, read and deleted/);
  });

  it("knows the schema is up to date", async () => {
    const report = await runDoctor();
    const schema = report.checks.find((c) => c.id === "db.migrations");
    expect(schema?.verdict).toBe("ok");
    expect(schema?.detail).toMatch(/migrations have been applied/);
  });

  it("reports the real platform version rather than 0.0.0", async () => {
    const report = await runDoctor();
    const version = report.checks.find((c) => c.id === "platform.version");
    expect(version?.verdict).toBe("ok");
    expect(version?.detail).not.toMatch(/0\.0\.0/);
    expect(version?.detail).toMatch(/\d+\.\d+\.\d+/);
  });

  it("says mail cannot deliver, because in this environment it cannot", async () => {
    // The console adapter is the default, and calling that healthy would be
    // the exact lie doctor exists to prevent: password resets go to a log.
    const report = await runDoctor();
    const mail = report.checks.find((c) => c.id === "mail.delivers");
    expect(mail?.verdict).toBe("warn");
    expect(mail?.remedy).toContain("MAIL_ADAPTER");
  });

  it("gives SES the exact authenticated feedback URL and SHA-256 remedy without sending", async () => {
    const names = [
      "MAIL_BULK_ADAPTER",
      "MAIL_BULK_FROM",
      "SES_ACCESS_KEY_ID",
      "SES_SECRET_ACCESS_KEY",
      "SES_REGION",
      "SES_CONFIGURATION_SET",
      "SES_SNS_TOPIC_ARN",
    ] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    process.env.MAIL_BULK_ADAPTER = "ses";
    process.env.MAIL_BULK_FROM = "news@example.test";
    process.env.SES_ACCESS_KEY_ID = "test-access";
    process.env.SES_SECRET_ACCESS_KEY = "test-secret";
    process.env.SES_REGION = "us-east-1";
    delete process.env.SES_CONFIGURATION_SET;
    delete process.env.SES_SNS_TOPIC_ARN;
    resetEnvForTests();
    try {
      const report = await runDoctor();
      const feedback = report.checks.find((check) => check.id === "mail.feedback");
      expect(feedback).toMatchObject({ verdict: "fail" });
      expect(feedback?.detail).not.toContain("test-secret");
      expect(feedback?.remedy).toContain("SES_CONFIGURATION_SET");
      expect(feedback?.remedy).toContain("SES_SNS_TOPIC_ARN");
      expect(feedback?.remedy).toContain("/api/mail/webhooks/ses");
      expect(feedback?.remedy).toContain("SignatureVersion 2");
      expect(feedback?.remedy).toContain("SHA-1");
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetEnvForTests();
    }
  });

  it("gives every problem a sentence that fixes it", async () => {
    // A check that reports "storage misconfigured" has told an owner what they
    // already knew.
    const report = await runDoctor();
    for (const check of report.checks) {
      if (check.verdict === "ok") continue;
      expect({ id: check.id, hasRemedy: Boolean(check.remedy?.length) }).toEqual({
        id: check.id,
        hasRemedy: true,
      });
    }
  });

  it("takes the worst verdict as the overall one", async () => {
    const report = await runDoctor();
    const worst = report.checks.some((c) => c.verdict === "fail")
      ? "fail"
      : report.checks.some((c) => c.verdict === "warn")
        ? "warn"
        : "ok";
    expect(report.verdict).toBe(worst);
  });

  it("warns, without failing, when Postgres reads the business's zone differently", async () => {
    // "+05:00" is five hours ahead to Node and five behind to Postgres (POSIX
    // sign convention) — a real disagreement between the two zone sources.
    await db().insert(businessProfile).values({
      name: "Zone Studio",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "+05:00",
    });
    const check = (await runDoctor()).checks.find((each) => each.id === "time.zoneData");
    expect(check).toMatchObject({
      verdict: "warn",
      message: {
        key: "doctor.timeZone.disagree",
        params: { zone: "+05:00", nodeOffset: "UTC+05:00", postgresOffset: "UTC-05:00" },
      },
    });
    expect(check!.detail).toContain(String(process.versions.tz));
    expect(check!.remedy).toBeTruthy();
  });

  it("agrees with Postgres on a named zone both copies know", async () => {
    // Tokyo has kept one offset since 1951, so any two tz data versions agree.
    await db().insert(businessProfile).values({
      name: "Zone Studio",
      country: "JP",
      baseCurrency: "JPY",
      timezone: "Asia/Tokyo",
    });
    const check = (await runDoctor()).checks.find((each) => each.id === "time.zoneData");
    expect(check).toMatchObject({ verdict: "ok", message: { key: "doctor.timeZone.agree" } });
  });
});

describe("comparing the two copies of the tz database", () => {
  const NOW = new Date("2026-01-15T12:00:00Z");
  const probe = (offsets: (instants: Date[]) => number[]): ZoneProbe => ({
    offsets: async (instants) => offsets(instants),
    version: async () => "16.4",
  });

  it("asks about now, six months either side, and either side of the next change", () => {
    const instants = probeInstants(NOW, "Europe/London").map((each) => each.toISOString());
    expect(instants).toEqual([
      "2026-01-15T12:00:00.000Z",
      "2025-07-17T12:00:00.000Z",
      "2026-07-16T12:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T02:00:00.000Z",
    ]);
    // A zone that never changes has no change to straddle.
    expect(probeInstants(NOW, "Asia/Tokyo")).toHaveLength(3);
  });

  it("is ok when every probe agrees", async () => {
    const check = await checkTimezoneData(
      "Europe/London",
      // GMT in winter, BST from 01:00 UTC on 29 March: what Node says too.
      probe((instants) =>
        instants.map((each) => {
          const summer2025 = each >= new Date("2025-03-30T01:00:00Z") && each < new Date("2025-10-26T01:00:00Z");
          const summer2026 = each >= new Date("2026-03-29T01:00:00Z") && each < new Date("2026-10-25T01:00:00Z");
          return summer2025 || summer2026 ? 60 : 0;
        }),
      ),
      NOW,
      "2026a",
    );
    expect(check.verdict).toBe("ok");
  });

  it("names both versions and the first instant they disagree on", async () => {
    // The CI finding: Postgres had America/Vancouver on UTC-07:00 in December
    // while Node's 2026a said UTC-08:00.
    const check = await checkTimezoneData(
      "America/Vancouver",
      probe((instants) => instants.map(() => -420)),
      new Date("2026-12-09T23:30:00Z"),
      "2026a",
    );
    expect(check.verdict).toBe("warn");
    expect(check.detail).toContain("2026a");
    expect(check.detail).toContain("Postgres 16.4");
    expect(check.message).toEqual({
      key: "doctor.timeZone.disagree",
      params: {
        zone: "America/Vancouver",
        at: "2026-12-09T23:30:00.000Z",
        nodeOffset: "UTC-08:00",
        postgresOffset: "UTC-07:00",
        node: "2026a",
        postgres: "16.4",
      },
    });
  });

  it("warns, rather than failing, when Postgres does not know the zone", async () => {
    const check = await checkTimezoneData(
      "America/Vancouver",
      { offsets: async () => { throw new Error("time zone not recognized"); }, version: async () => "16.4" },
      NOW,
    );
    expect(check).toMatchObject({ verdict: "warn", message: { key: "doctor.timeZone.unreadable" } });
    expect(check.remedy).toBeTruthy();
  });
});

describe("the report as somebody reads it", () => {
  it("puts the remedy under the problem, not in a footnote", () => {
    const text = formatReport({
      verdict: "fail",
      ranAt: new Date(0).toISOString(),
      checks: [
        { id: "a", title: "Database", verdict: "ok", detail: "Connected." },
        {
          id: "b",
          title: "File storage",
          verdict: "fail",
          detail: "Could not store a file.",
          remedy: "Check the S3_* variables.",
        },
      ],
    });
    expect(text).toContain("  ok   Database: Connected.");
    expect(text).toContain(" FAIL  File storage: Could not store a file.");
    expect(text).toContain("→ Check the S3_* variables.");
    expect(text).toContain("Something is broken");
  });

  it("says plainly when there is nothing to do", () => {
    const text = formatReport({
      verdict: "ok",
      ranAt: new Date(0).toISOString(),
      checks: [{ id: "a", title: "Database", verdict: "ok", detail: "Connected." }],
    });
    expect(text).toContain("Everything doctor can check is working.");
  });
});

describe.runIf(hasDatabase)("who may ask", () => {
  it("requires platform view because the report is a map of what is weak", async () => {
    // Which adapters are configured and how each is failing is precisely the
    // reconnaissance somebody probing an instance would like. /api/health
    // stays public and stays shallow.
    expect((await failure(doctor.call({}, ANONYMOUS))).code).toBe("permission");
    expect(
      (await failure(doctor.call({}, { ...STAFF, grants: [] }))).code,
    ).toBe("permission");
    await expect(
      doctor.call(
        {},
        {
          ...STAFF,
          grants: [{ module: "platform", access: "view" }],
        },
      ),
    ).resolves.toHaveProperty("verdict");
    await expect(doctor.call({}, OWNER)).resolves.toHaveProperty("verdict");
  });
});
