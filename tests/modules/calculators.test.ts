// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.26: arithmetic over figures somebody published, and when it declines.
//
// The refusals carry the feature. A monthly payment computed from a rate that
// stopped being true in March looks exactly like one computed from today's,
// and the person reading it cannot tell the difference — so the only honest
// thing the page can do is not do the sum.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ready } from "@/core/runtime";
import { recordFact } from "@/core/attestations/service";
import { translator } from "@/core/i18n";
import { calculator as calculatorBlock } from "@/modules/cms/blocks/surfaces";
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

/**
 * The vocabulary audit, and why it is a grep rather than a review.
 *
 * "No result is presented as a quote, an approval or a guarantee" is a claim
 * about every string a calculator surface renders, in four languages, forever
 * — and a claim that wide is only kept by a gate. Owner-authored content
 * (the calculator's name, its questions, the assumptions text) is the owner's
 * speech and is not the product's; the seeded demo calculators use that
 * freedom the way an honest owner would, and say in their own words that a
 * figure is a planning number, not a quote. What the *product* says around
 * that content is these catalog keys, so that is what the audit scans, like
 * the assessment audit beside it (C8.14): every key a calculator surface can
 * reach, in all four locales, against the forbidden vocabulary in each
 * language. Stems rather than whole words, so no inflection slips past.
 */
describe("the words no calculator surface may say", () => {
  const LOCALES = ["en", "fr", "es", "ar"] as const;

  // One stem-set per language: a price quote, an approval, a guarantee.
  // Arabic is matched on its own words because Arabic plurals and
  // agglutination defeat any Latin-derived stem list.
  const FORBIDDEN =
    /quote|devis|presupuesto|cotizaci|appr[ou]+v|garante|garanti|ضمان|موافق|اعتماد|تسعير|عرض\s?سعر/i;

  for (const locale of LOCALES) {
    it(`keeps the forbidden vocabulary out of every ${locale} calculator string`, () => {
      const catalogue = JSON.parse(
        readFileSync(`locales/${locale}.json`, "utf8"),
      ) as Record<string, string>;
      // Every key a calculator surface can render: the module's admin
      // namespace, the public block strings, and the block palette label.
      const calculatorKeys = Object.keys(catalogue).filter(
        (key) =>
          key.startsWith("calculators.") ||
          key.startsWith("cms.calculator.") ||
          key === "cms.block.calculator",
      );
      // The audit means nothing if a refactor moves the strings to keys this
      // filter no longer reaches, so the set being scanned is asserted too.
      expect(calculatorKeys.length).toBeGreaterThanOrEqual(65);

      const offenders = calculatorKeys.filter((key) =>
        FORBIDDEN.test(catalogue[key] ?? ""),
      );
      expect(
        offenders.map((key) => `${key}: ${catalogue[key]}`),
      ).toEqual([]);
    });
  }
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
    // The refusal is also data — a stable code and the key at fault — so a
    // render surface can say it in the visitor's own language.
    expect(result.refusalCode).toBe("fact_stale");
    expect(result.refusalKey).toBe(RATE_KEY);
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
    expect(tooSmall.refusalCode).toBe("input_below_min");
    expect(tooSmall.refusalKey).toBe("amount");

    const missing = await compute.call(
      { slug: "monthly-interest", answers: {} },
      ANONYMOUS,
    );
    expect(missing.ok).toBe(false);
    expect(missing.refusal).toContain("is needed");
    expect(missing.refusalCode).toBe("input_required");
    expect(missing.refusalKey).toBe("amount");
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

  /**
   * Render the block the way a page render does — resolve, then render — in
   * every locale the catalog speaks. This is the surface a visitor actually
   * meets, so the locale evidence belongs here rather than only at the
   * service edge: the figure, the assumptions, and every published input's
   * key, value, source and as-of have to read correctly in all four locales,
   * and the refusal a stale figure produces has to read in the visitor's own
   * words, never the service's English.
   */
  const LOCALES = ["en", "fr", "es", "ar"] as const;
  const AS_OF = new Date("2026-09-12T09:00:00.000Z");

  function renderIn(
    locale: (typeof LOCALES)[number],
    query: Record<string, string>,
  ) {
    const ctx = {
      locale,
      t: translator(locale),
      business: null,
      path: "/tools",
      query,
    };
    return (async () => {
      const resolved = await calculatorBlock.resolve!(
        { calculatorSlug: "monthly-interest" },
        ctx,
      );
      return renderToStaticMarkup(
        createElement(
          "div",
          null,
          calculatorBlock.render({
            props: { calculatorSlug: "monthly-interest" },
            ctx,
            resolved,
          }),
        ),
      );
    })();
  }

  it("renders the figure with its assumptions and dates in all four locales", async () => {
    await rate(6);
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);

    for (const locale of LOCALES) {
      const t = translator(locale);
      const dateLabel = new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(AS_OF);
      const figure = (2_000).toLocaleString(locale, { maximumFractionDigits: 2 });

      const markup = await renderIn(locale, {
        calc: "monthly-interest",
        c_amount: "400000",
      });

      // The figure and the owner's assumptions, beside each other.
      expect(markup).toContain(figure);
      expect(markup).toContain(
        "Interest only, before fees and insurance. Not a quote and not an offer of credit.",
      );
      // Every published input it rested on: key, value, source, as-of.
      expect(markup).toContain(t("cms.calculator.restsOn"));
      expect(markup).toContain(
        t("cms.calculator.assumption", {
          key: RATE_KEY,
          value: 6,
          source: "Lender rate sheet",
          date: dateLabel,
        }),
      );
      // And the as-of of the oldest of them.
      expect(markup).toContain(
        t("cms.calculator.basedOn", { count: 1, date: dateLabel }),
      );
      // The machine-readable date rides along for crawlers and screen readers.
      expect(markup).toContain("2026-09-12T09:00:00.000Z");
    }
  });

  it("refuses in the visitor's own words when a figure is past its date", async () => {
    await rate(6, {
      asOf: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-02-01T00:00:00.000Z"),
    });
    const made = await calculator();
    await publishCalculator.call({ id: made.id }, OWNER);

    for (const locale of LOCALES) {
      const t = translator(locale);
      const markup = await renderIn(locale, {
        calc: "monthly-interest",
        c_amount: "400000",
      });

      // A refusal, localized, naming the figure at fault — and no figure
      // anywhere: not the fresh number, not the stale one.
      expect(markup).toContain(
        t("cms.calculator.refusal.factStale", { key: RATE_KEY }),
      );
      expect(markup).toContain(RATE_KEY);
      expect(markup).not.toContain("Interest each month");
      if (locale !== "en") {
        // The service's own English sentence never leaks into another
        // language's page. (English says the same words through its own
        // catalog, so the check is meaningless there.)
        expect(markup).not.toContain("past the date it was good for");
      }
    }
  });
});
