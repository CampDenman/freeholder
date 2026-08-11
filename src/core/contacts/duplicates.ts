// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Human-reviewed duplicate detection and merge provenance (MASTER.md C1.07).
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  contactMergeOperations,
  mergeCandidates,
} from "@/core/contacts/schema";
import { mergeContacts } from "@/core/contacts/service";
import { defineService, ServiceError } from "@/core/service";

export const DUPLICATE_REASON_CODES = [
  "same_phone",
  "same_name",
  "similar_name",
  "same_organization",
  "same_country",
] as const;
export type DuplicateReasonCode = (typeof DUPLICATE_REASON_CODES)[number];

export interface DuplicateReason {
  code: DuplicateReasonCode;
  points: number;
  value?: string;
}

interface BlockedPair extends Record<string, unknown> {
  aId: string;
  aName: string;
  aEmail: string | null;
  aPhone: string | null;
  aOrgId: string | null;
  aCountry: string | null;
  bId: string;
  bName: string;
  bEmail: string | null;
  bPhone: string | null;
  bOrgId: string | null;
  bCountry: string | null;
  nameSimilarity: number;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function normalizedPhone(value: string | null): string | null {
  if (!value) return null;
  const rawDigits = value.replace(/\D/g, "");
  // Treat the optional North American country prefix as formatting. This is
  // deliberately narrower than comparing arbitrary trailing digits, which
  // could make unrelated international numbers look alike.
  const digits =
    rawDigits.length === 11 && rawDigits.startsWith("1")
      ? rawDigits.slice(1)
      : rawDigits;
  return digits.length >= 7 ? digits : null;
}

export function scoreDuplicatePair(pair: BlockedPair): {
  score: number;
  reasons: DuplicateReason[];
} {
  const reasons: DuplicateReason[] = [];
  const phoneA = normalizedPhone(pair.aPhone);
  const phoneB = normalizedPhone(pair.bPhone);
  if (phoneA && phoneA === phoneB) {
    reasons.push({
      code: "same_phone",
      points: 60,
      value: phoneA.slice(-4),
    });
  }
  if (normalizedName(pair.aName) === normalizedName(pair.bName)) {
    reasons.push({ code: "same_name", points: 45 });
  } else if (pair.nameSimilarity >= 0.65) {
    reasons.push({
      code: "similar_name",
      points: Math.round(pair.nameSimilarity * 40),
      value: String(Math.round(pair.nameSimilarity * 100)),
    });
  }
  if (pair.aOrgId && pair.aOrgId === pair.bOrgId) {
    reasons.push({ code: "same_organization", points: 15 });
  }
  if (pair.aCountry && pair.aCountry === pair.bCountry) {
    reasons.push({ code: "same_country", points: 5 });
  }
  return {
    score: reasons.reduce((total, reason) => total + reason.points, 0),
    reasons,
  };
}

/**
 * Rebuild the open queue from indexed blocking keys. Nothing in this service
 * merges: confidence earns a place in the queue, never authority over data.
 */
export const scanDuplicateCandidates = defineService({
  name: "contacts.scanDuplicates",
  summary: "Scan contacts for explainable duplicate candidates without merging them.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const pairs = await ctx.tx.execute<BlockedPair>(sql`
      with blocked_pairs as (
        select a.id as a_id, b.id as b_id
        from contacts a
        join contacts b
          on a.id < b.id
         and length(trim(a.name)) >= 3
         and regexp_replace(lower(trim(a.name)), '[[:space:]]+', ' ', 'g') =
             regexp_replace(lower(trim(b.name)), '[[:space:]]+', ' ', 'g')
        union
        select a.id as a_id, b.id as b_id
        from contacts a
        join contacts b
          on a.id < b.id
         and a.phone is not null
         and b.phone is not null
         and length(
           case
             when regexp_replace(a.phone, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
               then substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
             else regexp_replace(a.phone, '[^0-9]', '', 'g')
           end
         ) >= 7
         and (
           case
             when regexp_replace(a.phone, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
               then substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
             else regexp_replace(a.phone, '[^0-9]', '', 'g')
           end
         ) = (
           case
             when regexp_replace(b.phone, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
               then substring(regexp_replace(b.phone, '[^0-9]', '', 'g') from 2)
             else regexp_replace(b.phone, '[^0-9]', '', 'g')
           end
         )
        union
        select a.id as a_id, b.id as b_id
        from contacts a
        join contacts b
          on a.id < b.id
         and a.org_id is not null
         and a.org_id = b.org_id
         and similarity(a.name, b.name) >= 0.65
      )
      select
        a.id as "aId", a.name as "aName", a.email as "aEmail",
        a.phone as "aPhone", a.org_id as "aOrgId", a.country as "aCountry",
        b.id as "bId", b.name as "bName", b.email as "bEmail",
        b.phone as "bPhone", b.org_id as "bOrgId", b.country as "bCountry",
        similarity(a.name, b.name)::double precision as "nameSimilarity"
      from blocked_pairs p
      join contacts a on a.id = p.a_id
      join contacts b on b.id = p.b_id
    `);
    const candidates = pairs
      .map((pair) => ({ pair, ...scoreDuplicatePair(pair) }))
      .filter((candidate) => candidate.score >= 40);

    await ctx.tx
      .delete(mergeCandidates)
      .where(eq(mergeCandidates.status, "open"));
    for (const candidate of candidates) {
      const { pair } = candidate;
      await ctx.tx
        .insert(mergeCandidates)
        .values({
          contactAId: pair.aId,
          contactBId: pair.bId,
          contactAName: pair.aName,
          contactAEmail: pair.aEmail,
          contactBName: pair.bName,
          contactBEmail: pair.bEmail,
          score: candidate.score,
          reasons: candidate.reasons,
        })
        .onConflictDoUpdate({
          target: [mergeCandidates.contactAId, mergeCandidates.contactBId],
          set: {
            contactAName: pair.aName,
            contactAEmail: pair.aEmail,
            contactBName: pair.bName,
            contactBEmail: pair.bEmail,
            score: candidate.score,
            reasons: candidate.reasons,
            detectedAt: new Date(),
          },
        });
    }
    const [open] = await ctx.tx
      .select({ n: count() })
      .from(mergeCandidates)
      .where(eq(mergeCandidates.status, "open"));
    ctx.setSubject("duplicateQueue", "contacts");
    return { scannedPairs: pairs.length, openCandidates: open?.n ?? 0 };
  },
});

const candidateStatus = z.enum(["open", "dismissed", "merged"]);

export const listDuplicateCandidates = defineService({
  name: "contacts.listDuplicateCandidates",
  summary: "List explainable contact duplicate candidates for human review.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: candidateStatus.default("open"),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const where = eq(mergeCandidates.status, input.status);
    const rows = await ctx.tx
      .select()
      .from(mergeCandidates)
      .where(where)
      .orderBy(desc(mergeCandidates.score), desc(mergeCandidates.detectedAt))
      .limit(input.limit)
      .offset(input.offset);
    const [total] = await ctx.tx
      .select({ n: count() })
      .from(mergeCandidates)
      .where(where);
    return { rows, total: total?.n ?? 0 };
  },
});

export const dismissDuplicateCandidate = defineService({
  name: "contacts.dismissDuplicateCandidate",
  summary: "Dismiss a duplicate candidate so future scans respect the decision.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [candidate] = await ctx.tx
      .update(mergeCandidates)
      .set({ status: "dismissed", dismissedAt: new Date() })
      .where(
        and(
          eq(mergeCandidates.id, input.id),
          eq(mergeCandidates.status, "open"),
        ),
      )
      .returning();
    if (!candidate) {
      throw new ServiceError("conflict", "That duplicate candidate is no longer open.");
    }
    ctx.setSubject("mergeCandidate", candidate.id);
    return candidate;
  },
});

export const mergeDuplicateCandidate = defineService({
  name: "contacts.mergeDuplicateCandidate",
  summary: "Merge one human-approved duplicate candidate and record undo evidence.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    candidateId: z.string().uuid(),
    survivingId: z.string().uuid(),
    duplicateId: z.string().uuid(),
  }),
  handler: (input, ctx) => ctx.call(mergeContacts, input),
});

export const listContactMergeOperations = defineService({
  name: "contacts.listMergeOperations",
  summary: "List recent contact merges and whether each can still be undone.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(contactMergeOperations)
      .orderBy(desc(contactMergeOperations.mergedAt))
      .limit(input.limit),
});

export default [
  scanDuplicateCandidates,
  listDuplicateCandidates,
  dismissDuplicateCandidate,
  mergeDuplicateCandidate,
  listContactMergeOperations,
];
