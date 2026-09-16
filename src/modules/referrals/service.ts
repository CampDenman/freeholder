// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Referral programmes, codes, touches and invitations
// (MASTER.md §4.3, §4.13, C9.09).
//
// Two rules from §4.13 govern this file:
//
//   "Attribution is first-party and survives the cookie. A code on a session,
//   a scanned QR at a market stall, a code typed at checkout, and an
//   invitation accepted by link all land in the same table."
//
//   "One hop only. Commission accrues to the referrer of the converting
//   customer and to nobody above them. Multi-level structures are refused by
//   the data model, not by policy."
//
// The first is why `recordTouch` is one service with a `kind` rather than four
// services: four entry points would become four answers to "where did this
// customer come from". The second is why there is no parent code and no
// service here that could build a chain of referrers.
//
// C9.09 records and attributes. It pays nobody — `CommissionEvent`, holdbacks
// and payouts are C9.10, which reads what this stores.
import { z } from "zod";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { hashToken, mintToken } from "./tokens";
import {
  affiliateCodes,
  affiliatePrograms,
  attributionTouches,
  referralInvitations,
} from "./schema";
import { creditsFor, withinWindow } from "./attribution";
// Attribution lives in its own file so this one and `commission-service.ts`
// can both read it without importing each other. See that file for why.
export { attributionFor } from "./attribution-service";
import { attributionFor } from "./attribution-service";
// Claims this module's room in the customer portal (C8.11). Imported for its
// side effect: core owns the registry so it never imports a module, and
// something has to make the claim at load time.
import "./portal";

// The half of this module that pays (C9.10). Re-exported here because the
// manifest names one services module, and split across two files because
// recording a touch and settling a payout batch are not the same subject.
export { matureCommissions, onSpineEvent } from "./commission-service";
export {
  commissions,
  buildBatch,
  approveBatch,
  markBatchPaid,
  batches,
  batchCsv,
  payoutLinesFor,
  saveTaxProfile,
  taxPrompts,
} from "./commission-service";
import {
  approveBatch,
  batchCsv,
  batches,
  buildBatch,
  commissions,
  markBatchPaid,
  payoutLinesFor,
  saveTaxProfile,
  taxPrompts,
} from "./commission-service";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/, "Use letters, numbers and hyphens.");

const programRow = row({
  id: uuidSchema,
  name: z.string(),
  conversionTypes: z.unknown(),
  customerDiscount: z.unknown(),
  commission: z.unknown(),
  cookieWindowDays: z.number().int(),
  holdbackDays: z.number().int(),
  attributionModel: z.enum(["last_touch", "first_touch", "position_based"]),
  status: z.enum(["draft", "active", "closed"]),
});

const codeRow = row({
  id: uuidSchema,
  programId: uuidSchema,
  contactId: uuidSchema,
  code: z.string(),
  landingPath: z.string().nullable(),
  clicks: z.number().int(),
  status: z.enum(["active", "paused", "revoked"]),
});

export const saveProgram = defineService({
  name: "referrals.saveProgram",
  writeClass: "write",
  summary: "Create or change a referral programme.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(120),
    conversionTypes: z
      .array(z.enum(["signup", "subscription", "order", "booking", "custom"]))
      .max(10)
      .default(["order"]),
    customerDiscount: z.record(z.string(), z.unknown()).default({}),
    commission: z.record(z.string(), z.unknown()).default({}),
    cookieWindowDays: z.number().int().min(1).max(3650).default(30),
    // Zero is allowed and means "payable at once". Some programmes genuinely
    // have no refund window — a signup bounty is not refundable — and forcing
    // a minimum of one day would make those owners wait for nothing.
    holdbackDays: z.number().int().min(0).max(3650).default(30),
    attributionModel: z
      .enum(["last_touch", "first_touch", "position_based"])
      .default("last_touch"),
    status: z.enum(["draft", "active", "closed"]).default("draft"),
  }),
  output: programRow,
  handler: async (input, ctx) => {
    const values = {
      name: input.name,
      conversionTypes: input.conversionTypes,
      customerDiscount: input.customerDiscount,
      commission: input.commission,
      cookieWindowDays: input.cookieWindowDays,
      holdbackDays: input.holdbackDays,
      attributionModel: input.attributionModel,
      status: input.status,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(affiliatePrograms)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(affiliatePrograms.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such programme.");
      return updated;
    }
    const [created] = await ctx.tx.insert(affiliatePrograms).values(values).returning();
    return created!;
  },
});

