// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Permission to publish media of an identifiable person (MASTER.md §4.18,
// C8.16).
//
// Every write here appends. There is no service that edits a decision and none
// that deletes one, which is the whole design: the previous implementation
// cleared three columns on revoke, and a clinic that had published lawfully
// for six months could then no longer show that it had. Consent is evidence,
// and evidence that disappears when it becomes inconvenient was never evidence.
//
// `liveConsent` is what everything else asks. It answers false for a
// withdrawal, false for a grant that has lapsed, and false when nobody ever
// decided — three different situations that must not be told apart by the
// publishing path, because all three mean the same thing: do not publish.
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError, type Tx } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "./service";
import {
  MEDIA_CONSENT_METHODS,
  MEDIA_CONSENT_SURFACES,
  mediaConsents,
} from "./schema";

const subjectKind = z.enum(["project"]);
const method = z.enum(MEDIA_CONSENT_METHODS);
const surface = z.enum(MEDIA_CONSENT_SURFACES);

const decisionRow = row({
  id: uuid,
  contactId: uuid,
  subjectKind: z.string(),
  subjectId: uuid,
  state: z.enum(["granted", "withdrawn"]),
  method: z.enum(MEDIA_CONSENT_METHODS),
  surfaces: z.array(z.string()),
  note: z.string().nullable(),
  effectiveAt: timestamp,
  expiresAt: timestamp.nullable(),
  createdAt: timestamp,
});

/**
 * The decision that stands for this work, or nothing.
 *
 * Latest by when it took effect, not by when it was typed: a consent form
 * signed last week and entered today is still a consent from last week, and
 * ordering by `created_at` would let a late data-entry correction silently
 * outrank a withdrawal that happened after it.
 */
export async function latestDecision(
  tx: Tx,
  kind: string,
  id: string,
): Promise<typeof mediaConsents.$inferSelect | null> {
  const [found] = await tx
    .select()
    .from(mediaConsents)
    .where(and(eq(mediaConsents.subjectKind, kind), eq(mediaConsents.subjectId, id)))
    .orderBy(desc(mediaConsents.effectiveAt), desc(mediaConsents.createdAt))
    .limit(1);
  return found ?? null;
}

/** Granted, in force, and not lapsed. Everything else is "do not publish". */
export function isLive(
  decision: typeof mediaConsents.$inferSelect | null,
  now = new Date(),
): boolean {
  if (!decision) return false;
  if (decision.state !== "granted") return false;
  if (decision.effectiveAt > now) return false;
  return decision.expiresAt === null || decision.expiresAt > now;
}

export async function liveConsent(
  tx: Tx,
  kind: string,
  id: string,
  now = new Date(),
): Promise<typeof mediaConsents.$inferSelect | null> {
  const decision = await latestDecision(tx, kind, id);
  return isLive(decision, now) ? decision : null;
}


/*
 * The spine obligations for `media_consents.contact_id`.
 *
 * Merge is a hand-maintained list (CLAUDE.md), and a consent row orphaned by a
 * merge is a permission nobody can find when they need to prove they had it.
 *
 * Erasure keeps the decisions and clears only the free-text note. The rows are
 * the same class of thing as `consent_records` — immutable evidence under a
 * legal hold — and a business that has just been asked to erase somebody is
 * precisely the business that may later need to show what it was permitted to
 * publish, and when that permission ended. The note is where a person's own
 * words could end up, so that goes.
 */
