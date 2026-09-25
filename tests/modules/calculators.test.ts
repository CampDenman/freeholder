// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.26: arithmetic over figures somebody published, and when it declines.
//
// The refusals carry the feature. A monthly payment computed from a rate that
// stopped being true in March looks exactly like one computed from today's,
// and the person reading it cannot tell the difference — so the only honest
// thing the page can do is not do the sum.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { recordFact } from "@/core/attestations/service";
import {
  compute,
  createCalculator,
  publishCalculator,
} from "@/modules/calculators/service";
import { configurationProblems, evaluate } from "@/modules/calculators/formula";
import {
  ANONYMOUS,
  OWNER,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const RATE_KEY = "rate.30-year-fixed";

/** Borrow × rate ÷ 12: a monthly interest figure, roughly. */
const STEPS = [
  {
    key: "yearly",
    label: "Interest for a year",
    op: "percentOf" as const,
    first: { kind: "input" as const, key: "amount" },
    second: { kind: "fact" as const, factKey: RATE_KEY },
  },
  {
    key: "monthly",
    label: "Interest for a month",
    op: "divide" as const,
    first: { kind: "step" as const, key: "yearly" },
    second: { kind: "literal" as const, value: 12 },
  },
];

const INPUTS = [
  { key: "amount", label: "How much are you borrowing?", min: 1000, max: 2_000_000 },
];

describe("the calculation, without a database", () => {
  it("refuses a step that uses an answer nobody is asked for", () => {
    const problems = configurationProblems([], STEPS);
    expect(problems.join(" ")).toContain("nobody is asked for");
  });

  it("refuses a step that uses a later step", () => {
    const problems = configurationProblems(INPUTS, [
      {
        key: "first",
        label: "First",
        op: "add" as const,
        first: { kind: "step" as const, key: "second" },
        second: { kind: "literal" as const, value: 1 },
      },
      {
        key: "second",
        label: "Second",
        op: "add" as const,
        first: { kind: "literal" as const, value: 1 },
        second: { kind: "literal" as const, value: 1 },
      },
    ]);
    expect(problems.join(" ")).toContain("has not run yet");
  });

  it("declines to divide by zero rather than answering Infinity", () => {
    const result = evaluate(
      [
        {
          key: "x",
          label: "Per person",
          op: "divide" as const,
          first: { kind: "literal" as const, value: 100 },
          second: { kind: "input" as const, key: "people" },
        },
      ],
      { inputs: { people: 0 }, facts: {} },
    );
    expect(result.ok).toBe(false);
  });
});

describe.runIf(hasDatabase)("calculators", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  async function rate(value: number, extra: Record<string, unknown> = {}) {
    return recordFact.call(
      {
        key: RATE_KEY,
        value,
        source: "Lender rate sheet",
        asOf: new Date("2026-09-12T09:00:00.000Z"),
        ...extra,
      },
      OWNER,
    );
  }

  async function calculator() {
    return createCalculator.call(
      {
        slug: "monthly-interest",
        name: "Monthly interest",
        inputs: INPUTS,
        steps: STEPS,
        resultLabel: "Interest each month",
        resultUnit: "$",
        assumptions:
          "Interest only, before fees and insurance. Not a quote and not an offer of credit.",
      },
      OWNER,
    );
  }

  it("works the figure out, and says what it rested on", async () => {
    await rate(6);
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);

    const result = await compute.call(
      { slug: "monthly-interest", answers: { amount: 400_000 } },
      ANONYMOUS,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(2000, 6);
    // Every published figure it used, with where it came from and when.
    expect(result.basedOn).toHaveLength(1);
    expect(result.basedOn[0]!.source).toBe("Lender rate sheet");
    expect(result.oldestAsOf?.toISOString()).toBe("2026-09-12T09:00:00.000Z");
    // The caveats travel with the answer, always.
    expect(result.assumptions).toContain("Not a quote");
  });

  it("will not publish a calculator whose figures nobody has published", async () => {
    const made = await calculator();
    const error = await failure(publishCalculator.call({ id: made.id }, OWNER));
    expect(error.code).toBe("validation");
    expect(error.message).toContain(RATE_KEY);
  });

  it("declines to calculate from a figure that is past its date", async () => {
    await rate(6, {
      asOf: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-02-01T00:00:00.000Z"),
    });
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);

    const result = await compute.call(
      { slug: "monthly-interest", answers: { amount: 400_000 } },
      ANONYMOUS,
    );
    // Not a smaller number, not last month's number. No number.
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.refusal).toContain("past the date it was good for");
    expect(result.refusal).toContain(RATE_KEY);
  });

  it("holds the visitor to the bounds the owner set", async () => {
    await rate(6);
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);

    const tooSmall = await compute.call(
      { slug: "monthly-interest", answers: { amount: 10 } },
      ANONYMOUS,
    );
    expect(tooSmall.ok).toBe(false);
    expect(tooSmall.refusal).toContain("cannot be below 1000");

    const missing = await compute.call(
      { slug: "monthly-interest", answers: {} },
      ANONYMOUS,
    );
    expect(missing.ok).toBe(false);
    expect(missing.refusal).toContain("is needed");
  });

  it("refuses a calculation an owner has not finished configuring", async () => {
    const error = await failure(
      createCalculator.call(
        {
          slug: "broken",
          name: "Broken",
          inputs: [],
          steps: STEPS,
          resultLabel: "Something",
          assumptions: "None.",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("nobody is asked for");
  });

  it("stops answering once it is closed", async () => {
    await rate(6);
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);
    const { closeCalculator } = await import("@/modules/calculators/service");
    await closeCalculator.call({ id: made.id }, OWNER);
    const error = await failure(
      compute.call({ slug: "monthly-interest", answers: { amount: 400_000 } }, ANONYMOUS),
    );
    expect(error.code).toBe("validation");
  });
});