export const programs = defineService({
  name: "referrals.programs",
  summary: "Every referral programme.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(programRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(affiliatePrograms).orderBy(asc(affiliatePrograms.name)),
});

export const issueCode = defineService({
  name: "referrals.issueCode",
  writeClass: "write",
  summary: "Give somebody a referral code.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    programId: uuidSchema,
    contactId: uuidSchema,
    code,
    landingPath: z.string().trim().max(200).nullish(),
  }),
  output: codeRow,
  handler: async (input, ctx) => {
    const [program] = await ctx.tx
      .select({ id: affiliatePrograms.id })
      .from(affiliatePrograms)
      .where(eq(affiliatePrograms.id, input.programId));
    if (!program) throw new ServiceError("not_found", "There is no such programme.");

    const [clash] = await ctx.tx
      .select({ id: affiliateCodes.id })
      .from(affiliateCodes)
      .where(eq(affiliateCodes.code, input.code));
    if (clash) {
      throw new ServiceError(
        "conflict",
        `"${input.code}" is already somebody's code. A code is read off a card at a till, and two meanings for one word is not a conflict anybody can resolve at that moment.`,
      );
    }

    const [created] = await ctx.tx
      .insert(affiliateCodes)
      .values({
        programId: input.programId,
        contactId: input.contactId,
        code: input.code,
        landingPath: input.landingPath ?? null,
      })
      .returning();
    ctx.setSubject("affiliate_code", created!.id);
    ctx.queueEvent("referral.codeIssued", { codeId: created!.id });
    return created!;
  },
});

export const codes = defineService({
  name: "referrals.codes",
  summary: "Referral codes, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ programId: uuidSchema.optional(), contactId: uuidSchema.optional() }),
  output: listed(codeRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(affiliateCodes)
      .where(
        and(
          input.programId ? eq(affiliateCodes.programId, input.programId) : undefined,
          input.contactId ? eq(affiliateCodes.contactId, input.contactId) : undefined,
        ),
      )
      .orderBy(desc(affiliateCodes.createdAt)),
});

/**
 * Somebody arrived with a code.
 *
 * Public, because most of these happen before anybody is signed in — that is
 * the point of attribution. One service for every way it happens (§4.13):
 * a link, a QR at a market stall, a code typed at a checkout, an invitation
 * followed. Four services would become four answers to one question.
 */
export const recordTouch = defineService({
  name: "referrals.recordTouch",
  writeClass: "write",
  summary: "Record that somebody arrived with a referral code.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    code,
    anonId: z.string().trim().max(120).nullish(),
    contactId: uuidSchema.nullish(),
    kind: z.enum(["click", "scan", "manual", "invitation"]).default("click"),
    landingPath: z.string().trim().max(400).nullish(),
    referrerUrl: z.string().trim().max(1000).nullish(),
    utm: z.record(z.string(), z.string().max(200)).default({}),
    deviceHash: z.string().trim().max(120).nullish(),
  }),
  rateLimit: {
    limit: 120,
    windowSeconds: 60 * 60,
    subject: (input) => input.anonId ?? input.code,
    message: "That has been recorded already.",
  },
  output: row({ recorded: z.boolean(), codeId: uuidSchema.nullable() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(affiliateCodes)
      .where(eq(affiliateCodes.code, input.code));

    // An unknown or paused code is not an error a visitor should see. They
    // typed something off a card; the page still has to render.
    if (!found || found.status !== "active") return { recorded: false, codeId: null };

    // Nothing to attach it to is not worth a row: a touch with neither a
    // visitor nor a contact can never be claimed by anybody later.
    if (!input.anonId && !input.contactId) return { recorded: false, codeId: found.id };

    await ctx.tx.insert(attributionTouches).values({
      anonId: input.anonId ?? null,
      contactId: input.contactId ?? null,
      codeId: found.id,
      kind: input.kind,
      landingPath: input.landingPath ?? found.landingPath ?? null,
      referrerUrl: input.referrerUrl ?? null,
      utm: input.utm,
      deviceHash: input.deviceHash ?? null,
    });
    await ctx.tx
      .update(affiliateCodes)
      .set({ clicks: found.clicks + 1, updatedAt: new Date() })
      .where(eq(affiliateCodes.id, found.id));
    return { recorded: true, codeId: found.id };
  },
});

