// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One template model for every kind of message (MASTER.md §30, §4.9, C9.05).
//
// The test worth reading first is the one about a missing variable. §30 calls
// these "locked variable slots", and a receipt that reaches a customer saying
// `{{invoice.total}}` is worse than a failed send: the send can be retried,
// the impression cannot.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { entityTranslations } from "@/core/i18n/schema";
import { emailTemplates } from "@/modules/newsletters/template-schema";
import {
  getTemplate,
  listTemplates,
  renderTemplate,
  resetTemplate,
  saveTemplate,
  templateSlots,
} from "@/modules/newsletters/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

/**
 * A block tree with one paragraph, shaped the way the editor produces one.
 *
 * `props.body` rather than `props.value` — that is what the `text` block
 * declares and what `email-render.ts` reads. Getting it wrong renders an empty
 * cell rather than an error, which is exactly why these tests assert on the
 * rendered output instead of on the stored tree.
 */
const body = (text: string) => [
  { type: "text", props: { body: text } },
];

describe.runIf(hasDatabase)("message templates", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("serves every kind from one model", async () => {
    // §30: "one template model serves everything". Four tables would be four
    // places for the block vocabulary and the slots to drift apart.
    for (const kind of ["transactional", "campaign", "newsletter", "automation", "sms"] as const) {
      await saveTemplate.call(
        { kind, name: `A ${kind} one`, subject: "Hello", blocks: body("Hi") },
        OWNER,
      );
    }
    expect(await listTemplates.call({}, OWNER)).toHaveLength(5);
    expect(await listTemplates.call({ kind: "sms" }, OWNER)).toHaveLength(1);
  });

  /* ----------------------------------------------------------- rendering */

  it("fills the slots it was given", async () => {
    const saved = await saveTemplate.call(
      {
        kind: "transactional",
        name: "Receipt",
        subject: "Your receipt from {{business.name}}",
        blocks: body("Thanks {{contact.first_name}} — that came to {{invoice.total}}."),
        variables: ["contact.first_name", "invoice.total", "business.name"],
      },
      OWNER,
    );

    const rendered = await renderTemplate.call(
      {
        id: saved.id,
        variables: {
          "contact.first_name": "Nils",
          "invoice.total": "$120.00",
          "business.name": "Aurora Coast",
        },
      },
      OWNER,
    );

    // The subject takes slots too — it is the line somebody reads in their
    // inbox list, and the one place an unfilled slot is guaranteed to be seen.
    expect(rendered.subject).toBe("Your receipt from Aurora Coast");
    expect(rendered.html).toContain("Nils");
    expect(rendered.html).toContain("$120.00");
    expect(rendered.text).toContain("$120.00");
    expect(rendered.html).not.toContain("{{");
  });

  it("refuses to render when a promised slot has no value", async () => {
    // The locked half of "locked variable slots". Sending is retryable; a
    // customer reading `{{invoice.total}}` is not.
    const saved = await saveTemplate.call(
      {
        kind: "transactional",
        name: "Receipt",
        subject: "Receipt",
        blocks: body("That came to {{invoice.total}}."),
        variables: ["invoice.total"],
      },
      OWNER,
    );
    await expect(
      renderTemplate.call({ id: saved.id, variables: {} }, OWNER),
    ).rejects.toThrow(/invoice\.total/);
  });

  it("does not insist on slots the template never promised", async () => {
    // A template with no declared variables renders whatever it has. The
    // promise runs from template to sender, not the other way.
    const saved = await saveTemplate.call(
      { kind: "campaign", name: "Plain", subject: "Hello", blocks: body("No slots here.") },
      OWNER,
    );
    const rendered = await renderTemplate.call({ id: saved.id, variables: {} }, OWNER);
    expect(rendered.html).toContain("No slots here.");
  });

  it("finds a transactional template by its slug", async () => {
    // A sender needs *the* receipt template without knowing its id or trusting
    // a display name the owner can rename.
    await saveTemplate.call(
      {
        kind: "transactional",
        name: "Whatever the owner calls it",
        slug: "invoice.sent",
        subject: "Your invoice",
        blocks: body("Attached."),
      },
      OWNER,
    );
    const rendered = await renderTemplate.call({ slug: "invoice.sent", variables: {} }, OWNER);
    expect(rendered.subject).toBe("Your invoice");
  });

  it("refuses two templates sharing a slug", async () => {
    await saveTemplate.call(
      { kind: "transactional", name: "First", slug: "booking.confirmed", subject: "A", blocks: [] },
      OWNER,
    );
    await expect(
      saveTemplate.call(
        {
          kind: "transactional",
          name: "Second",
          slug: "booking.confirmed",
          subject: "B",
          blocks: [],
        },
        OWNER,
      ),
    ).rejects.toThrow();
  });

  it("lets many templates have no slug at all", async () => {
    // The unique index is partial for exactly this: most templates an owner
    // writes are unnamed by any sender, and several nulls must not collide.
    for (const name of ["One", "Two", "Three"]) {
      await saveTemplate.call({ kind: "campaign", name, subject: name, blocks: [] }, OWNER);
    }
    expect(await listTemplates.call({ kind: "campaign" }, OWNER)).toHaveLength(3);
  });

  /* ------------------------------------------------------------- locales */

  it("renders the translation when there is one", async () => {
    const saved = await saveTemplate.call(
      {
        kind: "transactional",
        name: "Receipt",
        subject: "Your receipt",
        blocks: body("Thank you."),
      },
      OWNER,
    );
    await db().insert(entityTranslations).values({
      entityType: "email_template",
      entityId: saved.id,
      locale: "fr",
      fields: { subject: "Votre reçu", blocks: body("Merci.") },
    });

    const french = await renderTemplate.call({ id: saved.id, locale: "fr", variables: {} }, OWNER);
    expect(french.subject).toBe("Votre reçu");
    expect(french.html).toContain("Merci.");
    expect(french.locale).toBe("fr");
  });

  it("falls back rather than failing when a locale is missing", async () => {
    // A receipt in the wrong language still tells somebody what they were
    // charged. Refusing to send would be worse than sending in English.
    const saved = await saveTemplate.call(
      { kind: "transactional", name: "Receipt", subject: "Your receipt", blocks: body("Thanks.") },
      OWNER,
    );
    const spanish = await renderTemplate.call({ id: saved.id, locale: "es", variables: {} }, OWNER);
    expect(spanish.subject).toBe("Your receipt");
    // Null says the fallback happened, so a caller can tell the difference.
    expect(spanish.locale).toBeNull();
  });

  it("lists the locales a template has been translated into", async () => {
    const saved = await saveTemplate.call(
      { kind: "newsletter", name: "Monthly", subject: "Hello", blocks: [] },
      OWNER,
    );
    for (const locale of ["fr", "es"]) {
      await db().insert(entityTranslations).values({
        entityType: "email_template",
        entityId: saved.id,
        locale,
        fields: { subject: `Hello (${locale})` },
      });
    }
    const detail = await getTemplate.call({ id: saved.id }, OWNER);
    expect(detail.locales).toEqual(["es", "fr"]);
  });

  /* ------------------------------------------------------------- defaults */

  it("says whether a shipped template has been edited", async () => {
    const [shipped] = await db()
      .insert(emailTemplates)
      .values({
        kind: "transactional",
        name: "Booking confirmed",
        slug: "booking.confirmed",
        subject: "You are booked",
        blocks: body("See you then."),
        defaultSubject: "You are booked",
        defaultBlocks: body("See you then."),
        status: "active",
      })
      .returning();

    const before = await getTemplate.call({ id: shipped!.id }, OWNER);
    expect(before.template.customised).toBe(false);

    await saveTemplate.call(
      {
        id: shipped!.id,
        kind: "transactional",
        name: "Booking confirmed",
        slug: "booking.confirmed",
        subject: "See you soon!",
        blocks: body("See you then."),
      },
      OWNER,
    );
    const after = await getTemplate.call({ id: shipped!.id }, OWNER);
    expect(after.template.customised).toBe(true);
  });

  it("puts the shipped wording back", async () => {
    const [shipped] = await db()
      .insert(emailTemplates)
      .values({
        kind: "transactional",
        name: "Quote sent",
        subject: "Your quote",
        blocks: body("Here it is."),
        defaultSubject: "Your quote",
        defaultBlocks: body("Here it is."),
      })
      .returning();

    await saveTemplate.call(
      {
        id: shipped!.id,
        kind: "transactional",
        name: "Quote sent",
        subject: "OI MATE",
        blocks: body("wot u want"),
      },
      OWNER,
    );

    const restored = await resetTemplate.call({ id: shipped!.id }, OWNER);
    expect(restored.subject).toBe("Your quote");
    expect(restored.customised).toBe(false);
  });

  it("keeps the id, so translations survive a reset", async () => {
    // Reset restores rather than deletes: a delete would also lose the slug,
    // the variables and every translation hanging off the id.
    const [shipped] = await db()
      .insert(emailTemplates)
      .values({
        kind: "transactional",
        name: "Receipt",
        subject: "Your receipt",
        blocks: body("Thanks."),
        defaultSubject: "Your receipt",
        defaultBlocks: body("Thanks."),
      })
      .returning();
    await db().insert(entityTranslations).values({
      entityType: "email_template",
      entityId: shipped!.id,
      locale: "fr",
      fields: { subject: "Votre reçu" },
    });

    await saveTemplate.call(
      { id: shipped!.id, kind: "transactional", name: "Receipt", subject: "Edited", blocks: [] },
      OWNER,
    );
    await resetTemplate.call({ id: shipped!.id }, OWNER);

    const [translation] = await db()
      .select()
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityId, shipped!.id),
          eq(entityTranslations.locale, "fr"),
        ),
      );
    expect(translation).toBeTruthy();
  });

  it("refuses to reset something that was never shipped", async () => {
    // An owner's own template has no default to go back to, and a reset that
    // silently blanked it would be the worst possible reading of the button.
    const saved = await saveTemplate.call(
      { kind: "campaign", name: "Mine", subject: "Mine", blocks: body("Mine.") },
      OWNER,
    );
    await expect(resetTemplate.call({ id: saved.id }, OWNER)).rejects.toThrow(/no default/i);
  });

  /* ---------------------------------------------------------------- slots */

  it("offers the slots the editor knows about", async () => {
    // From the block library rather than a list of its own, so the editor's
    // palette and the sender's contract cannot disagree.
    const slots = await templateSlots.call({}, OWNER);
    expect(slots.map((each) => each.slot)).toContain("invoice.total");
    expect(slots.length).toBeGreaterThan(0);
  });
});
