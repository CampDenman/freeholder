// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The forms module (MASTER.md §4.6, §36, and CLAUDE.md's spine non-negotiable).
//
// The interesting assertions here are not about forms. They are about what an
// anonymous visitor is allowed to do to the spine: a stranger with no account
// can cause a Contact to exist, and must not be able to cause anything else.
// This is the first module where that path is real, so it is tested as the
// security boundary it is rather than as a feature.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { formSubmissions } from "@/modules/forms/schema";
import {
  createForm,
  listSubmissions,
  reviewSubmission,
  submitForm,
  updateForm,
} from "@/modules/forms/service";
import { mergeContacts } from "@/core/contacts/service";
import { HONEYPOT_FIELD, issueStamp, inspect, STAMP_FIELD } from "@/modules/forms/antispam";
import { fieldsSchema, submissionSchema } from "@/modules/forms/fields";
import type { FormField } from "@/modules/forms/fields";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const CONTACT_FIELDS = [
  { key: "name", label: "Your name", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true },
  { key: "message", label: "Message", kind: "multiline", required: true },
  { key: "budget", label: "Budget", kind: "select", options: ["Under $1,000", "Over $1,000"] },
  { key: "consent", label: "Email me back", kind: "checkbox", required: true },
];

/** A submission a real person would produce, traps included. */
const answers = (over: Record<string, unknown> = {}) => ({
  name: "Grace Hopper",
  email: "Grace@Example.test",
  message: "Do you shoot in November?",
  consent: true,
  [STAMP_FIELD]: issueStamp(new Date(Date.now() - 30_000)),
  ...over,
});

describe("field definitions", () => {
  it("refuses two fields that would overwrite each other", () => {
    const result = fieldsSchema.safeParse([
      { key: "name", label: "Name", kind: "text" },
      { key: "name", label: "Full name", kind: "text" },
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("overwrite");
  });

  it("refuses a dropdown with nothing to choose from", () => {
    const result = fieldsSchema.safeParse([
      { key: "budget", label: "Budget", kind: "select" },
    ]);
    expect(result.success).toBe(false);
  });

  it("normalises an email the way the spine expects", () => {
    // §4.1 is one contact per email address, so the address a form produces
    // must match the address anything else produces for the same person.
    const schema = submissionSchema([
      { key: "email", label: "Email", kind: "email", required: true },
    ] as FormField[]);
    const parsed = schema.safeParse({ email: "  Grace@Example.TEST " });
    expect(parsed.success && (parsed.data as { email: string }).email).toBe(
      "grace@example.test",
    );
  });

  it("treats a required checkbox as consent, not as presence", () => {
    // An unticked box posts nothing at all. A required checkbox is always a
    // consent box, so "absent" and "false" must both be refusals.
    const schema = submissionSchema([
      { key: "consent", label: "Agree", kind: "checkbox", required: true },
    ] as FormField[]);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ consent: false }).success).toBe(false);
    expect(schema.safeParse({ consent: true }).success).toBe(true);
  });
});

describe("the traps", () => {
  it("says nothing about a submission that looks human", () => {
    expect(inspect({ [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)) }))
      .toEqual({ suspected: false, reasons: [] });
  });

  it("catches a filled honeypot", () => {
    const verdict = inspect({
      [HONEYPOT_FIELD]: "https://buy-things.example",
      [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)),
    });
    expect(verdict.suspected).toBe(true);
    expect(verdict.reasons[0]).toContain("hidden from people");
  });

  it("catches a form filled in faster than a person could", () => {
    const verdict = inspect({ [STAMP_FIELD]: issueStamp() });
    expect(verdict.suspected).toBe(true);
    expect(verdict.reasons[0]).toContain("after the page loaded");
  });

  it("catches a forged timestamp", () => {
    // The whole point of signing it. A bot that reads the field and posts a
    // convenient value must not get past the timer.
    const forged = `${Date.now() - 60_000}.notasignature`;
    const verdict = inspect({ [STAMP_FIELD]: forged });
    expect(verdict.suspected).toBe(true);
    expect(verdict.reasons[0]).toContain("this site did not issue");
  });

  it("catches a submission with no timestamp at all", () => {
    expect(inspect({}).suspected).toBe(true);
  });

  it("flags a page left open for half a day, without calling it a bot", () => {
    const stale = issueStamp(new Date(Date.now() - 13 * 60 * 60 * 1000));
    const verdict = inspect({ [STAMP_FIELD]: stale });
    expect(verdict.suspected).toBe(true);
    expect(verdict.reasons[0]).toContain("open for over 12 hours");
  });
});

