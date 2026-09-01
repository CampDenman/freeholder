// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popups: composing them, deciding them, and counting them (§36, C9.30).
//
// Three decisions run through this file, and each of them is somewhere a
// popup module usually goes wrong.
//
// **The cap is enforced, not recorded.** A stored cap nothing reads is a
// defect wearing the costume of a feature. `decide` is the only path to the
// public surface and it refuses on the cap before it returns anything, so
// there is no route by which a capped popup can be shown a fourth time.
//
// **"Who" is `segments.contains` and nothing else.** §30 makes a segment the
// unit of who, and C7.17 made every surface adopt it. A popup asking "is this
// person a customer" through its own predicate would be the second answer to a
// question that already has one, and two answers is how somebody ends up in a
// campaign they were explicitly excluded from. The elevation is
// `ctx.callAsSystem`, because an anonymous visitor is entitled to the audience
// they belong to without being entitled to read segments.
//
// **Capture writes consent evidence through the same path everything else
// uses.** §36 is explicit: "newsletter capture wired to §30 consent records".
// When the popup names a newsletter, `newsletters.subscribe` runs and the
// double opt-in writes the record; when it does not, `contacts.recordConsent`
// writes it directly with the exact words the visitor was shown. There is no
// third consent model here, and the database refuses to hold a capture popup
// that has no words to show (see the check constraint in schema.ts).
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type Service,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource, recordConsent } from "@/core/privacy/service";
import { contacts } from "@/core/contacts/schema";
import { blockTreeSchema } from "@/modules/cms/blocks/registry";
import {
  a11yErrors,
  analyzeAccessibility,
  publishA11yMessage,
} from "@/modules/cms/a11y-hints";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  POPUP_AUDIENCES,
  POPUP_CAPTURES,
  POPUP_STATUSES,
  POPUP_SURFACES,
  POPUP_TRIGGERS,
  popupEvents,
  popups,
} from "./schema";
import {
  eligibleForEveryHistory,
  NO_HISTORY,
  type PopupHistory,
} from "./targeting";
import {
  entryFor,
  parseTally,
  recordCapturedInTally,
  recordDismissedInTally,
  recordShownInTally,
  serializeTally,
  type Tally,
} from "./tally";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

/** Owner-editable jsonb, read defensively wherever it is used. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

const popupRow = row({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  title: z.string(),
  surface: z.enum(POPUP_SURFACES),
  trigger: z.enum(POPUP_TRIGGERS),
  triggerValue: z.number().int(),
  blocks: z.unknown(),
  audience: z.enum(POPUP_AUDIENCES),
  segmentId: uuidSchema.nullable(),
  pathPatterns: z.unknown(),
  locales: z.unknown(),
  frequencyCap: z.number().int().nullable(),
  frequencyPeriodHours: z.number().int(),
  dismissSuppressHours: z.number().int(),
  stopAfterCapture: z.boolean(),
  captureMode: z.enum(POPUP_CAPTURES),
  newsletterId: uuidSchema.nullable(),
  consentStatement: z.string().nullable(),
  consentVersion: z.string().nullable(),
  successMessage: z.string().nullable(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  priority: z.number().int(),
  status: z.enum(POPUP_STATUSES),
});

/**
 * What the public surface is told, and nothing more.
 *
 * The same lesson `ads.slotByCode` learned: a projection is a decision about
 * disclosure, not a convenience. A visitor needs the words, the shape and what
 * makes it appear. They do not need to know which segment they were matched
 * against, how many times they are allowed to see it, or when the campaign
 * ends — and a public query that hands those over turns targeting into
 * something anyone can enumerate.
 */
const publicPopup = row({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  surface: z.enum(POPUP_SURFACES),
  trigger: z.enum(POPUP_TRIGGERS),
  triggerValue: z.number().int(),
  blocks: z.unknown(),
  captureMode: z.enum(POPUP_CAPTURES),
  consentStatement: z.string().nullable(),
  successMessage: z.string().nullable(),
});

