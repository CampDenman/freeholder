// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor (MASTER.md §17, §18).
//
// §17 calls doctor "the contract that makes community recipes trustworthy",
// which sets the bar: a doctor that says green on a broken instance is worse
// than no doctor, because somebody trusted it. So the tests are mostly about
// whether it can go red — and about the difference between a check that
// *tried* something and one that read a setting back.
import { afterAll, describe, expect, it } from "vitest";
import { formatReport, runDoctor } from "@/core/doctor";
import { doctor } from "@/core/doctor/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
} from "../helpers/spine";

describe.runIf(hasDatabase)("what doctor checks", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("reports on every subsystem an instance can misconfigure", async () => {
    const report = await runDoctor();
    const ids = report.checks.map((check) => check.id);
    for (const id of [
      "env.sessionSecret",
      "env.appUrl",
      "db.connection",
      "db.migrations",
      "storage.roundTrip",
      "media.malwareScanner",
      "mail.delivers",
      "jobs.worker",
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

  it("says mail cannot deliver, because in this environment it cannot", async () => {
    // The console adapter is the default, and calling that healthy would be
    // the exact lie doctor exists to prevent: password resets go to a log.
    const report = await runDoctor();
    const mail = report.checks.find((c) => c.id === "mail.delivers");
    expect(mail?.verdict).toBe("warn");
    expect(mail?.remedy).toContain("MAIL_ADAPTER");
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
