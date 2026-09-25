// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.15: owner-supplied facts, and the corrections that never erase them.
//
// The assertion that matters most is the smallest one here: asking for a fact
// nobody stated returns null. Every other guarantee in §4.18 rests on there
// being no code path that invents, interpolates or falls back.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import {
  correctFact,
  currentFact,
  factHistory,
  listFacts,
  recordFact,
  withdrawFact,
} from "@/core/attestations/service";
import {
  ANONYMOUS,
  CUSTOMER,
  OWNER,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const SEPTEMBER = new Date("2026-09-12T09:00:00.000Z");
const LATER = new Date("2026-09-19T09:00:00.000Z");

describe.runIf(hasDatabase)("attestations", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  async function rate(value: string, asOf = SEPTEMBER) {
    return recordFact.call(
      {
        key: "rate.30-year-fixed",
        value,
        source: "Lender rate sheet",
        asOf,
      },
      OWNER,
    );
  }

  it("says nothing about a fact nobody stated", async () => {
    const found = await currentFact.call({ key: "rate.30-year-fixed" }, ANONYMOUS);
    expect(found).toBeNull();
  });

  it("carries the source and the moment it was true", async () => {
    await rate("6.5%");
    const found = await currentFact.call({ key: "rate.30-year-fixed" }, ANONYMOUS);
    expect(found?.value).toBe("6.5%");
    expect(found?.source).toBe("Lender rate sheet");
    expect(found?.asOf.toISOString()).toBe(SEPTEMBER.toISOString());
    expect(found?.stale).toBe(false);
  });

  it("refuses a second current value, and says to correct instead", async () => {
    await rate("6.5%");
    const error = await failure(rate("6.9%"));
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("Correct it instead");
  });

  it("corrects without erasing: the old value stays readable, with its dates", async () => {
    await rate("6.5%");
    await correctFact.call(
      {
        key: "rate.30-year-fixed",
        value: "6.9%",
        source: "Lender rate sheet, 19 September",
        asOf: LATER,
        note: "Weekly rate update.",
      },
      OWNER,
    );

    const found = await currentFact.call({ key: "rate.30-year-fixed" }, ANONYMOUS);
    expect(found?.value).toBe("6.9%");

    const ledger = await factHistory.call({ key: "rate.30-year-fixed" }, ANONYMOUS);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.value).toBe("6.5%");
    expect(ledger[0]!.source).toBe("Lender rate sheet");
    expect(ledger[0]!.asOf.toISOString()).toBe(SEPTEMBER.toISOString());
    expect(ledger[0]!.supersededAt).not.toBeNull();
    expect(ledger[1]!.correctionNote).toBe("Weekly rate update.");
  });

  it("refuses a correction older than what it replaces", async () => {
    await rate("6.5%", LATER);
    const error = await failure(
      correctFact.call(
        {
          key: "rate.30-year-fixed",
          value: "6.1%",
          source: "An older sheet",
          asOf: SEPTEMBER,
          note: "Backwards.",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("older than the value it replaces");
  });

  it("refuses to correct a fact that was never stated", async () => {
    const error = await failure(
      correctFact.call(
        {
          key: "rate.30-year-fixed",
          value: "6.9%",
          source: "Somewhere",
          asOf: LATER,
          note: "No original.",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("not_found");
  });

  it("marks a fact stale once it outlives its validity, rather than hiding it", async () => {
    await recordFact.call(
      {
        key: "status.service",
        value: "Open until 5pm",
        source: "Front desk",
        asOf: new Date("2026-09-01T09:00:00.000Z"),
        validUntil: new Date("2026-09-01T17:00:00.000Z"),
      },
      OWNER,
    );
    const found = await currentFact.call({ key: "status.service" }, ANONYMOUS);
    // Still returned: "we last knew this on Tuesday" is honest, silence is not.
    expect(found?.value).toBe("Open until 5pm");
    expect(found?.stale).toBe(true);
  });

  it("refuses a validity window that closes before the fact was true", async () => {
    const error = await failure(
      recordFact.call(
        {
          key: "rate.30-year-fixed",
          value: "6.5%",
          source: "Sheet",
          asOf: LATER,
          validUntil: SEPTEMBER,
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("withdraws without deleting: gone from the page, still in the ledger", async () => {
    const made = await rate("6.5%");
    await withdrawFact.call({ id: made.id, reason: "Published in error." }, OWNER);
    expect(await currentFact.call({ key: "rate.30-year-fixed" }, ANONYMOUS)).toBeNull();
    const ledger = await factHistory.call({ key: "rate.30-year-fixed" }, ANONYMOUS);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.withdrawnAt).not.toBeNull();
  });

  it("keeps facts about different subjects apart", async () => {
    await recordFact.call(
      {
        key: "status.service",
        subject: { kind: "location", id: "portland" },
        value: "Open",
        source: "Front desk",
        asOf: SEPTEMBER,
      },
      OWNER,
    );
    await recordFact.call(
      {
        key: "status.service",
        subject: { kind: "location", id: "seattle" },
        value: "Closed",
        source: "Front desk",
        asOf: SEPTEMBER,
      },
      OWNER,
    );
    const portland = await currentFact.call(
      { key: "status.service", subject: { kind: "location", id: "portland" } },
      ANONYMOUS,
    );
    expect(portland?.value).toBe("Open");
    // And the business-wide fact is a different fact again, not a fallback.
    expect(await currentFact.call({ key: "status.service" }, ANONYMOUS)).toBeNull();
  });

  it("keeps recording behind a grant while reading stays public", async () => {
    await rate("6.5%");
    expect((await failure(rate("6.9%"))).code).toBe("conflict");
    expect(
      (
        await failure(
          recordFact.call(
            { key: "rate.15-year-fixed", value: "5.9%", source: "Theirs", asOf: SEPTEMBER },
            CUSTOMER,
          ),
        )
      ).code,
    ).toBe("permission");
    expect((await failure(listFacts.call({}, CUSTOMER))).code).toBe("permission");
    // Reading is public: a correction only the owner can see is not a correction.
    expect(await factHistory.call({ key: "rate.30-year-fixed" }, ANONYMOUS)).toHaveLength(1);
  });
});