/* ------------------------------------------------------------------ shared */

async function loadPopup(tx: Tx, id: string) {
  const [found] = await tx.select().from(popups).where(eq(popups.id, id)).limit(1);
  if (!found) throw new ServiceError("not_found", "That popup is not here.");
  return found;
}

/**
 * The contact behind the caller, when there is one.
 *
 * Derived from the actor rather than accepted as an input. `decide` is a
 * public query, and a `contactId` parameter on a public query is an invitation
 * to ask what somebody else's audience would have been shown.
 */
async function callerContactId(tx: Tx, actor: Actor): Promise<string | null> {
  if (actor.kind !== "user") return null;
  const [contact] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, actor.userId))
    .limit(1);
  return contact?.id ?? null;
}

/**
 * What the server remembers about this visitor and this popup.
 *
 * Returns nothing when there is no durable key, which is the honest answer:
 * an anonymous visitor with no analytics identifier has no server-side
 * history, and inventing an empty one that then *allows* the popup would be
 * the same bug as having no cap. The browser's own tally covers that case.
 *
 * Impressions are counted over a **rolling** window — the last `periodHours`,
 * measured from now — rather than from the first one ever recorded. That
 * distinction is the whole difference between a cap and a decoration: taking
 * the earliest impression as the window start means one view a year ago opens
 * a window that has long expired, and every view since rides free inside it.
 *
 * The browser's tally cannot do this (it stores a count, not a timestamp per
 * impression) so it uses a fixed window that resets. The two disagree slightly
 * at the edge, which is fine and deliberate: each is evaluated against its own
 * window and either may veto, so when both exist the stricter one governs.
 *
 * A dismissal and a capture are *not* windowed. They have their own horizons —
 * `dismissSuppressHours` and forever — and reading only recent ones would make
 * closing a popup expire silently while the owner's setting still said a
 * month.
 */
async function ledgerHistory(
  tx: Tx,
  popupId: string,
  visitorKey: string | null,
  contactId: string | null,
  periodHours: number,
  now: Date,
): Promise<PopupHistory | null> {
  const identity = [
    visitorKey ? eq(popupEvents.visitorKey, visitorKey) : undefined,
    contactId ? eq(popupEvents.contactId, contactId) : undefined,
  ].filter((clause) => clause !== undefined);
  if (identity.length === 0) return null;

  const rows = await tx
    .select({
      kind: popupEvents.kind,
      occurredAt: popupEvents.occurredAt,
    })
    .from(popupEvents)
    .where(and(eq(popupEvents.popupId, popupId), or(...identity)))
    .orderBy(asc(popupEvents.occurredAt));

  const windowOpened = new Date(now.getTime() - periodHours * 3_600_000);
  const shown = rows.filter(
    (each) => each.kind === "shown" && each.occurredAt >= windowOpened,
  );
  const last = <T extends { occurredAt: Date }>(list: T[]): Date | null =>
    list.length > 0 ? list[list.length - 1]!.occurredAt : null;
  return {
    seen: shown.length,
    windowStartedAt: shown[0]?.occurredAt ?? null,
    dismissedAt: last(rows.filter((each) => each.kind === "dismissed")),
    capturedAt: last(rows.filter((each) => each.kind === "captured")),
  };
}

/** The browser's own record, as the same shape. */
function tallyHistory(tally: Tally, popupId: string): PopupHistory | null {
  const entry = entryFor(tally, popupId);
  if (!entry) return null;
  return {
    seen: entry.seen,
    windowStartedAt: entry.windowStartedAt,
    dismissedAt: entry.dismissedAt,
    capturedAt: entry.capturedAt,
  };
}

/**
 * The audience, asked of the one thing that answers it (§30, C7.17).
 *
 * "Not in this segment" is the mode a popup actually needs — do not ask
 * somebody who is already on the list to join it — and it is the reason an
 * anonymous visitor is answered rather than skipped: nobody is a member of a
 * list of contacts, so an anonymous visitor is correctly *outside* every
 * segment, which is a real answer and not a missing one.
 */
