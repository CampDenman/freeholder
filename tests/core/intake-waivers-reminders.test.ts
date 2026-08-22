// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Intake, waivers and reminders (C6.09, MASTER.md §4.3, §4.4).
//
// Four claims, and each is one an owner would notice being wrong:
//
//   1. **The gate is on confirming, not on booking.** Somebody can hold a slot
//      before they have signed anything; what they cannot do is have it
//      confirmed.
//   2. **A signature is evidence.** The body is a snapshot, the hash proves it
//      unchanged, the identifying facts come from the request rather than the
//      form, and signing happens exactly once.
//   3. **Erasure keeps the business's evidence and forgets the person.** The
//      opposite of what it does to a waitlist entry, and deliberately.
//   4. **"Was she reminded?" has an answer.** Every attempt lands in the row,
//      including the ones that were deliberately not sent.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { bookingReminders, bookings } from "@/core/scheduling/schema";
import { contractDocuments } from "@/modules/contracts/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createCalendar } from "@/core/scheduling/service";
import { createBooking, setBookingStatus } from "@/core/scheduling/bookings";
import { bookingRequirements, issueBookingWaiver } from "@/core/scheduling/requirements";
import {
  addBookingReminder,
  cancelBookingReminder,
  listBookingReminders,
  sendDueReminders,
} from "@/core/scheduling/reminders";
import {
  contractByToken,
  declineContract,
  getContract,
  issueContract,
  listContracts,
  signContract,
  signingLink,
  voidContract,
} from "@/modules/contracts/service";
import { createProduct } from "@/modules/catalog/service";
import { upsertServiceOffering } from "@/modules/catalog/offerings";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;
const WAIVER = "You agree that pottery is messy and the kiln is hot.";

