// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Registration, and refusing to send without it (C7.11, MASTER.md §4.14).
//
// §4.14: "Registration is part of setup, not a surprise… an unregistered number
// silently filtered by carriers is the most common way an SMS launch fails."
//
// The reason that failure is so common is the reason these tests exist. An
// unregistered US number does not bounce. The carrier accepts the message,
// returns a success, bills the account, and drops it somewhere the sender
// cannot see — so every signal a normal integration relies on says it went out.
// The only defence is knowing the rules *before* sending.
//
// Four claims:
//
//   1. **What is required is derived, never stored.** An owner cannot clear it,
//      because carrier policy is not theirs to waive.
//   2. **Required and not approved means refused**, not warned. A warning
//      somebody clicks past reproduces the failure exactly.
//   3. **The refusal says what to do.** "No usable number" sends an owner to
//      check credentials that are already correct.
//   4. **An unknown country is unknown, not "nowhere in particular".**
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { messagingNumbers } from "@/core/messaging/numbers-schema";
import { maySend, overallState, requirementsFor } from "@/core/messaging/registration";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  numberRegistrations,
  sendSms,
  setRegistration,
  whyNothingCanSend,
} from "@/core/messaging/sms";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function daytimeTimezone(): string {
  let offset = 12 - new Date().getUTCHours();
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  if (offset === 0) return "UTC";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

describe("what a number must be registered for", () => {
  it("wants 10DLC for a US long code", () => {
    const required = requirementsFor({ country: "US", kind: "long_code" });
    expect(required.map((one) => one.kind)).toEqual(["10dlc"]);
    // The guidance has to explain the silence, or an owner will not believe it.
    expect(required[0]!.guidance).toContain("drop");
  });

  it("wants verification for a US or Canadian toll-free number", () => {
    expect(
      requirementsFor({ country: "US", kind: "toll_free" }).map((one) => one.kind),
    ).toEqual(["toll_free_verification"]);
    expect(
      requirementsFor({ country: "CA", kind: "toll_free" }).map((one) => one.kind),
    ).toEqual(["toll_free_verification"]);
  });

  it("wants nothing for an ordinary number outside the US", () => {
    expect(requirementsFor({ country: "GB", kind: "long_code" })).toEqual([]);
    expect(requirementsFor({ country: "AU", kind: "long_code" })).toEqual([]);
    // A Canadian long code is not 10DLC; only the toll-free one is verified.
    expect(requirementsFor({ country: "CA", kind: "long_code" })).toEqual([]);
  });

  it("treats a sender name as allowed where the country permits one", () => {
    const uk = requirementsFor({ country: "GB", kind: "alphanumeric" });
    expect(uk[0]!.guidance).toContain("Register");
  });

  it("says plainly that a sender name will not work in the US", () => {
    const us = requirementsFor({ country: "US", kind: "alphanumeric" });
    expect(us[0]!.guidance).toContain("not accepted");
    // And it can never become sendable, because no registration exists to do.
    expect(maySend({ country: "US", kind: "alphanumeric", registrations: [] }).allowed).toBe(
      false,
    );
  });

  // The honest default for a country nobody checked is "we do not know".
  it("refuses to guess when the country is unknown", () => {
    const unknown = requirementsFor({ country: null, kind: "long_code" });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.guidance).toContain("no country recorded");
  });

  it("lets a short code through when nothing is known about it", () => {
    // Short codes are allocated per-country through a process that has already
    // vetted the sender; there is no second registration to chase.
    expect(requirementsFor({ country: null, kind: "short_code" })).toEqual([]);
  });
});