async function audienceAllows(
  ctx: ServiceContext,
  popup: { audience: (typeof POPUP_AUDIENCES)[number]; segmentId: string | null },
  contactId: string | null,
): Promise<boolean> {
  if (popup.audience === "everyone") return true;
  if (!popup.segmentId) return false;
  if (!contactId) return popup.audience === "notInSegment";
  const result = (await ctx.callAsSystem(getService("segments.contains"), {
    id: popup.segmentId,
    contactId,
  })) as { member: boolean };
  return popup.audience === "inSegment" ? result.member : !result.member;
}

/* -------------------------------------------------------------- authoring */

export const listPopups = defineService({
  name: "popups.list",
  summary: "Every popup this instance has, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(POPUP_STATUSES).optional() }),
  output: listed(popupRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(popups)
      .where(input.status ? eq(popups.status, input.status) : undefined)
      .orderBy(desc(popups.priority), desc(popups.createdAt)),
});

export const getPopup = defineService({
  name: "popups.get",
  summary: "One popup, with its block tree.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: popupRow,
  handler: (input, ctx) => loadPopup(ctx.tx, input.id),
});

const saveInput = z
  .object({
    id: uuidSchema.optional(),
    slug,
    name: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(160),
    surface: z.enum(POPUP_SURFACES).default("modal"),
    trigger: z.enum(POPUP_TRIGGERS).default("delay"),
    triggerValue: z.number().int().min(0).max(600).default(5),
    audience: z.enum(POPUP_AUDIENCES).default("everyone"),
    segmentId: uuidSchema.nullish(),
    pathPatterns: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    locales: z.array(z.string().trim().min(2).max(35)).max(20).default([]),
    frequencyCap: z.number().int().min(1).max(100).nullish(),
    frequencyPeriodHours: z.number().int().min(1).max(8760).default(168),
    dismissSuppressHours: z.number().int().min(0).max(8760).default(720),
    stopAfterCapture: z.boolean().default(true),
    captureMode: z.enum(POPUP_CAPTURES).default("none"),
    newsletterId: uuidSchema.nullish(),
    // 500 rather than a rounder number: these exact words are copied into the
    // consent record as evidence, and `contacts.recordConsent` bounds an
    // evidence value at 500. A statement this refuses is better than one that
    // saves here and then fails a visitor at the moment they sign up.
    consentStatement: z.string().trim().max(500).nullish(),
    consentVersion: z.string().trim().max(60).nullish(),
    successMessage: z.string().trim().max(400).nullish(),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .superRefine((input, ctx) => {
    if (input.audience !== "everyone" && !input.segmentId) {
      ctx.addIssue({
        code: "custom",
        path: ["segmentId"],
        message: "Choose the group this rule is about, or show it to everyone.",
      });
    }
    // The database says the same thing, and says it last. This says it in a
    // sentence an owner can act on, beside the field they left empty.
    if (input.captureMode === "email" && !input.consentStatement) {
      ctx.addIssue({
        code: "custom",
        path: ["consentStatement"],
        message:
          "A popup that asks for an email address has to say what you will do with it. Those words become the consent record.",
      });
    }
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end has to come after the start.",
      });
    }
    if (input.trigger === "scroll" && (input.triggerValue < 1 || input.triggerValue > 100)) {
      ctx.addIssue({
        code: "custom",
        path: ["triggerValue"],
        message: "A scroll trigger is a percentage of the page, between 1 and 100.",
      });
    }
  });

