// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.14: the assessment engine, and the things it must refuse.
//
// Most of these tests assert a refusal, which is the point of the feature. An
// assessment that answers every question is easy; one that cannot be made to
// say something its owner did not write is the product.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import {
  closeAssessment,
  createAssessment,
  deleteBand,
  getAssessment,
  listAssessments,
  listResponses,
  publishAssessment,
  respond,
  saveBand,
  saveEscalation,
  updateAssessment,
} from "@/modules/assessments/service";
import { reachableScoreRange } from "@/modules/assessments/questions";
import { coverageGaps, scoreAnswers } from "@/modules/assessments/scoring";
import {
  ANONYMOUS,
  CUSTOMER,
  OWNER,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

/** A boiler triage: the shape every trade edition asks for. */
const QUESTIONS = [
  {
    key: "symptom",
    label: "What is happening?",
    kind: "single" as const,
    required: true,
    options: [
      { key: "no_heat", label: "No heat", score: 2 },
      { key: "noise", label: "An unusual noise", score: 1 },
      { key: "gas_smell", label: "I can smell gas", score: 5 },
    ],
  },
  {
    key: "age",
    label: "Roughly how old is the system?",
    kind: "single" as const,
    required: true,
    options: [
      { key: "new", label: "Under five years", score: 0 },
      { key: "old", label: "Over fifteen years", score: 2 },
    ],
  },
];

describe("scoring, without a database", () => {
  it("reports the range a question set can reach", () => {
    // Lowest reachable is 1, not 0: the cheapest symptom still scores.
    expect(reachableScoreRange(QUESTIONS)).toEqual({ min: 1, max: 7 });
  });

  it("finds the gap a band set leaves", () => {
    const bands = [{ minScore: 0, maxScore: 2 }, { minScore: 6, maxScore: 7 }];
    expect(coverageGaps(bands, { min: 1, max: 7 })).toEqual([{ from: 3, to: 5 }]);
  });

  it("adds up only the options the owner scored", () => {
    expect(scoreAnswers(QUESTIONS, { symptom: "no_heat", age: "old" })).toBe(4);
    // An option key nobody authored contributes nothing rather than guessing.
    expect(scoreAnswers(QUESTIONS, { symptom: "invented", age: "new" })).toBe(0);
  });
});

describe.runIf(hasDatabase)("assessments", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  async function draft() {
    return createAssessment.call(
      { slug: "boiler-check", name: "Boiler check", questions: QUESTIONS },
      OWNER,
    );
  }

  async function coveredBands(assessmentId: string) {
    await saveBand.call(
      {
        assessmentId,
        key: "routine",
        label: "Routine",
        body: "Book a routine visit.",
        minScore: 0,
        maxScore: 3,
      },
      OWNER,
    );
    await saveBand.call(
      {
        assessmentId,
        key: "urgent",
        label: "Urgent",
        body: "Call us today.",
        minScore: 4,
        maxScore: 7,
      },
      OWNER,
    );
  }

  it("refuses to publish while a reachable score has no authored outcome", async () => {
    const made = await draft();
    await saveBand.call(
      {
        assessmentId: made.id,
        key: "routine",
        label: "Routine",
        body: "Book a routine visit.",
        minScore: 0,
        maxScore: 3,
      },
      OWNER,
    );
    const error = await failure(publishAssessment.call({ id: made.id }, OWNER));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("4 to 7");
  });

  it("refuses to publish with no bands at all", async () => {
    const made = await draft();
    const error = await failure(publishAssessment.call({ id: made.id }, OWNER));
    expect(error.code).toBe("validation");
  });

  it("refuses two bands that cover the same score", async () => {
    const made = await draft();
    await coveredBands(made.id);
    const error = await failure(
      saveBand.call(
        {
          assessmentId: made.id,
          key: "middle",
          label: "Middle",
          body: "Overlaps on purpose.",
          minScore: 3,
          maxScore: 5,
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("overlap");
  });

  it("returns the outcome the owner wrote, and nothing else", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);

    const outcome = await respond.call(
      { slug: "boiler-check", answers: { symptom: "no_heat", age: "old" } },
      ANONYMOUS,
    );
    expect(outcome.score).toBe(4);
    expect(outcome.band.key).toBe("urgent");
    // The exact words from the row, not a paraphrase of them.
    expect(outcome.band.body).toBe("Call us today.");
    expect(outcome.escalation).toBeNull();
  });

  it("lets one answer outrank the score", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await saveEscalation.call(
      {
        assessmentId: made.id,
        questionKey: "symptom",
        optionKey: "gas_smell",
        instruction: "Leave the building and call the gas emergency line.",
      },
      OWNER,
    );
    await publishAssessment.call({ id: made.id }, OWNER);

    const outcome = await respond.call(
      { slug: "boiler-check", answers: { symptom: "gas_smell", age: "new" } },
      ANONYMOUS,
    );
    expect(outcome.escalation?.instruction).toBe(
      "Leave the building and call the gas emergency line.",
    );
    // The band still comes back: the escalation is shown above it, not instead
    // of it, and the owner's queue still needs the score.
    expect(outcome.band.key).toBe("urgent");
  });

  it("refuses an escalation on an answer that does not exist", async () => {
    const made = await draft();
    const error = await failure(
      saveEscalation.call(
        {
          assessmentId: made.id,
          questionKey: "symptom",
          optionKey: "flooding",
          instruction: "Never reachable.",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses an answer nobody authored", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const error = await failure(
      respond.call(
        { slug: "boiler-check", answers: { symptom: "explosion", age: "new" } },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses a response to an assessment that is not open", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    await closeAssessment.call({ id: made.id }, OWNER);
    const error = await failure(
      respond.call(
        { slug: "boiler-check", answers: { symptom: "no_heat", age: "new" } },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps an outcome somebody was already shown", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    await respond.call(
      { slug: "boiler-check", answers: { symptom: "no_heat", age: "old" } },
      ANONYMOUS,
    );
    const detail = await getAssessment.call({ id: made.id }, OWNER);
    const urgent = detail.bands.find((band) => band.key === "urgent")!;
    const error = await failure(
      deleteBand.call({ assessmentId: made.id, id: urgent.id }, OWNER),
    );
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("already been shown");
  });

  it("refuses to re-word questions into a gap while live", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const error = await failure(
      updateAssessment.call(
        {
          id: made.id,
          questions: [
            {
              ...QUESTIONS[0]!,
              options: [
                { key: "no_heat", label: "No heat", score: 40 },
                { key: "noise", label: "An unusual noise", score: 1 },
                { key: "gas_smell", label: "I can smell gas", score: 5 },
              ],
            },
          ],
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps the authoring surface behind a grant", async () => {
    const made = await draft();
    // A customer is signed in and has no assessments grant: reading the
    // definitions would show them the score of every answer, which is the
    // whole judgement the owner authored.
    expect((await failure(listAssessments.call({}, CUSTOMER))).code).toBe("permission");
    expect((await failure(getAssessment.call({ id: made.id }, CUSTOMER))).code).toBe(
      "permission",
    );
    expect(
      (
        await failure(
          saveBand.call(
            {
              assessmentId: made.id,
              key: "x",
              label: "X",
              body: "Not theirs to write.",
              minScore: 0,
              maxScore: 9,
            },
            CUSTOMER,
          ),
        )
      ).code,
    ).toBe("permission");
    expect((await failure(publishAssessment.call({ id: made.id }, ANONYMOUS))).code).toBe(
      "permission",
    );
  });

  it("resolves a repeated post to the answer already stored", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const answers = { symptom: "no_heat", age: "old" };

    const first = await respond.call(
      { slug: "boiler-check", answers, idempotencyKey: "nonce-1" },
      ANONYMOUS,
    );
    const second = await respond.call(
      { slug: "boiler-check", answers, idempotencyKey: "nonce-1" },
      ANONYMOUS,
    );

    expect(second.responseId).toBe(first.responseId);
    expect(first.repeat).toBe(false);
    expect(second.repeat).toBe(true);
    expect(second.band.body).toBe(first.band.body);
    const rows = await listResponses.call({ assessmentId: made.id }, OWNER);
    expect(rows).toHaveLength(1);
  });

  it("stores one answer when the same post arrives twice at once", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const answers = { symptom: "noise", age: "new" };

    const both = await Promise.all([
      respond.call({ slug: "boiler-check", answers, idempotencyKey: "race" }, ANONYMOUS),
      respond.call({ slug: "boiler-check", answers, idempotencyKey: "race" }, ANONYMOUS),
    ]);

    // Whoever lost the unique index reads the winner's answer rather than
    // failing in front of somebody who did nothing wrong.
    expect(both[0].responseId).toBe(both[1].responseId);
    const rows = await listResponses.call({ assessmentId: made.id }, OWNER);
    expect(rows).toHaveLength(1);
  });

  it("keeps separate answers apart when the keys differ", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const answers = { symptom: "no_heat", age: "old" };
    await respond.call({ slug: "boiler-check", answers, idempotencyKey: "a" }, ANONYMOUS);
    await respond.call({ slug: "boiler-check", answers, idempotencyKey: "b" }, ANONYMOUS);
    const rows = await listResponses.call({ assessmentId: made.id }, OWNER);
    expect(rows).toHaveLength(2);
  });

  it("puts a respondent who gave an address on the contact spine", async () => {
    const made = await draft();
    await coveredBands(made.id);
    await publishAssessment.call({ id: made.id }, OWNER);
    const outcome = await respond.call(
      {
        slug: "boiler-check",
        answers: { symptom: "noise", age: "new" },
        respondent: { email: "someone@example.test", name: "Sam Rowe" },
      },
      ANONYMOUS,
    );
    expect(outcome.band.key).toBe("routine");

    const rows = await listResponses.call({ assessmentId: made.id }, OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).not.toBeNull();
    expect(rows[0]!.bandLabel).toBe("Routine");
    expect(rows[0]!.escalated).toBe(false);
  });
});
