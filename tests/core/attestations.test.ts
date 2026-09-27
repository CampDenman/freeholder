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

  it("lets staff read the ledger but refuses to let them publish", async () => {
    // The administrator seed grant: see `src/core/roles/defaults.ts`. A view
    // grant reads; publishing stays with the owner unless the owner delegates
    // manage explicitly.
    const staffReader: typeof CUSTOMER = {
      kind: "user",
      userId: "00000000-0000-4000-8000-000000000004",
      role: "administrator",
      grants: [{ module: "attestations", access: "view" }],
    };
    await rate("6.5%");

    // Staff read: the current list and the ledger are visible to a view grant.
    const listed = await listFacts.call({}, staffReader);
    expect(listed.map((entry) => entry.key)).toContain("rate.30-year-fixed");
    const ledger = await factHistory.call({ key: "rate.30-year-fixed" }, staffReader);
    expect(ledger).toHaveLength(1);

    // Owner publishes: every write is refused to the reader, each naming
    // permission rather than pretending the fact is missing.
    expect(
      (
        await failure(
          recordFact.call(
            { key: "rate.15-year-fixed", value: "5.9%", source: "Theirs", asOf: SEPTEMBER },
            staffReader,
          ),
        )
      ).code,
    ).toBe("permission");
    expect(
      (
        await failure(
          correctFact.call(
            {
              key: "rate.30-year-fixed",
              value: "6.9%",
              source: "Theirs",
              asOf: LATER,
              note: "Not yours to change.",
            },
            staffReader,
          ),
        )
      ).code,
    ).toBe("permission");
    const [row] = await factHistory.call({ key: "rate.30-year-fixed" }, OWNER);
    expect(
      (
        await failure(
          withdrawFact.call({ id: row!.id, reason: "Not yours." }, staffReader),
        )
      ).code,
    ).toBe("permission");
  });

  it("keeps money in integer minor units, exactly as recorded", async () => {
    // The value column is schemaless by design (principle 12); the convention
    // that keeps calculators and pages honest is that a money fact is an
    // integer in minor units — 129999 cents, never 1299.99 — so it can cross
    // a correction, a withdrawal and an export without float drift.
    await recordFact.call(
      {
        key: "price.standard-session",
        value: 129999,
        source: "Current rate card",
        asOf: SEPTEMBER,
      },
      OWNER,
    );
    const found = await currentFact.call({ key: "price.standard-session" }, ANONYMOUS);
    expect(found?.value).toBe(129999);
    expect(Number.isInteger(found?.value)).toBe(true);

    await correctFact.call(
      {
        key: "price.standard-session",
        value: 134999,
        source: "Rate card, September revision",
        asOf: LATER,
        note: "Autumn pricing.",
      },
      OWNER,
    );
    const ledger = await factHistory.call({ key: "price.standard-session" }, ANONYMOUS);
    expect(ledger.map((entry) => entry.value)).toEqual([129999, 134999]);
  });
});