/**
 * The visitor became somebody: attach what they did before we knew them.
 *
 * This is the whole of "survives the cookie". A touch recorded against `fh_v`
 * in March is claimed by the contact created in May, and the chain that
 * attribution reads is the real one rather than the part that happened after
 * a form was filled in.
 */
export const claimTouches = defineService({
  name: "referrals.claimTouches",
  writeClass: "write",
  summary: "Attach a visitor's earlier referral touches to the contact they became.",
  kind: "mutation",
  permission: "system",
  input: z.object({ anonId: z.string().trim().min(1).max(120), contactId: uuidSchema }),
  output: row({ claimed: z.number().int() }),
  handler: async (input, ctx) => {
    const claimed = await ctx.tx
      .update(attributionTouches)
      .set({ contactId: input.contactId })
      .where(
        and(eq(attributionTouches.anonId, input.anonId), isNull(attributionTouches.contactId)),
      )
      .returning({ id: attributionTouches.id });
    return { claimed: claimed.length };
  },
});


/* --------------------------------------------------------- invitations */

export const invite = defineService({
  name: "referrals.invite",
  writeClass: "write",
  summary: "Invite somebody, by name, so the ask is trackable.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    referrerContactId: uuidSchema,
    codeId: uuidSchema,
    channel: z.enum(["email", "sms", "link", "qr"]).default("link"),
    inviteeEmail: z.string().trim().email().toLowerCase().max(320).nullish(),
    inviteePhone: z.string().trim().max(40).nullish(),
  }),
  output: row({ id: uuidSchema, token: z.string() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(affiliateCodes)
      .where(eq(affiliateCodes.id, input.codeId));
    if (!found) throw new ServiceError("not_found", "There is no such code.");
    if (found.contactId !== input.referrerContactId) {
      throw new ServiceError("validation", "That code belongs to somebody else.");
    }

    const token = mintToken();
    const [created] = await ctx.tx
      .insert(referralInvitations)
      .values({
        referrerContactId: input.referrerContactId,
        programId: found.programId,
        codeId: found.id,
        channel: input.channel,
        inviteeEmail: input.inviteeEmail ?? null,
        inviteePhone: input.inviteePhone ?? null,
        tokenHash: hashToken(token),
        sentAt: new Date(),
      })
      .returning({ id: referralInvitations.id });
    ctx.queueEvent("referral.invited", { invitationId: created!.id });
    // The token is returned once, here, and only its hash is stored — the
    // same rule gallery guests and quote links follow.
    return { id: created!.id, token };
  },
});

export const acceptInvitation = defineService({
  name: "referrals.acceptInvitation",
  writeClass: "write",
  summary: "Follow an invitation, recording the touch it carried.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    token: z.string().trim().min(1).max(200),
    anonId: z.string().trim().max(120).nullish(),
    email: z.string().trim().email().toLowerCase().max(320).nullish(),
    name: z.string().trim().max(200).nullish(),
  }),
  rateLimit: {
    limit: 20,
    windowSeconds: 60 * 60,
    subject: (input) => input.anonId ?? input.token.slice(0, 16),
    message: "Too many attempts. Try again shortly.",
  },
  output: row({ accepted: z.boolean(), codeId: uuidSchema.nullable() }),
  handler: async (input, ctx) => {
    const [invitation] = await ctx.tx
      .select()
      .from(referralInvitations)
      .where(eq(referralInvitations.tokenHash, hashToken(input.token)));
    if (!invitation) return { accepted: false, codeId: null };

    // An invitation names somebody, and following it is a touch like any
    // other — the same table, so attribution reads one chain (§4.13).
    let contactId: string | null = null;
    if (input.email) {
      // Automated path, so `contacts.resolve` and never `contacts.create`.
      const { contact } = await ctx.callAsSystem(resolveContact, {
        email: input.email,
        name: input.name ?? undefined,
        source: "referral",
      });
      contactId = contact.id;
    }

    if (!input.anonId && !contactId) return { accepted: false, codeId: invitation.codeId };

    await ctx.tx.insert(attributionTouches).values({
      anonId: input.anonId ?? null,
      contactId,
      codeId: invitation.codeId,
      kind: "invitation",
    });
    await ctx.tx
      .update(referralInvitations)
      .set({ acceptedAt: invitation.acceptedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(referralInvitations.id, invitation.id));
    ctx.queueEvent("referral.invitationAccepted", { invitationId: invitation.id });
    return { accepted: true, codeId: invitation.codeId };
  },
});