describe.runIf(hasDatabase)("submitting", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  const contactForm = () =>
    createForm.call(
      {
        slug: "contact",
        name: "Contact",
        fields: CONTACT_FIELDS,
        successMessage: "Thanks — I will reply within a day.",
      },
      STAFF,
    );

  it("puts an anonymous stranger on the spine", async () => {
    await contactForm();
    const result = await submitForm.call(
      { slug: "contact", values: answers(), sourceUrl: "/contact" },
      ANONYMOUS,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("within a day");

    // The non-negotiable: resolve, not create, and the address lowercased on
    // the way in so a second submission finds the same person.
    const [contact] = await db().select().from(contacts);
    expect(contact?.email).toBe("grace@example.test");
    expect(contact?.name).toBe("Grace Hopper");
    expect(contact?.source).toBe("form:contact");

    const [submission] = await db().select().from(formSubmissions);
    expect(submission?.contactId).toBe(contact!.id);
    expect(submission?.status).toBe("received");
    expect(submission?.data).toMatchObject({ message: "Do you shoot in November?" });

    // And the CRM shows it without forms knowing the CRM exists.
    const timeline = await db().select().from(timelineEvents);
    expect(timeline.some((e) => e.eventType === "form.submitted")).toBe(true);
  });

  it("does not create a second contact for a returning visitor", async () => {
    await contactForm();
    await submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS);
    await submitForm.call(
      { slug: "contact", values: answers({ message: "Following up" }) },
      ANONYMOUS,
    );
    expect(await db().select().from(contacts)).toHaveLength(1);
    expect(await db().select().from(formSubmissions)).toHaveLength(2);
  });

  it("keeps suspected spam without letting it reach the spine", async () => {
    await contactForm();
    await submitForm.call(
      {
        slug: "contact",
        values: answers({ [HONEYPOT_FIELD]: "http://spam.example" }),
      },
      ANONYMOUS,
    );

    // §36 wants a quarantine queue, not a bin: the row exists, flagged.
    const [submission] = await db().select().from(formSubmissions);
    expect(submission?.status).toBe("spam");
    expect(submission?.spamReasons[0]).toContain("hidden from people");

    // And nothing reached the CRM: no contact, no timeline, no event.
    expect(await db().select().from(contacts)).toHaveLength(0);
    expect(await db().select().from(timelineEvents)).toHaveLength(0);
  });

  it("rescues a false positive, and puts the person on the spine then", async () => {
    await contactForm();
    await submitForm.call(
      { slug: "contact", values: answers({ [STAMP_FIELD]: issueStamp() }) },
      ANONYMOUS,
    );
    const [flagged] = await listSubmissions.call(
      { formId: (await db().select().from(formSubmissions))[0]!.formId, status: "spam" },
      STAFF,
    );
    expect(flagged?.contactId).toBeNull();

    const rescued = await reviewSubmission.call(
      { id: flagged!.id, status: "received" },
      STAFF,
    );
    expect(rescued.status).toBe("received");
    expect(rescued.contactId).toBeTruthy();
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  it("tells a visitor what is wrong with their own answer", async () => {
    await contactForm();
    const error = await failure(
      submitForm.call(
        { slug: "contact", values: answers({ email: "not-an-address" }) },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("Email");
    expect(await db().select().from(formSubmissions)).toHaveLength(0);
  });

  it("refuses a closed form", async () => {
    const form = await contactForm();
    await updateForm.call({ id: form.id, status: "closed" }, STAFF);
    const error = await failure(
      submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("no longer accepting");
  });

  it("stores a submission with no email, rather than discarding it", async () => {
    // A survey that asks for no address still produced an answer somebody
    // typed. Throwing it away because it does not fit the CRM is the wrong
    // trade.
    await createForm.call(
      {
        slug: "feedback",
        name: "Feedback",
        destination: "none",
        fields: [{ key: "note", label: "Anything to add?", kind: "multiline" }],
      },
      STAFF,
    );
    await submitForm.call(
      {
        slug: "feedback",
        values: {
          note: "The gallery was lovely",
          [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)),
        },
      },
      ANONYMOUS,
    );
    const [submission] = await db().select().from(formSubmissions);
    expect(submission?.contactId).toBeNull();
    expect(submission?.status).toBe("received");
    expect(await db().select().from(contacts)).toHaveLength(0);
  });

  it("does not let a stranger read what other people submitted", async () => {
    const form = await contactForm();
    await submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS);
    const error = await failure(
      listSubmissions.call({ formId: form.id }, ANONYMOUS),
    );
    expect(error.code).toBe("permission");
  });

  it("does not let a stranger create or change a form", async () => {
    expect(
      (await failure(createForm.call({ slug: "x", name: "X" }, ANONYMOUS))).code,
    ).toBe("permission");
  });

  it("caps how often one form can be submitted", async () => {
    await contactForm();
    // The ceiling is per form: an anonymous surface has no trustworthy
    // identity to key on, so the form itself is the subject.
    const attempts = [];
    for (let i = 0; i < 31; i += 1) {
      attempts.push(
        submitForm
          .call(
            { slug: "contact", values: answers({ email: `p${i}@example.test` }) },
            ANONYMOUS,
          )
          .then(
            () => "ok",
            (error: { code: string }) => error.code,
          ),
      );
    }
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === "rate_limited").length).toBeGreaterThan(0);
  });
});

describe.runIf(hasDatabase)("merging a contact who submitted forms", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  it("brings their submissions with them", async () => {
    // The reason CLAUDE.md's non-negotiable exists, exercised on the first
    // module that creates the obligation.
    await createForm.call(
      {
        slug: "contact",
        name: "Contact",
        fields: [
          { key: "name", label: "Name", kind: "text", required: true },
          { key: "email", label: "Email", kind: "email", required: true },
        ],
      },
      STAFF,
    );
    const stamp = () => issueStamp(new Date(Date.now() - 20_000));
    await submitForm.call(
      {
        slug: "contact",
        values: { name: "Grace", email: "grace@example.test", [STAMP_FIELD]: stamp() },
      },
      ANONYMOUS,
    );
    await submitForm.call(
      {
        slug: "contact",
        values: { name: "G Hopper", email: "ghopper@example.test", [STAMP_FIELD]: stamp() },
      },
      ANONYMOUS,
    );

    const rows = await db().select().from(contacts);
    expect(rows).toHaveLength(2);
    const [survivor, duplicate] = rows;

    await mergeContacts.call(
      { survivingId: survivor!.id, duplicateId: duplicate!.id },
      OWNER,
    );

    const submissions = await db().select().from(formSubmissions);
    expect(submissions).toHaveLength(2);
    expect(submissions.every((s) => s.contactId === survivor!.id)).toBe(true);
  });
});