export const savePopup = defineService({
  name: "popups.save",
  writeClass: "write",
  summary: "Create or change a popup's settings.",
  kind: "mutation",
  permission: "scoped",
  input: saveInput,
  output: popupRow,
  handler: async (input, ctx) => {
    const clash = await ctx.tx
      .select({ id: popups.id })
      .from(popups)
      .where(eq(popups.slug, input.slug));
    if (clash.some((each) => each.id !== input.id)) {
      throw new ServiceError(
        "conflict",
        `Another popup already uses "${input.slug}".`,
      );
    }

    const values = {
      slug: input.slug,
      name: input.name,
      title: input.title,
      surface: input.surface,
      trigger: input.trigger,
      triggerValue: input.triggerValue,
      audience: input.audience,
      segmentId: input.audience === "everyone" ? null : (input.segmentId ?? null),
      pathPatterns: input.pathPatterns,
      locales: input.locales,
      frequencyCap: input.frequencyCap ?? null,
      frequencyPeriodHours: input.frequencyPeriodHours,
      dismissSuppressHours: input.dismissSuppressHours,
      stopAfterCapture: input.stopAfterCapture,
      captureMode: input.captureMode,
      newsletterId: input.captureMode === "email" ? (input.newsletterId ?? null) : null,
      consentStatement: input.consentStatement ?? null,
      consentVersion: input.consentVersion ?? null,
      successMessage: input.successMessage ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priority: input.priority,
    };

    const [saved] = input.id
      ? await ctx.tx.update(popups).set(values).where(eq(popups.id, input.id)).returning()
      : await ctx.tx.insert(popups).values(values).returning();
    if (!saved) throw new ServiceError("not_found", "That popup is not here.");
    ctx.setSubject("popup", saved.id);
    ctx.queueEvent("popups.saved", { popupId: saved.id, slug: saved.slug });
    return saved;
  },
});

export const savePopupBlocks = defineService({
  name: "popups.saveBlocks",
  writeClass: "write",
  summary: "Replace a popup's block tree.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    // Stored as chrome, analysed as a popup — see the note on `A11yContext`.
    // Chrome is already the platform's answer to "blocks that are not the
    // page", so the popup gets that vocabulary without forty block
    // definitions having to learn a fourth word.
    blocks: blockTreeSchema("chrome"),
  }),
  output: popupRow,
  handler: async (input, ctx) => {
    const popup = await loadPopup(ctx.tx, input.id);
    const [saved] = await ctx.tx
      .update(popups)
      .set({ blocks: input.blocks })
      .where(eq(popups.id, popup.id))
      .returning();
    ctx.setSubject("popup", popup.id);
    return saved!;
  },
});

export const setPopupStatus = defineService({
  name: "popups.setStatus",
  writeClass: "write",
  summary: "Make a popup live, pause it, or take it back to draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema, status: z.enum(POPUP_STATUSES) }),
  output: popupRow,
  handler: async (input, ctx) => {
    const popup = await loadPopup(ctx.tx, input.id);

    // The same gate `publishPage` applies to a page, applied to the surface
    // that needs it more. A page with a broken heading order is a page nobody
    // asked to read badly; a modal that a keyboard cannot escape is an
    // obstruction the visitor did not choose. So going live is where it is
    // checked, and the message is the one the editor was already showing.
    if (input.status === "active") {
      const hints = analyzeAccessibility(popup.blocks as BlockNode[], {
        context: "popup",
      });
      const blocking = a11yErrors(hints);
      if (blocking.length > 0) {
        throw new ServiceError(
          "validation",
          publishA11yMessage(hints) ?? "This popup is not accessible enough to publish.",
        );
      }
    }

    const [saved] = await ctx.tx
      .update(popups)
      .set({ status: input.status })
      .where(eq(popups.id, popup.id))
      .returning();
    ctx.setSubject("popup", popup.id);
    ctx.queueEvent("popups.statusChanged", {
      popupId: popup.id,
      status: input.status,
    });
    return saved!;
  },
});

export const removePopup = defineService({
  name: "popups.remove",
  writeClass: "destructive",
  summary: "Delete a popup and everything recorded about it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const popup = await loadPopup(ctx.tx, input.id);
    await ctx.tx.delete(popups).where(eq(popups.id, popup.id));
    ctx.setSubject("popup", popup.id);
    return { ok: true as const };
  },
});

/* ---------------------------------------------------------------- deciding */