export const invitations = defineService({
  name: "referrals.invitations",
  summary: "Invitations sent, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ referrerContactId: uuidSchema.optional() }),
  output: listed(
    row({
      id: uuidSchema,
      channel: z.enum(["email", "sms", "link", "qr"]),
      inviteeEmail: z.string().nullable(),
      sentAt: z.date().nullable(),
      acceptedAt: z.date().nullable(),
      convertedAt: z.date().nullable(),
      rewardState: z.enum(["none", "pending", "granted", "reversed"]),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: referralInvitations.id,
        channel: referralInvitations.channel,
        inviteeEmail: referralInvitations.inviteeEmail,
        sentAt: referralInvitations.sentAt,
        acceptedAt: referralInvitations.acceptedAt,
        convertedAt: referralInvitations.convertedAt,
        rewardState: referralInvitations.rewardState,
      })
      .from(referralInvitations)
      .where(
        input.referrerContactId
          ? eq(referralInvitations.referrerContactId, input.referrerContactId)
          : undefined,
      )
      .orderBy(desc(referralInvitations.createdAt)),
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "affiliate_codes",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(affiliateCodes)
      .set({ contactId: survivingId })
      .where(eq(affiliateCodes.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: affiliateCodes.id })
      .from(affiliateCodes)
      .where(eq(affiliateCodes.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(affiliateCodes)
        .set({ contactId: duplicateId })
        .where(eq(affiliateCodes.id, each.id));
    }
  },
});

registerContactReference({
  table: "attribution_touches",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(attributionTouches)
      .set({ contactId: survivingId })
      .where(eq(attributionTouches.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: attributionTouches.id })
      .from(attributionTouches)
      .where(eq(attributionTouches.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(attributionTouches)
        .set({ contactId: duplicateId })
        .where(eq(attributionTouches.id, each.id));
    }
  },
});

registerContactReference({
  table: "referral_invitations",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(referralInvitations)
      .set({ referrerContactId: survivingId })
      .where(eq(referralInvitations.referrerContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: referralInvitations.id })
      .from(referralInvitations)
      .where(eq(referralInvitations.referrerContactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(referralInvitations)
        .set({ referrerContactId: duplicateId })
        .where(eq(referralInvitations.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.referrals",
  tables: ["affiliate_codes", "attribution_touches", "referral_invitations"],
  exportData: async (tx, contactId) => ({
    codes: await tx.select().from(affiliateCodes).where(eq(affiliateCodes.contactId, contactId)),
    touches: await tx
      .select()
      .from(attributionTouches)
      .where(eq(attributionTouches.contactId, contactId)),
    invitations: await tx
      .select()
      .from(referralInvitations)
      .where(eq(referralInvitations.referrerContactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The touch survives with its person removed. An attribution chain is the
    // business's own record of where its customers came from — the count is
    // not this person's data to withdraw — but the link to them is, so the
    // contact goes and the row stays countable.
    const touches = await tx
      .update(attributionTouches)
      .set({ contactId: null, anonId: null, deviceHash: null })
      .where(eq(attributionTouches.contactId, contactId))
      .returning({ id: attributionTouches.id });
    const codes = await tx
      .delete(affiliateCodes)
      .where(eq(affiliateCodes.contactId, contactId))
      .returning({ id: affiliateCodes.id });
    const invites = await tx
      .delete(referralInvitations)
      .where(eq(referralInvitations.referrerContactId, contactId))
      .returning({ id: referralInvitations.id });
    return { affected: touches.length + codes.length + invites.length };
  },
});

export { creditsFor, withinWindow };

export default [
  saveProgram,
  programs,
  issueCode,
  codes,
  recordTouch,
  claimTouches,
  attributionFor,
  invite,
  acceptInvitation,
  invitations,
  // C9.10.
  commissions,
  buildBatch,
  approveBatch,
  markBatchPaid,
  batches,
  batchCsv,
  payoutLinesFor,
  saveTaxProfile,
  taxPrompts,
];