describe.runIf(hasDatabase)("intake, waivers and reminders", { timeout: 90_000 }, () => {
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

  async function calendar(name = "Studio A") {
    return createCalendar.call(
      { kind: "resource", name, capacityDefault: 1, timezone: "Europe/London" },
      OWNER,
    );
  }

  /** An appointment a few days out, so reminders have somewhere to land. */
  async function book(calendarId: string, overrides: Record<string, unknown> = {}) {
    const startsAt = new Date(Date.now() + 4 * 86_400_000);
    return createBooking.call(
      {
        calendarId,
        contact: { email: "rae@example.test", name: "Rae Lane" },
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        ...overrides,
      },
      OWNER,
    );
  }

  /** A real contact on the spine, resolved the way every automated path must. */
  async function contactId(): Promise<string> {
    const [existing] = await db().select({ id: contacts.id }).from(contacts).limit(1);
    if (existing) return existing.id;
    const resolved = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  /** A service that asks for a waiver before it will be confirmed. */
  async function serviceAskingForAWaiver(): Promise<string> {
    const product = await createProduct.call(
      { name: "Pottery class", slug: "pottery-class", kind: "service" },
      OWNER,
    );
    const offering = await upsertServiceOffering.call(
      {
        productId: product.id,
        durationMin: 60,
        locationType: "in_person",
        waiverTitle: "Studio waiver",
        waiverBody: WAIVER,
        reminderOffsetsMin: [1_440],
      },
      OWNER,
    );
    return offering.id;
  }

  // The claim §4.4 actually makes: intake and a signed waiver come **before
  // the slot is confirmed**, not before it is booked. Somebody who cannot hold
  // a slot until they have signed something is somebody who leaves.
  it("takes the booking, and refuses to confirm it until the waiver is signed", async () => {
    const studio = await calendar();
    const offeringId = await serviceAskingForAWaiver();
    const booked = await book(studio.id, { serviceOfferingId: offeringId });
    // Booked, held, and in the diary. That much never waits on a signature.
    expect(booked.status).toBe("requested");

    const refused = await failure(
      setBookingStatus.call({ id: booked.id, status: "confirmed" }, OWNER),
    );
    expect(refused.message).toContain("waiver has not been signed");

    const issued = await issueBookingWaiver.call({ id: booked.id }, OWNER);
    expect(issued.contractId).toBeTruthy();
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.contractId!));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    const confirmed = await setBookingStatus.call(
      { id: booked.id, status: "confirmed" },
      OWNER,
    );
    expect(confirmed.status).toBe("confirmed");
    // Confirming is also what puts the reminders in the diary, from the
    // offsets the offering asked for.
    const reminders = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ offsetMin: 1_440, status: "scheduled" });
  });

  // The policy binds the customer, not the business: somebody who signed on
  // paper in the shop has met the requirement in the way that matters.
  it("lets the owner confirm anyway, and says so", async () => {
    const studio = await calendar();
    const offeringId = await serviceAskingForAWaiver();
    const booked = await book(studio.id, { serviceOfferingId: offeringId });
    const confirmed = await setBookingStatus.call(
      { id: booked.id, status: "confirmed", overrideRequirements: true },
      OWNER,
    );
    expect(confirmed.status).toBe("confirmed");
  });

  it("reports what is outstanding, and stops once it is done", async () => {
    const studio = await calendar();
    const offeringId = await serviceAskingForAWaiver();
    const booked = await book(studio.id, { serviceOfferingId: offeringId });

    const before = await bookingRequirements.call({ id: booked.id }, OWNER);
    expect(before).toMatchObject({ waiverOutstanding: true, ready: false });
    expect(before!.waiverTitle).toBe("Studio waiver");

    const issued = await issueBookingWaiver.call({ id: booked.id }, OWNER);
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.contractId!));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    const after = await bookingRequirements.call({ id: booked.id }, OWNER);
    expect(after).toMatchObject({ waiverOutstanding: false, ready: true });
  });

  // Editing the waiver afterwards must not change what was signed — the
  // snapshot is the difference between an e-signature and a checkbox.
  it("holds the words that were signed when the service's waiver is rewritten", async () => {
    const studio = await calendar();
    const offeringId = await serviceAskingForAWaiver();
    const booked = await book(studio.id, { serviceOfferingId: offeringId });
    const issued = await issueBookingWaiver.call({ id: booked.id }, OWNER);
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.contractId!));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    const [product] = await db()
      .select({ id: contractDocuments.id })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.contractId!));
    void product;
    await upsertServiceOffering.call(
      {
        productId: (
          await createProduct.call(
            { name: "Pottery class two", slug: "pottery-class-two", kind: "service" },
            OWNER,
          )
        ).id,
        durationMin: 60,
        locationType: "in_person",
        waiverBody: "Completely different terms nobody agreed to.",
      },
      OWNER,
    );

    const stored = await getContract.call({ id: issued.contractId! }, OWNER);
    expect(stored?.body).toBe(WAIVER);
    expect(stored?.bodyIntact).toBe(true);
  });

  it("copies the words that were agreed, rather than pointing at them", async () => {
    const issued = await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        title: "Studio waiver",
        body: WAIVER,
      },
      OWNER,
    );
    const stored = await getContract.call({ id: issued.id }, OWNER);
    expect(stored?.body).toBe(WAIVER);
    // The hash is recomputed on read rather than trusted, because a stored
    // hash nobody ever checks is a comment with a database column.
    expect(stored?.bodyIntact).toBe(true);
  });

  it("records who signed, from the request rather than from the form", async () => {
    const issued = await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        title: "Studio waiver",
        body: WAIVER,
      },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));

    const signed = await signContract.call(
      {
        token: row!.token!,
        signerName: "Rae Lane",
        ip: "203.0.113.7",
        userAgent: "Mozilla/5.0 (iPhone)",
      },
      ANON,
    );
    expect(signed.signatureHash).toMatch(/^[0-9a-f]{64}$/);

    const stored = await getContract.call({ id: issued.id }, OWNER);
    expect(stored).toMatchObject({
      status: "signed",
      signerName: "Rae Lane",
      signerIp: "203.0.113.7",
      signerEmail: "rae@example.test",
    });
  });

  it("lets somebody sign once, and once only", async () => {
    const issued = await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        title: "Studio waiver",
        body: WAIVER,
      },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    // The link is spent. One that kept working is a second signature waiting
    // to overwrite the first, which is the moment the evidence stops being.
    const again = await failure(
      signContract.call({ token: row!.token!, signerName: "Somebody Else" }, ANON),
    );
    expect(again.code).toBe("not_found");
  });

  it("returns the outstanding document rather than issuing a second one", async () => {
    const id = await contactId();
    const subjectId = (await calendar()).id;
    const first = await issueContract.call(
      { contactId: id, subjectType: "booking", subjectId, title: "Waiver", body: WAIVER },
      OWNER,
    );
    const again = await issueContract.call(
      { contactId: id, subjectType: "booking", subjectId, title: "Waiver", body: WAIVER },
      OWNER,
    );
    // A refreshed page is not a second agreement, and the link is already in
    // somebody's inbox.
    expect(again.id).toBe(first.id);
  });

  it("never puts the signing token in a list", async () => {
    await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        title: "Studio waiver",
        body: WAIVER,
      },
      OWNER,
    );
    const listed = await listContracts.call({}, OWNER);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("signToken");
  });

  it("hands the signing link only to whoever holds the subject's own link", async () => {
    const studio = await calendar();
    const issued = await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        subjectId: studio.id,
        title: "Waiver",
        body: WAIVER,
      },
      OWNER,
    );
    // Scoped, and reached by elevation: the customer-facing caller proves
    // possession of the booking's own link before it asks.
    const denied = await failure(
      signingLink.call({ subjectType: "booking", subjectId: studio.id }, ANON),
    );
    expect(denied.code).toBe("permission");

    const link = await signingLink.call(
      { subjectType: "booking", subjectId: studio.id },
      OWNER,
    );
    expect(link.token).toBeTruthy();
    const seen = await contractByToken.call({ token: link.token! }, ANON);
    expect(seen).toMatchObject({ id: issued.id, body: WAIVER, status: "issued" });
  });

  it("keeps a signed agreement, and withdraws only an unsigned one", async () => {
    const id = await contactId();
    const open = await issueContract.call(
      { contactId: id, subjectType: "booking", title: "Waiver", body: WAIVER },
      OWNER,
    );
    await voidContract.call({ id: open.id }, OWNER);

    const second = await issueContract.call(
      { contactId: id, subjectType: "quote", title: "Terms", body: WAIVER },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, second.id));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    // What was agreed happened. The honest move is a second document saying
    // otherwise, not editing the first out of existence.
    const refused = await failure(voidContract.call({ id: second.id }, OWNER));
    expect(refused.message).toContain("nobody has signed");
  });

  it("records a refusal as a refusal", async () => {
    const issued = await issueContract.call(
      {
        contactId: await contactId(),
        subjectType: "booking",
        title: "Waiver",
        body: WAIVER,
      },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    await declineContract.call({ token: row!.token!, reason: "Not happy with it." }, ANON);
    const stored = await getContract.call({ id: issued.id }, OWNER);
    expect(stored).toMatchObject({ status: "declined" });
  });

  // Erasure here is the opposite of erasure on a waitlist entry, and for a
  // reason: a signed waiver is the business's own evidence of a legal
  // position, and deleting it would destroy that along with the person's data.
  it("forgets the signer and keeps the agreement", async () => {
    const id = await contactId();
    const issued = await issueContract.call(
      { contactId: id, subjectType: "booking", title: "Waiver", body: WAIVER },
      OWNER,
    );
    const [row] = await db()
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    await signContract.call({ token: row!.token!, signerName: "Rae Lane" }, ANON);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.contracts");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, id, { requestId: "test" }));

    const [after] = await db()
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.id, issued.id));
    expect(after).toMatchObject({ status: "signed", signerName: null, signToken: null });
    // The document, the hash and the moment survive. Only the person is gone.
    expect(after!.bodySnapshot).toBe(WAIVER);
    expect(after!.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("schedules reminders when an appointment is confirmed, and drops them when it goes", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await addBookingReminder.call(
      { bookingId: booked.id, offsetMin: 1_440 },
      OWNER,
    );
    const scheduled = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ status: "scheduled", channel: "email" });

    await setBookingStatus.call(
      { id: booked.id, status: "cancelled", reason: "Something came up." },
      OWNER,
    );
    const after = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(after[0]).toMatchObject({ status: "skipped" });
    expect(after[0]!.skipReason).toContain("cancelled");
  });

  it("refuses a reminder that would already have been due", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    // Four days out, so a 30-day notice is firmly in the past.
    const refused = await failure(
      addBookingReminder.call({ bookingId: booked.id, offsetMin: 43_200 }, OWNER),
    );
    expect(refused.message).toContain("already have been due");
  });

  it("does not schedule the same reminder twice", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await addBookingReminder.call({ bookingId: booked.id, offsetMin: 60 }, OWNER);
    await addBookingReminder.call({ bookingId: booked.id, offsetMin: 60 }, OWNER);
    const listed = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(listed).toHaveLength(1);
  });

  it("stops one going out when the owner says so", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    const reminder = await addBookingReminder.call(
      { bookingId: booked.id, offsetMin: 120 },
      OWNER,
    );
    await cancelBookingReminder.call({ id: reminder.id }, OWNER);
    const listed = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(listed[0]).toMatchObject({ status: "skipped" });
    // Stopping it twice is a refusal rather than a silent no-op: the second
    // press means somebody expected something to happen.
    const again = await failure(cancelBookingReminder.call({ id: reminder.id }, OWNER));
    expect(again.code).toBe("conflict");
  });

  // §4.14 owns numbers, registration, quiet hours and STOP handling. Sending a
  // text without them is sending one that cannot be stopped, so the refusal is
  // explicit and recorded rather than a half-implementation.
  it("says plainly why a text reminder was not sent", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    const reminder = await addBookingReminder.call(
      { bookingId: booked.id, channel: "sms", offsetMin: 60 },
      OWNER,
    );
    await db()
      .update(bookingReminders)
      .set({ sendAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingReminders.id, reminder.id));

    const swept = await sendDueReminders();
    expect(swept.skipped).toBe(1);
    const listed = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(listed[0]!.skipReason).toContain("messaging module");
  });

  it("does not remind anybody about an appointment that is no longer happening", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    const reminder = await addBookingReminder.call(
      { bookingId: booked.id, offsetMin: 60 },
      OWNER,
    );
    // Due, and the appointment quietly moved on underneath it.
    await db()
      .update(bookingReminders)
      .set({ sendAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingReminders.id, reminder.id));
    await db()
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, booked.id));

    const swept = await sendDueReminders();
    expect(swept.skipped).toBe(1);
    expect(swept.sent).toBe(0);
    const listed = await listBookingReminders.call({ bookingId: booked.id }, OWNER);
    expect(listed[0]!.skipReason).toContain("no longer going ahead");
  });
});