export const decidePopup = defineService({
  name: "popups.decide",
  summary: "Which popup, if any, this visitor should be offered here.",
  kind: "query",
  permission: "public",
  input: z.object({
    path: z.string().trim().max(2048).default("/"),
    locale: z.string().trim().min(2).max(35).default("en"),
    /** The first-party analytics visitor id, when this visitor has one. */
    visitorKey: z.string().trim().max(64).nullish(),
    /** The raw cap cookie. Parsed here so its encoding stays server-side. */
    tally: z.string().max(1024).nullish(),
  }),
  output: publicPopup.nullable(),
  handler: async (input, ctx) => {
    const now = new Date();
    const tally = parseTally(input.tally);
    const contactId = await callerContactId(ctx.tx, ctx.actor);

    // Highest priority first, then oldest: only one popup shows at a time,
    // because a page that stacks two modals has stopped being a page.
    const candidates = await ctx.tx
      .select()
      .from(popups)
      .where(eq(popups.status, "active"))
      .orderBy(desc(popups.priority), asc(popups.createdAt));

    for (const popup of candidates) {
      const rules = {
        pathPatterns: stringList(popup.pathPatterns),
        locales: stringList(popup.locales),
        startsAt: popup.startsAt,
        endsAt: popup.endsAt,
        frequencyCap: popup.frequencyCap,
        frequencyPeriodHours: popup.frequencyPeriodHours,
        dismissSuppressHours: popup.dismissSuppressHours,
        stopAfterCapture: popup.stopAfterCapture,
      };
      const context = { path: input.path, locale: input.locale };

      // Cheap and certain first: nothing below runs for a popup that does not
      // belong on this path in this language today.
      if (!eligibleForEveryHistory(rules, context, [NO_HISTORY], now)) continue;

      const histories = [
        await ledgerHistory(
          ctx.tx,
          popup.id,
          input.visitorKey ?? null,
          contactId,
          popup.frequencyPeriodHours,
          now,
        ),
        tallyHistory(tally, popup.id),
      ].filter((history): history is PopupHistory => history !== null);
      if (!eligibleForEveryHistory(rules, context, histories, now)) continue;

      if (!(await audienceAllows(ctx, popup, contactId))) continue;

      return {
        id: popup.id,
        slug: popup.slug,
        title: popup.title,
        surface: popup.surface,
        trigger: popup.trigger,
        triggerValue: popup.triggerValue,
        blocks: popup.blocks,
        captureMode: popup.captureMode,
        consentStatement: popup.consentStatement,
        successMessage: popup.successMessage,
      };
    }
    return null;
  },
});

/* --------------------------------------------------------------- recording */

const recordOutput = row({
  ok: z.literal(true),
  /** The visitor's updated cap cookie, for the caller to set. */
  tally: z.string(),
});

export const recordPopupEvent = defineService({
  name: "popups.record",
  writeClass: "write",
  summary: "Record that a popup was actually shown, or closed, for one visitor.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    popupId: uuidSchema,
    kind: z.enum(["shown", "dismissed"]),
    path: z.string().trim().max(2048).nullish(),
    visitorKey: z.string().trim().max(64).nullish(),
    tally: z.string().max(1024).nullish(),
  }),
  // A public write needs a ceiling that does not depend on anybody being
  // signed in. Per popup rather than per visitor, for the same reason
  // `forms.submit` is: an anonymous surface has no trustworthy identity to
  // key on. The number is generous — a site turning over ten popup
  // impressions a second is not the business this platform is for — and the
  // point of it is to bound a script, not to shape traffic.
  rateLimit: {
    limit: 600,
    windowSeconds: 60,
    subject: (input) => `popup:${input.popupId}`,
    message: "This popup has been reported a lot just now. Try again shortly.",
  },
  output: recordOutput,
  handler: async (input, ctx) => {
    const popup = await loadPopup(ctx.tx, input.popupId);
    const now = new Date();
    const contactId = await callerContactId(ctx.tx, ctx.actor);

    await ctx.tx.insert(popupEvents).values({
      popupId: popup.id,
      visitorKey: input.visitorKey ?? null,
      contactId,
      kind: input.kind,
      path: input.path ?? null,
      occurredAt: now,
    });
    ctx.setSubject("popup", popup.id);

    const tally = parseTally(input.tally);
    const updated =
      input.kind === "shown"
        ? recordShownInTally(tally, popup.id, popup.frequencyPeriodHours, now)
        : recordDismissedInTally(tally, popup.id, now);
    return { ok: true as const, tally: serializeTally(updated) };
  },
});

