// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who may book, when, and for what (MASTER.md §41, C6.05).
//
// The question this answers is §41's: "can this person book me at 8pm on
// Sunday?" — one lookup and one union, and the same engine answers it for a
// customer and for a brother-in-law with different results.
//
// Membership is proved, never asserted. A caller says which audience they
// think they are in and offers whatever proof that audience requires; the
// proof is checked here, and an unproved claim falls back to the public
// audience rather than to the one that was asked for. That direction matters:
// the failure mode of guessing generously is a tokenised link that stops
// meaning anything.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import { violates } from "@/core/db/errors";
import { contacts } from "@/core/contacts/schema";
import { calendars } from "@/core/scheduling/schema";
import {
  bookingAudiences,
  bookingAudienceCalendars,
  bookingAudienceHours,
  bookingAudienceServices,
  AUDIENCE_HOURS,
  AUDIENCE_WHO,
} from "@/core/scheduling/audience-schema";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";
import type { Database } from "@/core/db";

/**
 * A handle that can run a query — a transaction, or the pool itself.
 *
 * Both readers below are pure reads, and both are legitimately called from
 * inside a mutation and from outside one. Naming the union is cheaper than
 * making a caller open a transaction it does not need.
 */
type Queryable = Tx | Database;

const clock = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time is written as HH:MM on a 24-hour clock.");

const audienceRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  who: z.enum(AUDIENCE_WHO),
  /** Never the token itself in a list; see `audiences.link`. */
  hasToken: z.boolean(),
  contactTag: z.string().nullable(),
  hours: z.enum(AUDIENCE_HOURS),
  minNoticeMin: z.number().int().nullable(),
  bookingHorizonDays: z.number().int().nullable(),
  bufferBeforeMin: z.number().int().nullable(),
  bufferAfterMin: z.number().int().nullable(),
  enabled: z.boolean(),
  position: z.number().int(),
});

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage who can book you.");
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "audience"
  );
}

export interface ResolvedAudience {
  id: string;
  name: string;
  who: (typeof AUDIENCE_WHO)[number];
  hours: (typeof AUDIENCE_HOURS)[number];
  minNoticeMin: number | null;
  bookingHorizonDays: number | null;
  bufferBeforeMin: number | null;
  bufferAfterMin: number | null;
  customHours: { weekday: number; starts: string; ends: string }[];
  calendarIds: string[];
}

/**
 * Which audience a caller is actually in.
 *
 * Ordered by the owner's own `position`, so "friends and family" can be found
 * before "customers" when somebody is in both. A caller who proves nothing
 * lands in the first enabled public audience, or in none at all — which is a
 * site that takes no public bookings, and is a legitimate configuration rather
 * than a misconfiguration to paper over.
 */
export async function audienceFor(
  tx: Queryable,
  input: { token?: string | null; contactId?: string | null; signedIn?: boolean },
): Promise<ResolvedAudience | null> {
  const candidates = await tx
    .select()
    .from(bookingAudiences)
    .where(eq(bookingAudiences.enabled, true))
    .orderBy(asc(bookingAudiences.position), asc(bookingAudiences.name));

  const tags = input.contactId
    ? ((
        await tx
          .select({ tags: contacts.tags })
          .from(contacts)
          .where(eq(contacts.id, input.contactId))
          .limit(1)
      )[0]?.tags ?? [])
    : [];

  for (const candidate of candidates) {
    const proved =
      candidate.who === "public" ||
      (candidate.who === "token" &&
        Boolean(input.token) &&
        candidate.token === input.token) ||
      (candidate.who === "tag" &&
        Boolean(candidate.contactTag) &&
        tags.includes(candidate.contactTag!)) ||
      (candidate.who === "signed_in" && (input.signedIn === true || Boolean(input.contactId)));
    if (!proved) continue;

    const [hours, written] = await Promise.all([
      candidate.hours === "custom"
        ? tx
            .select({
              weekday: bookingAudienceHours.weekday,
              starts: bookingAudienceHours.starts,
              ends: bookingAudienceHours.ends,
            })
            .from(bookingAudienceHours)
            .where(eq(bookingAudienceHours.audienceId, candidate.id))
        : Promise.resolve([]),
      tx
        .select({ calendarId: bookingAudienceCalendars.calendarId })
        .from(bookingAudienceCalendars)
        .where(eq(bookingAudienceCalendars.audienceId, candidate.id)),
    ]);

    return {
      id: candidate.id,
      name: candidate.name,
      who: candidate.who,
      hours: candidate.hours,
      minNoticeMin: candidate.minNoticeMin,
      bookingHorizonDays: candidate.bookingHorizonDays,
      bufferBeforeMin: candidate.bufferBeforeMin,
      bufferAfterMin: candidate.bufferAfterMin,
      customHours: hours.map((rule) => ({
        weekday: rule.weekday,
        starts: rule.starts,
        ends: rule.ends,
      })),
      calendarIds: written.map((row) => row.calendarId),
    };
  }
  return null;
}

