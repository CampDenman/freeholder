// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Experiment impressions and honest reporting (C2.18).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  comparable,
  experimentReport,
  recordExperimentConversion,
  recordExperimentImpressions,
} from "@/modules/analytics/experiments";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("honest comparison", () => {
  it("refuses to compare below 30 unique visitors", () => {
    expect(comparable(29)).toBe(false);
    expect(comparable(30)).toBe(true);
  });
});

describe.runIf(hasDatabase)("experiment ledger", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("records one impression per visitor per day and attributes a conversion", async () => {
    const first = await recordExperimentImpressions.call(
      {
        anonId: "visitor-a",
        sessionId: "sess-a",
        path: "/",
        assignments: { hero: "treatment" },
      },
      { kind: "anonymous" },
    );
    expect(first.recorded).toBe(1);
    await recordExperimentImpressions.call(
      {
        anonId: "visitor-a",
        sessionId: "sess-a",
        path: "/",
        assignments: { hero: "treatment" },
      },
      { kind: "anonymous" },
    );

    const converted = await recordExperimentConversion.call(
      {
        anonId: "visitor-a",
        sessionId: "sess-a",
        kind: "quote",
        amountMinor: 0,
      },
      { kind: "anonymous" },
    );
    expect(converted.recorded).toBe(1);

    const report = await experimentReport.call({}, OWNER);
    const hero = report.find((row) => row.experimentKey === "hero");
    expect(hero?.comparable).toBe(false);
    expect(hero?.variants[0]?.uniqueVisitors).toBe(1);
    expect(hero?.variants[0]?.conversions).toBe(1);
    expect(hero?.variants[0]?.impressions).toBe(1);
  });
});