/* ----------------------------------------------------------------- capture */

/**
 * The newsletter path, if this instance still has one.
 *
 * Resolved rather than imported: newsletters is a module, and a popup that
 * only announces opening hours must not drag it in. The lookup touches no
 * database, so catching its refusal is safe — a caught SQL error would have
 * already aborted the transaction, and that trap is why this is done here
 * rather than around the call itself.
 */
function newsletterSubscribeService(): Service | null {
  try {
    return getService("newsletters.subscribe");
  } catch {
    return null;
  }
}

export const capturePopup = defineService({
  name: "popups.capture",
  writeClass: "write",
  summary: "Take an email address from a popup, with its consent evidence.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    popupId: uuidSchema,
    email: z.string().trim().email().toLowerCase(),
    /** The tick box. Unticked is a refusal, and a refusal is not a capture. */
    consent: z.boolean(),
    path: z.string().trim().max(2048).nullish(),
    visitorKey: z.string().trim().max(64).nullish(),
    tally: z.string().max(1024).nullish(),
  }),
  rateLimit: {
    limit: 30,
    windowSeconds: 10 * 60,
    subject: (input) => `popup-capture:${input.popupId}`,
    message: "This popup has taken a lot of sign-ups just now. Try again shortly.",
  },
  output: row({
    ok: z.literal(true),
    message: z.string(),
    /** True when the address still has a confirmation email to answer. */
    pending: z.boolean(),
    tally: z.string(),
  }),
  handler: async (input, ctx) => {
    const popup = await loadPopup(ctx.tx, input.popupId);
    if (popup.status !== "active") {
      throw new ServiceError("not_found", "This popup is no longer running.");
    }
    if (popup.captureMode !== "email") {
      throw new ServiceError("validation", "This popup does not collect addresses.");
    }
    if (!input.consent) {
      throw new ServiceError(
        "validation",
        "Tick the box to say yes before sending your address.",
      );
    }
    const now = new Date();

    // §4.1's identity rule on an anonymous path: `resolve`, never `create`,
    // because a returning visitor is the same person. `callAsSystem` because
    // they are allowed to identify themselves and nothing more.
    const resolved = await ctx.callAsSystem(resolveContact, {
      email: input.email,
      source: `popup:${popup.slug}`,
    });
    const contactId = resolved.contact.id;

    // The consent record, written once, by whichever path actually collected
    // it. Naming a newsletter means a double opt-in, and the confirmation
    // link is the moment consent exists — writing "granted" here as well
    // would contradict the email that has not been answered yet.
    const subscribe = popup.newsletterId ? newsletterSubscribeService() : null;
    let pending = false;
    if (popup.newsletterId && subscribe) {
      const result = (await ctx.callAsSystem(subscribe, {
        newsletterId: popup.newsletterId,
        email: input.email,
      })) as { status: "confirmed" | "pending" };
      pending = result.status === "pending";
    } else {
      await ctx.callAsSystem(recordConsent, {
        contactId,
        purpose: "marketing" as const,
        channel: "email" as const,
        state: "granted" as const,
        method: "form" as const,
        // The words they were actually shown, so the evidence can be read
        // back against the version of the statement that was on screen.
        termsVersion: popup.consentVersion ?? popup.slug,
        sourceUrl: input.path ?? null,
        evidence: { popup: popup.slug, statement: popup.consentStatement ?? "" },
      });
    }

    await ctx.tx.insert(popupEvents).values({
      popupId: popup.id,
      visitorKey: input.visitorKey ?? null,
      contactId,
      kind: "captured",
      path: input.path ?? null,
      occurredAt: now,
    });

    ctx.setSubject("popup", popup.id);
    await ctx.emitTimeline({
      contactId,
      eventType: "popup.captured",
      subjectType: "popup",
      subjectId: popup.id,
      payload: { popup: popup.slug, name: popup.name },
    });
    ctx.queueEvent("popups.captured", { popupId: popup.id, contactId });

    return {
      ok: true as const,
      message:
        popup.successMessage ??
        (pending
          ? "Almost there — check your email and confirm."
          : "Thank you. You are on the list."),
      pending,
      tally: serializeTally(recordCapturedInTally(parseTally(input.tally), popup.id, now)),
    };
  },
});