/** Whether this audience may book this service at all. */
export async function audienceMayBook(
  tx: Queryable,
  audienceId: string,
  serviceOfferingId: string,
): Promise<boolean> {
  const [allowed] = await tx
    .select({ id: bookingAudienceServices.id })
    .from(bookingAudienceServices)
    .where(
      and(
        eq(bookingAudienceServices.audienceId, audienceId),
        eq(bookingAudienceServices.serviceOfferingId, serviceOfferingId),
      ),
    )
    .limit(1);
  // No rows means none. An audience given nothing to book books nothing —
  // the alternative default hands a tokenised link the whole catalogue the
  // first time somebody forgets to fill it in.
  return Boolean(allowed);
}

export const listAudiences = defineService({
  name: "audiences.list",
  summary: "Who can book you, and on what terms.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(audienceRow),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx
      .select()
      .from(bookingAudiences)
      .orderBy(asc(bookingAudiences.position), asc(bookingAudiences.name));
    // The token is a credential. It is handed over once, deliberately, by
    // `audiences.link` — never scattered through a list an admin screen logs.
    return rows.map(({ token, ...rest }) => ({ ...rest, hasToken: Boolean(token) }));
  },
});

export const createAudience = defineService({
  name: "audiences.create",
  summary: "Say that a group of people can book you, and how they prove it.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    who: z.enum(AUDIENCE_WHO).default("public"),
    contactTag: z.string().trim().min(1).max(80).nullish(),
    hours: z.enum(AUDIENCE_HOURS).default("calendar"),
    minNoticeMin: z.number().int().min(0).max(43_200).nullish(),
    bookingHorizonDays: z.number().int().min(1).max(1_095).nullish(),
    bufferBeforeMin: z.number().int().min(0).max(600).nullish(),
    bufferAfterMin: z.number().int().min(0).max(600).nullish(),
    position: z.number().int().min(0).max(1_000).default(0),
  }),
  output: audienceRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.who === "tag" && !input.contactTag) {
      // Said in words before the database says it as a violated check: a tag
      // audience with no tag is one everybody is in.
      throw new ServiceError(
        "validation",
        "A tagged audience needs the tag that proves somebody is in it.",
      );
    }
    if (input.who !== "tag" && input.contactTag) {
      throw new ServiceError(
        "validation",
        "Only a tagged audience uses a tag. Choose how people prove they belong.",
      );
    }

    const [created] = await ctx.tx
      .insert(bookingAudiences)
      .values({
        name: input.name,
        slug: slugify(input.name),
        who: input.who,
        // Generated here rather than asked for: a link somebody chose is a
        // link somebody can guess.
        token: input.who === "token" ? randomBytes(24).toString("base64url") : null,
        contactTag: input.contactTag ?? null,
        hours: input.hours,
        minNoticeMin: input.minNoticeMin ?? null,
        bookingHorizonDays: input.bookingHorizonDays ?? null,
        bufferBeforeMin: input.bufferBeforeMin ?? null,
        bufferAfterMin: input.bufferAfterMin ?? null,
        position: input.position,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "booking_audiences_slug_idx")) {
          throw new ServiceError("conflict", "An audience already uses that name.");
        }
        throw error;
      });

    ctx.setSubject("booking_audience", created!.id);
    ctx.queueEvent("audience.created", { id: created!.id, who: created!.who });
    const { token, ...rest } = created!;
    return { ...rest, hasToken: Boolean(token) };
  },
});

export const audienceLink = defineService({
  name: "audiences.link",
  summary: "The tokenised link for an audience, handed over once.",
  kind: "query",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, token: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [audience] = await ctx.tx
      .select({ id: bookingAudiences.id, token: bookingAudiences.token })
      .from(bookingAudiences)
      .where(eq(bookingAudiences.id, input.id))
      .limit(1);
    if (!audience) throw new ServiceError("not_found", "No such audience.");
    if (!audience.token) {
      throw new ServiceError(
        "conflict",
        "That audience is not reached by a link. Change how people prove they belong first.",
      );
    }
    ctx.setSubject("booking_audience", audience.id);
    return { id: audience.id, token: audience.token };
  },
});

export const rotateAudienceLink = defineService({
  name: "audiences.rotateLink",
  summary: "Issue a new link and stop the old one working.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, token: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Revoking is rotating one column, which is the whole reason the token is
    // stored rather than derived from the audience's id.
    const [rotated] = await ctx.tx
      .update(bookingAudiences)
      .set({ token: randomBytes(24).toString("base64url"), updatedAt: sql`now()` })
      .where(and(eq(bookingAudiences.id, input.id), eq(bookingAudiences.who, "token")))
      .returning({ id: bookingAudiences.id, token: bookingAudiences.token });
    if (!rotated) {
      throw new ServiceError("not_found", "No such audience reached by a link.");
    }
    ctx.setSubject("booking_audience", rotated.id);
    ctx.queueEvent("audience.linkRotated", { id: rotated.id });
    return { id: rotated.id, token: rotated.token! };
  },
});

