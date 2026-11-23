// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.01, C6.19, C7.08: local desk grants and canonical booking checks.
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { getContact } from "@/core/contacts/service";
import { isForeignKeyViolation } from "@/core/db";
import { env } from "@/core/env";
import { getBooking } from "@/core/scheduling/bookings";
import { defineService, hasModuleAccess, ServiceError, type ServiceContext } from "@/core/service";
import { checkFindMeStillDiscovery, findMeStillContactId, inspectFindMeStillPin, verifyFindMeStillDocument } from "./discovery";
import { findMeStillCustomerLinks, findMeStillDeskGrants, findMeStillDesks } from "./schema";
import "./customer-links";

const identityInput = z.object({ identity: findMeStillContactId });
const deskOutput = z.object({ identity: findMeStillContactId, revision: z.int().positive() });
const pinResult = deskOutput.extend({ saveStatus: z.enum(["saved", "confirmed", "retained"]) });
const coreCardDocument = z.string().min(1).max(262_144);
const currentTime = () => Math.floor(Date.now() / 1_000);

export function findMeStillPublicationUrl(identity: string): string {
  return new URL(`/api/findmestill/discovery/${identity}`, env().APP_URL).href;
}

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
    return checkFindMeStillDiscovery(documents, { now: currentTime(), contactId: identity, pinnedJws });
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
  input: identityInput.extend({ documents: z.array(coreCardDocument).min(1).max(3) }).strict(),
  output: pinResult,
  auditInputFields: ["identity"],
  handler: async ({ identity, documents }, ctx) => {
    signedInUser(ctx);
    // Serialize first-save and refresh for this identity, including when no pin exists yet.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`findmestill-desk:${identity}`}, 0))`);
    const [saved] = await ctx.tx.select({ compactJws: findMeStillDesks.compactJws })
      .from(findMeStillDesks).where(eq(findMeStillDesks.identity, identity));
    const { card, confirmed } = selectCard(identity, documents.map((document) => Buffer.from(document)), saved?.compactJws);
    const changed = card.compactJws !== saved?.compactJws;
    if (changed) {
      await ctx.tx.insert(findMeStillDesks).values({ identity, compactJws: card.compactJws }).onConflictDoUpdate({
        target: findMeStillDesks.identity, set: { compactJws: card.compactJws },
      });
    }
    ctx.setSubject("findmestill_desk", identity);
    const saveStatus = changed ? "saved" : confirmed ? "confirmed" : "retained";
    return { identity, revision: card.revision, saveStatus };
  },
});

export const publishFindMeStillDesk = defineService({
  name: "findMeStill.publishDesk",
  summary: "Publish one explicitly approved signed desk document at this site's discovery URL.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  agentCallable: false,
  stepUp: true,
  writeClass: "write",
  input: identityInput.extend({ document: coreCardDocument }).strict(),
  output: deskOutput,
  auditInputFields: ["identity"],
  handler: async ({ identity, document }, ctx) => {
    signedInUser(ctx);
    const now = currentTime();
    let head;
    try {
      head = verifyFindMeStillDocument(Buffer.from(document), identity, now).at(-1);
    } catch {
      throw new ServiceError("validation", "The signed document could not be verified.");
    }
    if (!head || head.expiresAt <= now || head.primaryCardUrl !== findMeStillPublicationUrl(identity)) {
      throw new ServiceError("validation", "Publish a current signed card for this site's exact discovery URL.");
    }
    // Same actor and transaction. pinDesk holds the identity lock and rejects conflicting history.
    const saved = await ctx.call(pinFindMeStillDesk, { identity, documents: [document] });
    if (saved.revision !== head.revision) throw new ServiceError("conflict", "A newer card is already saved.");
    await ctx.tx.update(findMeStillDesks).set({ publishedDocument: document }).where(eq(findMeStillDesks.identity, identity));
    ctx.setSubject("findmestill_desk", identity);
    return saved;
  },
});

export const readPublishedFindMeStillDesk = defineService({
  name: "findMeStill.readPublishedDesk",
  summary: "Read the public signed discovery document published by this site.",
  kind: "query",
  permission: "public",
  external: false,
  input: identityInput.strict(),
  output: coreCardDocument.nullable(),
  handler: async ({ identity }, ctx) => {
    const [desk] = await ctx.tx.select({ document: findMeStillDesks.publishedDocument })
      .from(findMeStillDesks).where(eq(findMeStillDesks.identity, identity));
    return desk?.document ?? null;
  },
});

const publicationStatus = z.enum(["unpublished", "current", "stale"]);
export type FindMeStillPublicationStatus = z.infer<typeof publicationStatus>;

const deskOverview = deskOutput.extend({
  primaryCardUrl: z.string(), backupCardUrls: z.array(z.string()), expiresAt: z.int(),
  publication: publicationStatus, granted: z.boolean(),
});