/* ------------------------------------------------------------- performance */

export const popupPerformance = defineService({
  name: "popups.performance",
  summary: "How each popup has done: shown, closed, and addresses collected.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    /** Zero means everything ever recorded. */
    sinceDays: z.number().int().min(0).max(3650).default(30),
    popupId: uuidSchema.optional(),
  }),
  output: listed(
    row({
      popupId: uuidSchema,
      shown: z.number().int(),
      dismissed: z.number().int(),
      captured: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const since =
      input.sinceDays === 0
        ? null
        : new Date(Date.now() - input.sinceDays * 86_400_000);
    const rows = await ctx.tx
      .select({
        popupId: popupEvents.popupId,
        kind: popupEvents.kind,
        total: sql<number>`count(*)::int`,
      })
      .from(popupEvents)
      .where(
        and(
          input.popupId ? eq(popupEvents.popupId, input.popupId) : undefined,
          since ? gte(popupEvents.occurredAt, since) : undefined,
        ),
      )
      .groupBy(popupEvents.popupId, popupEvents.kind);

    const byPopup = new Map<string, { shown: number; dismissed: number; captured: number }>();
    for (const each of rows) {
      const bucket = byPopup.get(each.popupId) ?? { shown: 0, dismissed: 0, captured: 0 };
      bucket[each.kind] = each.total;
      byPopup.set(each.popupId, bucket);
    }
    return [...byPopup.entries()].map(([popupId, counts]) => ({ popupId, ...counts }));
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "popup_events",
  // No unique constraint involves `contact_id` here, so a merge is the simple
  // case: the survivor inherits both people's history, which is what an owner
  // means when they say two records were one person all along. The cap then
  // reads the combined history, which is the conservative direction.
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(popupEvents)
      .set({ contactId: survivingId })
      .where(eq(popupEvents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: popupEvents.id })
      .from(popupEvents)
      .where(eq(popupEvents.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = (beforeState as Array<{ id: string }>) ?? [];
    if (rows.length === 0) return;
    await tx
      .update(popupEvents)
      .set({ contactId: duplicateId })
      .where(
        inArray(
          popupEvents.id,
          rows.map((each) => each.id),
        ),
      );
  },
});

registerContactPrivacySource({
  scope: "contact.popups",
  tables: ["popup_events"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(popupEvents)
      .where(eq(popupEvents.contactId, contactId))
      .orderBy(asc(popupEvents.occurredAt)),
  erase: async (tx, contactId) => {
    // The person goes; the count stays. Both identifiers are cleared, which
    // leaves a row that says "this popup was shown once" and can never be
    // traced back — so an erasure does not quietly rewrite the owner's history
    // of how a campaign performed, and does not leave a visitor key behind
    // that would keep capping somebody the platform has agreed to forget.
    const rows = await tx
      .update(popupEvents)
      .set({ contactId: null, visitorKey: null })
      .where(eq(popupEvents.contactId, contactId))
      .returning({ id: popupEvents.id });
    return { affected: rows.length };
  },
});

export default [
  listPopups,
  getPopup,
  savePopup,
  savePopupBlocks,
  setPopupStatus,
  removePopup,
  decidePopup,
  recordPopupEvent,
  capturePopup,
  popupPerformance,
];