describe("whether a number may send", () => {
  const usLongCode = { country: "US", kind: "long_code" as const };

  it("says no when a required registration has not been started", () => {
    const verdict = maySend({ ...usLongCode, registrations: [] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.outstanding).toEqual(["10dlc"]);
  });

  it("says no while it is still in review", () => {
    expect(
      maySend({ ...usLongCode, registrations: [{ kind: "10dlc", state: "in_review" }] }).allowed,
    ).toBe(false);
  });

  it("says yes once it is approved", () => {
    expect(
      maySend({ ...usLongCode, registrations: [{ kind: "10dlc", state: "approved" }] }).allowed,
    ).toBe(true);
  });

  it("says yes when nothing was required at all", () => {
    const verdict = maySend({ country: "GB", kind: "long_code", registrations: [] });
    expect(verdict).toEqual({ allowed: true, problem: null, outstanding: [] });
  });

  // "Rejected" alone is unactionable.
  it("repeats why it was rejected", () => {
    const verdict = maySend({
      ...usLongCode,
      registrations: [
        { kind: "10dlc", state: "rejected", reason: "The brand's EIN did not match." },
      ],
    });
    expect(verdict.problem).toContain("EIN did not match");
  });

  it("reports the worst state, because that is the one to act on", () => {
    expect(overallState({ country: "GB", kind: "long_code", registrations: [] })).toBe(
      "not_required",
    );
    expect(
      overallState({ ...usLongCode, registrations: [{ kind: "10dlc", state: "approved" }] }),
    ).toBe("approved");
    expect(
      overallState({ ...usLongCode, registrations: [{ kind: "10dlc", state: "rejected" }] }),
    ).toBe("rejected");
  });
});

describe.runIf(hasDatabase)("registration and sending", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function number(overrides: Record<string, unknown> = {}) {
    const [row] = await db()
      .insert(messagingNumbers)
      .values({
        provider: "none",
        providerRef: `PN-${Math.random().toString(36).slice(2, 8)}`,
        e164: "+15005550006",
        country: "US",
        kind: "long_code",
        capabilities: { sms: true, mms: false, inbound: true },
        ...overrides,
      })
      .returning();
    return row!;
  }

  it("lists what each number still owes, derived rather than stored", async () => {
    await number({ e164: "+15005550001", country: "US", kind: "long_code" });
    await number({ e164: "+447700900001", country: "GB", kind: "long_code" });

    const listed = await numberRegistrations.call({}, OWNER);
    const us = listed.find((one) => one.country === "US")!;
    const gb = listed.find((one) => one.country === "GB")!;

    expect(us).toMatchObject({ state: "not_started", canSend: false });
    expect(us.required.map((one) => one.kind)).toEqual(["10dlc"]);
    // Nothing required is a first-class answer, not an empty checklist.
    expect(gb).toMatchObject({ state: "not_required", canSend: true, required: [] });
  });

  it("records how far a registration has got", async () => {
    const one = await number();
    await setRegistration.call(
      { id: one.id, kind: "10dlc", state: "submitted", brand: "Acme Ltd", campaign: "Bookings" },
      OWNER,
    );
    let listed = await numberRegistrations.call({}, OWNER);
    expect(listed[0]).toMatchObject({ state: "submitted", canSend: false });
    expect(listed[0]!.required[0]).toMatchObject({ brand: "Acme Ltd", campaign: "Bookings" });

    await setRegistration.call({ id: one.id, kind: "10dlc", state: "approved" }, OWNER);
    listed = await numberRegistrations.call({}, OWNER);
    expect(listed[0]).toMatchObject({ state: "approved", canSend: true });
    // The brand survives a state change; it was not restated.
    expect(listed[0]!.required[0]!.brand).toBe("Acme Ltd");
  });

  it("keeps the moment it was first submitted", async () => {
    const one = await number();
    await setRegistration.call({ id: one.id, kind: "10dlc", state: "submitted" }, OWNER);
    const [first] = await db()
      .select()
      .from(messagingNumbers)
      .where(eq(messagingNumbers.id, one.id));
    const submittedAt = (first!.registrations as Array<{ submittedAt?: string | null }>)[0]!
      .submittedAt;

    await setRegistration.call({ id: one.id, kind: "10dlc", state: "in_review" }, OWNER);
    const [later] = await db()
      .select()
      .from(messagingNumbers)
      .where(eq(messagingNumbers.id, one.id));
    // "How long has this been in review" is the question an owner actually asks.
    expect(
      (later!.registrations as Array<{ submittedAt?: string | null }>)[0]!.submittedAt,
    ).toBe(submittedAt);
  });

  it("refuses to record a registration nothing asked for", async () => {
    const gb = await number({ country: "GB", e164: "+447700900002" });
    const refused = await failure(
      setRegistration.call({ id: gb.id, kind: "10dlc", state: "approved" }, OWNER),
    );
    // Otherwise the screen puts a form in front of somebody nobody asked to
    // fill in.
    expect(refused.message).toContain("not needed");
  });

  // The rule §4.14 actually asks for, tested where it lives.
  //
  // `sendSms` refuses at the adapter *before* it looks at numbers, and rightly:
  // with no provider configured at all, "SMS is not configured" is the useful
  // answer and a number's registration is moot. So the diagnostic is exercised
  // directly rather than through a path that correctly never reaches it — which
  // is also how it will behave on a real instance, where the adapter is
  // configured and the numbers are the only thing left to be wrong.
  it("names the outstanding registration rather than saying nothing works", async () => {
    await number({ country: "US", kind: "long_code" });
    const why = await db().transaction((tx) => whyNothingCanSend(tx));
    // Not "no usable number" — the actual thing to go and do.
    expect(why).toContain("10DLC");
  });

  it("says which of several problems is the real one", async () => {
    // Registered fine and healthy, but switched off: a different fix entirely.
    await number({ active: false, country: "GB" });
    const why = await db().transaction((tx) => whyNothingCanSend(tx));
    expect(why).toContain("switched off");
  });

  it("says so plainly when there are no numbers at all", async () => {
    const why = await db().transaction((tx) => whyNothingCanSend(tx));
    expect(why).toContain("No numbers are set up");
  });

  it("passes on the provider's own health problem when that is what is wrong", async () => {
    await number({
      country: "GB",
      healthy: false,
      healthProblem: 'Twilio reports this number as "closed".',
    });
    const why = await db().transaction((tx) => whyNothingCanSend(tx));
    expect(why).toContain("closed");
  });

  // And the refusal that does happen with no provider is still the right one.
  it("refuses at the provider when there is no provider at all", async () => {
    await number({ country: "GB" });
    const [contact] = await db()
      .insert(contacts)
      .values({
        name: "Carrier Test",
        email: "carrier-test@example.test",
        phone: "+447700900100",
        timezone: daytimeTimezone(),
      })
      .returning();
    const refused = await failure(
      sendSms.call(
        {
          contactId: contact!.id,
          to: "+447700900100",
          body: "Hello",
          idempotencyKey: "k9",
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("not configured");
  });
});