export const setAudienceServices = defineService({
  name: "audiences.setServices",
  summary: "Say which services an audience may book.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    id: z.uuid(),
    serviceOfferingIds: z.array(z.uuid()).max(200),
  }),
  output: z.object({ id: uuid, services: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    await ctx.tx
      .delete(bookingAudienceServices)
      .where(eq(bookingAudienceServices.audienceId, input.id));
    if (input.serviceOfferingIds.length > 0) {
      await ctx.tx.insert(bookingAudienceServices).values(
        [...new Set(input.serviceOfferingIds)].map((serviceOfferingId) => ({
          audienceId: input.id,
          serviceOfferingId,
        })),
      );
    }
    ctx.setSubject("booking_audience", input.id);
    return { id: input.id, services: new Set(input.serviceOfferingIds).size };
  },
});

export const setAudienceCalendars = defineService({
  name: "audiences.setCalendars",
  summary: "Say which calendars this audience's bookings are written to.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid(), calendarIds: z.array(z.uuid()).max(50) }),
  output: z.object({ id: uuid, calendars: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    for (const calendarId of input.calendarIds) {
      const [calendar] = await ctx.tx
        .select({ id: calendars.id, status: calendars.status })
        .from(calendars)
        .where(eq(calendars.id, calendarId))
        .limit(1);
      if (!calendar) throw new ServiceError("validation", "No such calendar.");
      if (calendar.status !== "active") {
        throw new ServiceError("conflict", "An archived calendar takes no new bookings.");
      }
    }
    await ctx.tx
      .delete(bookingAudienceCalendars)
      .where(eq(bookingAudienceCalendars.audienceId, input.id));
    if (input.calendarIds.length > 0) {
      await ctx.tx.insert(bookingAudienceCalendars).values(
        [...new Set(input.calendarIds)].map((calendarId) => ({
          audienceId: input.id,
          calendarId,
        })),
      );
    }
    ctx.setSubject("booking_audience", input.id);
    return { id: input.id, calendars: new Set(input.calendarIds).size };
  },
});

export const setAudienceHours = defineService({
  name: "audiences.setHours",
  summary: "Set the hours that apply to one audience.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    id: z.uuid(),
    hours: z.enum(AUDIENCE_HOURS),
    rules: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          starts: clock,
          ends: clock,
        }),
      )
      .max(50)
      .default([]),
  }),
  output: z.object({ id: uuid, hours: z.enum(AUDIENCE_HOURS), rules: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.hours === "custom" && input.rules.length === 0) {
      throw new ServiceError(
        "validation",
        "Custom hours need at least one window, or this audience can never book.",
      );
    }
    for (const rule of input.rules) {
      if (rule.ends <= rule.starts) {
        throw new ServiceError(
          "validation",
          "Hours end after they start. Split a window that runs past midnight into two.",
        );
      }
    }

    await ctx.tx
      .update(bookingAudiences)
      .set({ hours: input.hours, updatedAt: sql`now()` })
      .where(eq(bookingAudiences.id, input.id));
    await ctx.tx
      .delete(bookingAudienceHours)
      .where(eq(bookingAudienceHours.audienceId, input.id));
    if (input.hours === "custom") {
      await ctx.tx.insert(bookingAudienceHours).values(
        input.rules.map((rule) => ({
          audienceId: input.id,
          weekday: rule.weekday,
          starts: rule.starts,
          ends: rule.ends,
        })),
      );
    }

    ctx.setSubject("booking_audience", input.id);
    ctx.queueEvent("audience.hoursChanged", { id: input.id, hours: input.hours });
    return {
      id: input.id,
      hours: input.hours,
      rules: input.hours === "custom" ? input.rules.length : 0,
    };
  },
});

export const removeAudience = defineService({
  name: "audiences.remove",
  summary: "Stop a group of people being able to book.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Bookings already made are untouched: they are appointments somebody has
    // in their diary, not a consequence of the audience still existing.
    const [removed] = await ctx.tx
      .delete(bookingAudiences)
      .where(eq(bookingAudiences.id, input.id))
      .returning({ id: bookingAudiences.id });
    if (!removed) throw new ServiceError("not_found", "No such audience.");
    ctx.setSubject("booking_audience", input.id);
    ctx.queueEvent("audience.removed", { id: input.id });
    return removed;
  },
});

export default [
  listAudiences,
  createAudience,
  audienceLink,
  rotateAudienceLink,
  setAudienceServices,
  setAudienceCalendars,
  setAudienceHours,
  removeAudience,
];
