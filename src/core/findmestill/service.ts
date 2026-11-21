// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.01, C6.19, C7.08: local desk grants and canonical booking checks.
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getContact } from "@/core/contacts/service";
import { isForeignKeyViolation } from "@/core/db";
import { getBooking } from "@/core/scheduling/bookings";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { findMeStillContactId, selectFindMeStillDiscovery } from "./discovery";
import { findMeStillDeskGrants, findMeStillDesks } from "./schema";

const identityInput = z.object({ identity: findMeStillContactId });
const deskOutput = z.object({ identity: findMeStillContactId, revision: z.int().positive() });

function signedInUser(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in as a person to use this desk.");
  return ctx.actor.userId;
}

async function grantedDesk(ctx: ServiceContext, identity: string) {
  const userId = signedInUser(ctx);
  const [desk] = await ctx.tx.select({ compactJws: findMeStillDesks.compactJws })
    .from(findMeStillDesks)
    .innerJoin(findMeStillDeskGrants, eq(findMeStillDesks.identity, findMeStillDeskGrants.identity))
    .where(and(eq(findMeStillDesks.identity, identity), eq(findMeStillDeskGrants.userId, userId),
      or(isNull(findMeStillDeskGrants.expiresAt), gt(findMeStillDeskGrants.expiresAt, sql`now()`))));
  if (!desk) throw new ServiceError("not_found", "That desk is not available.");
  return desk;
}

function selectCard(identity: string, documents: readonly Uint8Array[], pinnedJws?: string) {
  try {
    return selectFindMeStillDiscovery(documents, { now: Math.floor(Date.now() / 1_000), contactId: identity, pinnedJws });
  } catch {
    throw new ServiceError("validation", "FindMeStill discovery could not verify a current, consistent card.");
  }
}

export const pinFindMeStillDesk = defineService({
  name: "findMeStill.pinDesk",
  summary: "Save a desk from publicly retrieved FindMeStill discovery documents.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  agentCallable: false,
  stepUp: true,
  writeClass: "write",
  input: identityInput.extend({ documents: z.array(z.string().max(262_144)).min(1).max(3) }).strict(),
  output: deskOutput,
  auditInputFields: ["identity"],
  handler: async ({ identity, documents }, ctx) => {
    signedInUser(ctx);
    // Serialize first-save and refresh for this identity, including when no pin exists yet.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`findmestill-desk:${identity}`}, 0))`);
    const [saved] = await ctx.tx.select({ compactJws: findMeStillDesks.compactJws })
      .from(findMeStillDesks).where(eq(findMeStillDesks.identity, identity));
    const card = selectCard(identity, documents.map((document) => Buffer.from(document)), saved?.compactJws);
    if (card.compactJws !== saved?.compactJws) {
      await ctx.tx.insert(findMeStillDesks).values({ identity, compactJws: card.compactJws }).onConflictDoUpdate({
        target: findMeStillDesks.identity, set: { compactJws: card.compactJws },
      });
    }
    ctx.setSubject("findmestill_desk", identity);
    return { identity, revision: card.revision };
  },
});

export const setFindMeStillDeskGrant = defineService({
  name: "findMeStill.setDeskGrant",
  summary: "Grant or revoke one local account's access to a FindMeStill desk.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  agentCallable: false,
  stepUp: true,
  writeClass: "write",
  input: identityInput.extend({
    userId: z.uuid(),
    grant: z.object({ expiresAt: z.iso.datetime().nullable() }).strict().nullable(),
  }).strict(),
  output: z.object({ granted: z.boolean() }),
  handler: async ({ identity, userId, grant }, ctx) => {
    signedInUser(ctx);
    if (grant) {
      const expiresAt = grant.expiresAt === null ? null : new Date(grant.expiresAt);
      if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
        throw new ServiceError("validation", "Choose a future desk grant expiry.");
      }
      await ctx.tx.insert(findMeStillDeskGrants).values({ identity, userId, expiresAt }).onConflictDoUpdate({
        target: [findMeStillDeskGrants.identity, findMeStillDeskGrants.userId], set: { expiresAt },
      }).catch((error: unknown) => {
        if (isForeignKeyViolation(error)) throw new ServiceError("not_found", "That desk or local account is not available.");
        throw error;
      });
    } else {
      await ctx.tx.delete(findMeStillDeskGrants).where(and(eq(findMeStillDeskGrants.identity, identity), eq(findMeStillDeskGrants.userId, userId)));
    }
    ctx.setSubject("findmestill_desk", identity);
    return { granted: grant !== null };
  },
});

export const getFindMeStillDesk = defineService({
  name: "findMeStill.getDesk",
  summary: "Open the metadata for one explicitly granted FindMeStill desk.",
  kind: "query",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  input: identityInput.strict(),
  output: deskOutput,
  handler: async ({ identity }, ctx) => {
    const desk = await grantedDesk(ctx, identity);
    return { identity, revision: selectCard(identity, [], desk.compactJws).revision };
  },
});

export const checkFindMeStillBookingLink = defineService({
  name: "findMeStill.checkBookingLink",
  summary: "Check a proposed booking and customer link for an explicitly granted desk.",
  kind: "query",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  input: identityInput.extend({ contactId: z.uuid(), bookingId: z.uuid() }).strict(),
  output: z.object({ contactId: z.uuid(), bookingId: z.uuid() }),
  handler: async ({ identity, contactId, bookingId }, ctx) => {
    await grantedDesk(ctx, identity);
    // The ordinary services still see the original actor. The desk grant adds no CRM or booking authority.
    const contact = await ctx.call(getContact, { id: contactId });
    const booking = await ctx.call(getBooking, { id: bookingId });
    if (!contact || booking?.contactId !== contact.id) throw new ServiceError("not_found", "That booking link is not available.");
    return { contactId, bookingId };
  },
});

export default [pinFindMeStillDesk, setFindMeStillDeskGrant, getFindMeStillDesk, checkFindMeStillBookingLink];
