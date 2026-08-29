// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own record, from the customer's side (MASTER.md §4.1, C8.10).
//
// Everything else the portal shell needs already exists and is reused rather
// than reimplemented: `auth.requestCustomerMagicLink` and `auth.login` for the
// two ways in, `auth.listSessions` / `auth.revokeSession` for devices,
// `i18n.setMyLocale` for language, `privacy.*` for consent. What did not exist
// is a way for a signed-in customer to read and correct their own details —
// `contacts.update` is the owner's tool and is scoped to staff.
//
// The rule these two services are built around: a customer may correct what
// the business knows about them, and may not become somebody else. Email is
// the spine's identity (§4.1), so it is readable here and not writable —
// changing it would silently fork or merge two people's histories.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";

const profile = row({
  contactId: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  preferredLocale: z.string().nullable(),
  hasPassword: z.boolean(),
  createdAt: timestamp,
});

/**
 * The contact behind the signed-in customer.
 *
 * A portal session is a `users` row; the person is a `contacts` row. Every
 * portal screen needs the join, and doing it in one place keeps a surface from
 * inventing its own idea of who is looking.
 */
async function contactForActor(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to see your details.");
  }
  const [found] = await ctx.tx
    .select()
    .from(contacts)
    .where(eq(contacts.userId, ctx.actor.userId))
    .limit(1);
  if (!found) {
    // A staff user with no contact row is not a customer. Saying so beats
    // rendering an empty portal that looks broken.
    throw new ServiceError("not_found", "This account has no customer record.");
  }
  return found;
}

export const myProfile = defineService({
  name: "portal.myProfile",
  summary: "The signed-in customer's own details.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: profile,
  handler: async (_input, ctx) => {
    const contact = await contactForActor(ctx);
    const { users } = await import("@/core/auth/schema");
    const [user] = await ctx.tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, contact.userId!))
      .limit(1);
    return {
      contactId: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      preferredLocale: contact.preferredLocale,
      // Whether they have one, never the hash. The portal offers "set a
      // password" or "change it" from this single fact.
      hasPassword: Boolean(user?.passwordHash),
      createdAt: contact.createdAt,
    };
  },
});

export const updateMyProfile = defineService({
  name: "portal.updateMyProfile",
  summary: "Correct your own name or phone number.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(40).nullish(),
  }),
  output: profile,
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    await ctx.tx
      .update(contacts)
      .set({
        name: input.name ?? contact.name,
        phone: input.phone === undefined ? contact.phone : (input.phone || null),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contact.id));
    ctx.setSubject("contact", contact.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.selfUpdated",
      subjectType: "contact",
      subjectId: contact.id,
    });
    return ctx.call(myProfile, {});
  },
});


/* -------------------------------------------------------------- the rooms */

const portalRecord = row({
  id: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  at: z.date().nullable(),
  href: z.string().nullable(),
  amountMinor: z.number().int().nullish(),
  currency: z.string().nullish(),
});

const portalRoom = row({
  key: z.string(),
  count: z.number().int(),
  records: z.array(portalRecord),
  /**
   * True when the room could not be read.
   *
   * Not decoration. The first draft caught the loader's error and returned
   * an empty room, and an empty room is indistinguishable from a room with
   * nothing in it — so a permission bug looked exactly like a customer with
   * no quotes, and the feature appeared to work. One module failing still
   * must not take the portal down, but it must not pass for good news.
   */
  failed: z.boolean(),
});

/**
 * Every room a module has claimed, for the signed-in customer (C8.11).
 *
 * The contact is resolved from the session and never taken from the input —
 * there is no parameter to point at somebody else, which is the shape that
 * cannot be misused rather than the shape that checks whether it was.
 *
 * Each room's loader calls the module's own admin query with that contact id,
 * because C8.11 asks for "the same services as admin" and those services
 * already take a `contactId`: an owner asking "what does this person have?"
 * and a customer asking it about themselves are the identical query.
 */
export const myRecords = defineService({
  name: "portal.myRecords",
  summary: "Everything the signed-in customer has with this business.",
  kind: "query",
  permission: "authenticated",
  input: z.object({
    /** One room, or every room when absent. */
    section: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(portalRoom),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    const { portalSection, portalSections } = await import("./sections");

    const wanted = input.section
      ? [portalSection(input.section)].filter((s) => s !== null)
      : [...portalSections()];

    const rooms = [];
    for (const section of wanted) {
      // A module whose loader throws must not take the whole portal down with
      // it: the customer's other records are still true, and an empty room is
      // a smaller failure than a page that will not render.
      let records: Awaited<ReturnType<typeof section.load>> = [];
      let failed = false;
      try {
        records = await section.load(ctx, contact.id, input.limit);
      } catch {
        failed = true;
      }
      rooms.push({ key: section.key, count: records.length, records, failed });
    }
    return rooms;
  },
});

export default [myProfile, updateMyProfile, myRecords];