export const listFindMeStillDesks = defineService({
  name: "findMeStill.listDesks",
  summary: "List this site's saved desk metadata for its manager or an explicitly granted reader.",
  kind: "query",
  permission: "scoped",
  external: false,
  agentCallable: false,
  input: z.object({}).strict(),
  output: z.array(deskOverview),
  handler: async (_input, ctx) => {
    const userId = signedInUser(ctx);
    const currentGrant = and(eq(findMeStillDesks.identity, findMeStillDeskGrants.identity),
      eq(findMeStillDeskGrants.userId, userId), or(isNull(findMeStillDeskGrants.expiresAt), gt(findMeStillDeskGrants.expiresAt, sql`now()`)));
    const rows = await ctx.tx.select({ identity: findMeStillDesks.identity, compactJws: findMeStillDesks.compactJws,
      // publishDesk validates the stored JSON array. Compare its exact final JWS without reading the document into the desk list.
      publishedPin: sql<boolean | null>`(${findMeStillDesks.publishedDocument}::jsonb ->> -1) = ${findMeStillDesks.compactJws}`,
      granted: sql<boolean>`${findMeStillDeskGrants.userId} is not null`,
    }).from(findMeStillDesks).leftJoin(findMeStillDeskGrants, currentGrant)
      .where(hasModuleAccess(ctx.actor, "findMeStill", "manage") ? undefined : isNotNull(findMeStillDeskGrants.userId))
      .orderBy(asc(findMeStillDesks.identity));
    const now = currentTime();
    return rows.map(({ identity, compactJws, publishedPin, granted }) => {
      const card = inspectFindMeStillPin(compactJws, identity, now);
      const current = publishedPin === true && card.expiresAt > now && card.primaryCardUrl === findMeStillPublicationUrl(identity);
      const publication: FindMeStillPublicationStatus = publishedPin === null ? "unpublished" : current ? "current" : "stale";
      return { identity, revision: card.revision, primaryCardUrl: card.primaryCardUrl,
        backupCardUrls: [...card.backupCardUrls], expiresAt: card.expiresAt, publication, granted };
    });
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

export const linkFindMeStillCustomer = defineService({
  name: "findMeStill.linkCustomer",
  summary: "Explicitly adopt or clear a local CRM link for a verified FindMeStill contact.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  agentCallable: false,
  stepUp: true,
  writeClass: "write",
  input: identityInput.extend({ contactId: z.uuid().nullable() }).strict(),
  output: z.object({ linked: z.boolean() }),
  auditInputFields: ["identity"],
  handler: async ({ identity, contactId }, ctx) => {
    await grantedDesk(ctx, identity);
    if (!hasModuleAccess(ctx.actor, "contacts")) throw new ServiceError("permission", "Customer access is required.");
    await lockContactIdentityForRead(ctx.tx);
    if (contactId === null) {
      await ctx.tx.delete(findMeStillCustomerLinks).where(eq(findMeStillCustomerLinks.identity, identity));
    } else {
      const contact = await ctx.call(getContact, { id: contactId });
      if (!contact) throw new ServiceError("not_found", "That customer is not available.");
      await ctx.tx.insert(findMeStillCustomerLinks).values({ identity, contactId }).onConflictDoUpdate({
        target: findMeStillCustomerLinks.identity, set: { contactId },
      });
    }
    ctx.setSubject("findmestill_desk", identity);
    return { linked: contactId !== null };
  },
});

export const readFindMeStillCustomerLink = defineService({
  name: "findMeStill.readCustomerLink",
  summary: "Read the local customer linked to a desk that the caller may open.",
  kind: "query",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  input: identityInput.strict(),
  output: z.object({ contactId: z.uuid(), name: z.string() }).nullable(),
  handler: async ({ identity }, ctx) => {
    await grantedDesk(ctx, identity);
    const [link] = await ctx.tx.select({ contactId: findMeStillCustomerLinks.contactId })
      .from(findMeStillCustomerLinks).where(eq(findMeStillCustomerLinks.identity, identity));
    if (!link) return null;
    const contact = await ctx.call(getContact, { id: link.contactId });
    return contact ? { contactId: contact.id, name: contact.name } : null;
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
    // The ordinary services still see the original actor. The desk grant adds no CRM or booking authority.
    const contact = await ctx.call(readFindMeStillCustomerLink, { identity });
    if (contact?.contactId !== contactId) throw new ServiceError("not_found", "That booking link is not available.");
    const booking = await ctx.call(getBooking, { id: bookingId });
    if (booking?.contactId !== contact.contactId) throw new ServiceError("not_found", "That booking link is not available.");
    return { contactId, bookingId };
  },
});

export default [pinFindMeStillDesk, publishFindMeStillDesk, readPublishedFindMeStillDesk, listFindMeStillDesks,
  setFindMeStillDeskGrant, getFindMeStillDesk, checkFindMeStillBookingLink, linkFindMeStillCustomer, readFindMeStillCustomerLink];