registerContactReference({
  table: "media_consents",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(mediaConsents)
      .set({ contactId: survivingId })
      .where(eq(mediaConsents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: mediaConsents.id, contactId: mediaConsents.contactId })
      .from(mediaConsents)
      .where(inArray(mediaConsents.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: mediaConsents.id, contactId: mediaConsents.contactId })
          .from(mediaConsents)
          .where(inArray(mediaConsents.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "A publication consent changed after this merge. Leave the merge in place or restore that consent first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(mediaConsents)
        .set({ contactId: duplicateId })
        .where(inArray(mediaConsents.id, moved.map((row) => row.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "privacy.mediaConsent",
  tables: ["media_consents"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(mediaConsents)
      .where(eq(mediaConsents.contactId, contactId))
      .orderBy(desc(mediaConsents.effectiveAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(mediaConsents)
      .set({ note: null })
      .where(eq(mediaConsents.contactId, contactId))
      .returning({ id: mediaConsents.id });
    return { affected: rows.length };
  },
});

export const grantMediaConsent = defineService({
  name: "privacy.grantMediaConsent",
  summary: "Record that somebody agreed to this work being published.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: uuid,
    subjectKind,
    subjectId: uuid,
    method,
    surfaces: z.array(surface).min(1).default(["project"]),
    note: z.string().max(1000).optional(),
    evidenceAssetId: uuid.optional(),
    /** When they agreed. Defaults to now, but a signed form has its own date. */
    effectiveAt: z.coerce.date().optional(),
    /** When it lapses, if it was given for a period. */
    expiresAt: z.coerce.date().optional(),
  }),
  output: decisionRow,
  handler: async (input, ctx) => {
    const effectiveAt = input.effectiveAt ?? new Date();
    if (input.expiresAt && input.expiresAt <= effectiveAt) {
      throw new ServiceError(
        "validation",
        "Consent cannot lapse before it was given.",
      );
    }
    const [created] = await ctx.tx
      .insert(mediaConsents)
      .values({
        contactId: input.contactId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        state: "granted",
        method: input.method,
        surfaces: input.surfaces,
        note: input.note ?? null,
        evidenceAssetId: input.evidenceAssetId ?? null,
        effectiveAt,
        expiresAt: input.expiresAt ?? null,
        recordedBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("media_consent", created!.id);
    ctx.queueEvent("mediaConsent.granted", {
      id: created!.id,
      contactId: created!.contactId,
      subjectKind: created!.subjectKind,
      subjectId: created!.subjectId,
    });
    return created!;
  },
});

export const withdrawMediaConsent = defineService({
  name: "privacy.withdrawMediaConsent",
  summary: "Record that somebody took that permission back. The grant stays.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    subjectKind,
    subjectId: uuid,
    method,
    note: z.string().max(1000).optional(),
    effectiveAt: z.coerce.date().optional(),
  }),
  output: decisionRow,
  handler: async (input, ctx) => {
    const standing = await latestDecision(ctx.tx, input.subjectKind, input.subjectId);
    if (!standing) {
      throw new ServiceError(
        "not_found",
        "Nobody has agreed to this being published, so there is nothing to take back.",
      );
    }
    if (standing.state === "withdrawn") return standing;

    // A new row, not an update. What was granted stays granted in the record;
    // what changed is that it no longer stands.
    const [created] = await ctx.tx
      .insert(mediaConsents)
      .values({
        contactId: standing.contactId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        state: "withdrawn",
        method: input.method,
        surfaces: standing.surfaces,
        note: input.note ?? null,
        effectiveAt: input.effectiveAt ?? new Date(),
        recordedBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("media_consent", created!.id);
    ctx.queueEvent("mediaConsent.withdrawn", {
      id: created!.id,
      contactId: created!.contactId,
      subjectKind: created!.subjectKind,
      subjectId: created!.subjectId,
    });
    return created!;
  },
});

export const mediaConsentState = defineService({
  name: "privacy.mediaConsent",
  summary: "Whether this work may be published, and what that rests on.",
  kind: "query",
  permission: "scoped",
  input: z.object({ subjectKind, subjectId: uuid }),
  output: z.object({
    live: z.boolean(),
    /** Why not, when it is not: nobody decided, they withdrew, or it lapsed. */
    reason: z.enum(["none", "withdrawn", "lapsed", "future", "live"]),
    decision: decisionRow.nullable(),
  }),
  handler: async (input, ctx) => {
    const decision = await latestDecision(ctx.tx, input.subjectKind, input.subjectId);
    if (!decision) return { live: false, reason: "none" as const, decision: null };
    const now = new Date();
    if (decision.state === "withdrawn") {
      return { live: false, reason: "withdrawn" as const, decision };
    }
    if (decision.effectiveAt > now) {
      return { live: false, reason: "future" as const, decision };
    }
    if (decision.expiresAt !== null && decision.expiresAt <= now) {
      return { live: false, reason: "lapsed" as const, decision };
    }
    return { live: true, reason: "live" as const, decision };
  },
});

export const mediaConsentHistory = defineService({
  name: "privacy.mediaConsentHistory",
  summary: "Every decision anybody made about publishing this work.",
  kind: "query",
  permission: "scoped",
  input: z.object({ subjectKind, subjectId: uuid }),
  output: listed(decisionRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(mediaConsents)
      .where(
        and(
          eq(mediaConsents.subjectKind, input.subjectKind),
          eq(mediaConsents.subjectId, input.subjectId),
        ),
      )
      .orderBy(desc(mediaConsents.effectiveAt), desc(mediaConsents.createdAt));
    return rows;
  },
});

export default [
  grantMediaConsent,
  withdrawMediaConsent,
  mediaConsentState,
  mediaConsentHistory,
];
