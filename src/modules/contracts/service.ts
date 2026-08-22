// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Issuing and signing an agreement (MASTER.md §4.3, C6.09).
//
// Three rules, and each of them is the difference between an e-signature and a
// checkbox:
//
//   1. **The body is copied, not referenced.** What was agreed is the text as
//      it stood at that moment. Editing a template afterwards must not change
//      what somebody signed, and a pointer would let it.
//   2. **The signer identifies themselves.** The name is typed by the person,
//      not filled in from the contact record — typing your own name *is* the
//      act, and pre-filling it would make the signature the business's rather
//      than theirs.
//   3. **Signing happens once.** A signed document is closed. Re-signing would
//      overwrite the evidence with a later moment, and the whole value of the
//      record is that it is the earlier one.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type Actor } from "@/core/service";
import { contractDocuments, CONTRACT_KINDS, CONTRACT_STATUSES } from "./schema";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage agreements.");
  }
}

const documentRow = row({
  id: uuid,
  contactId: uuid,
  subjectType: z.string(),
  subjectId: uuid.nullable(),
  kind: z.enum(CONTRACT_KINDS),
  title: z.string(),
  status: z.enum(CONTRACT_STATUSES),
  bodyHash: z.string(),
  issuedAt: timestamp,
  signedAt: timestamp.nullable(),
  signerName: z.string().nullable(),
});

export const issueContract = defineService({
  name: "contracts.issue",
  summary: "Put an agreement in front of somebody to sign.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: z.uuid(),
    subjectType: z.string().trim().min(1).max(50),
    subjectId: z.uuid().nullish(),
    kind: z.enum(CONTRACT_KINDS).default("waiver"),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(100_000),
  }),
  output: documentRow,
  handler: async (input, ctx) => {
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");

    // Issuing the same waiver twice for the same appointment is a page
    // refreshed, not a second agreement. The outstanding one is returned so
    // the link already in somebody's inbox keeps working.
    if (input.subjectId) {
      const [existing] = await ctx.tx
        .select()
        .from(contractDocuments)
        .where(
          and(
            eq(contractDocuments.subjectType, input.subjectType),
            eq(contractDocuments.subjectId, input.subjectId),
            eq(contractDocuments.kind, input.kind),
            eq(contractDocuments.status, "issued"),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }

    const [created] = await ctx.tx
      .insert(contractDocuments)
      .values({
        contactId: input.contactId,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        kind: input.kind,
        title: input.title,
        bodySnapshot: input.body,
        bodyHash: sha256(input.body),
        signToken: randomBytes(24).toString("base64url"),
      })
      .returning();

    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "contract.issued",
      subjectType: "contract",
      subjectId: created!.id,
      payload: { title: input.title, kind: input.kind },
    });
    ctx.setSubject("contract", created!.id);
    ctx.queueEvent("contract.issued", {
      id: created!.id,
      contactId: input.contactId,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
    });
    return created!;
  },
});

/**
 * The document as the person signing it sees it.
 *
 * Public, because the token is the authorisation: somebody signing a waiver
 * from a link in an email has no account, and requiring one would mean the
 * waiver only worked for customers who happened to have made one.
 */
export const contractByToken = defineService({
  name: "contracts.byToken",
  summary: "One agreement, for the person being asked to sign it.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z
    .object({
      id: uuid,
      title: z.string(),
      body: z.string(),
      kind: z.enum(CONTRACT_KINDS),
      status: z.enum(CONTRACT_STATUSES),
      signedAt: timestamp.nullable(),
      signerName: z.string().nullable(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.signToken, input.token))
      .limit(1);
    if (!found) return null;
    return {
      id: found.id,
      title: found.title,
      // The snapshot, always — a signed document shows what was signed, and a
      // page that re-rendered from a template would show something else.
      body: found.bodySnapshot,
      kind: found.kind,
      status: found.status,
      signedAt: found.signedAt,
      signerName: found.signerName,
    };
  },
});

export const signContract = defineService({
  name: "contracts.sign",
  summary: "Sign an agreement, with no account and no support email.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    /**
     * Typed by the signer. Never defaulted from the contact record: typing
     * your own name is the act being recorded, and pre-filling it would make
     * the signature the business's rather than the person's.
     */
    signerName: z.string().trim().min(2).max(200),
    /** Passed by the route from the request, never by the browser. */
    ip: z.string().trim().max(100).nullish(),
    userAgent: z.string().trim().max(500).nullish(),
  }),
  output: z.object({ id: uuid, signedAt: timestamp, signatureHash: z.string() }),
  handler: async (input, ctx) => {
    const [document] = await ctx.tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.signToken, input.token))
      .limit(1);
    if (!document) throw new ServiceError("not_found", "That link is no longer valid.");
    if (document.status === "signed") {
      // Signed once, and the record is the first moment. Overwriting it with a
      // later one would quietly destroy the evidence.
      throw new ServiceError("conflict", "This has already been signed.");
    }
    if (document.status !== "issued") {
      throw new ServiceError("conflict", "This is no longer open for signing.");
    }

    const signedAt = new Date();
    const [signerEmail] = await ctx.tx
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, document.contactId))
      .limit(1);
    // Everything identifying, in one value. A dispute is settled by
    // recomputing this rather than by trusting that the row was never edited.
    const signatureHash = sha256(
      [
        document.bodyHash,
        input.signerName,
        signerEmail?.email ?? "",
        signedAt.toISOString(),
        input.ip ?? "",
        input.userAgent ?? "",
      ].join("\n"),
    );

    const [signed] = await ctx.tx
      .update(contractDocuments)
      .set({
        status: "signed",
        signedAt,
        signerName: input.signerName,
        signerEmail: signerEmail?.email ?? null,
        signerIp: input.ip ?? null,
        signerUserAgent: input.userAgent ?? null,
        signatureHash,
        // The link is spent. A signing link that keeps working is a second
        // signature waiting to happen.
        signToken: null,
        updatedAt: signedAt,
      })
      .where(eq(contractDocuments.id, document.id))
      .returning({ id: contractDocuments.id, signedAt: contractDocuments.signedAt });

    await ctx.emitTimeline({
      contactId: document.contactId,
      eventType: "contract.signed",
      subjectType: "contract",
      subjectId: document.id,
      payload: { title: document.title, signerName: input.signerName },
    });
    ctx.setSubject("contract", document.id);
    ctx.queueEvent("contract.signed", {
      id: document.id,
      contactId: document.contactId,
      subjectType: document.subjectType,
      subjectId: document.subjectId,
    });
    return { id: signed!.id, signedAt: signed!.signedAt!, signatureHash };
  },
});

export const declineContract = defineService({
  name: "contracts.decline",
  summary: "Say no to an agreement, on the record.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    reason: z.string().trim().max(1_000).nullish(),
  }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const [declined] = await ctx.tx
      .update(contractDocuments)
      .set({
        status: "declined",
        declinedAt: new Date(),
        declineReason: input.reason ?? null,
        signToken: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contractDocuments.signToken, input.token),
          eq(contractDocuments.status, "issued"),
        ),
      )
      .returning({ id: contractDocuments.id, contactId: contractDocuments.contactId });
    if (!declined) throw new ServiceError("not_found", "That link is no longer valid.");
    await ctx.emitTimeline({
      contactId: declined.contactId,
      eventType: "contract.declined",
      subjectType: "contract",
      subjectId: declined.id,
      payload: input.reason ? { reason: input.reason } : {},
    });
    ctx.setSubject("contract", declined.id);
    return { id: declined.id };
  },
});

/**
 * Whether a subject's agreement has been signed.
 *
 * A boolean rather than the documents, because the one caller is scheduling
 * asking "may this booking be confirmed?" and handing it a list of documents
 * to interpret would put that judgement in two places. Reached by elevation,
 * so it carries no `requirePerson` guard — the check belongs to whoever
 * elevated, and this answers a question about *their* subject.
 */
export const signedForSubject = defineService({
  name: "contracts.signedFor",
  summary: "Whether a subject's agreement has been signed.",
  kind: "query",
  permission: "scoped",
  agentCallable: false,
  input: z.object({
    subjectType: z.string().trim().min(1).max(50),
    subjectId: z.uuid(),
    kind: z.enum(CONTRACT_KINDS).optional(),
  }),
  output: z.object({ signed: z.boolean() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({ id: contractDocuments.id })
      .from(contractDocuments)
      .where(
        and(
          eq(contractDocuments.subjectType, input.subjectType),
          eq(contractDocuments.subjectId, input.subjectId),
          input.kind ? eq(contractDocuments.kind, input.kind) : undefined,
          eq(contractDocuments.status, "signed"),
        ),
      )
      .limit(1);
    return { signed: Boolean(found) };
  },
});

/**
 * The signing link for one subject's outstanding document.
 *
 * **Scoped, and reached by elevation only.** The customer-facing caller is the
 * appointment page, which has already proved possession of that booking's own
 * unguessable link before it asks — so the authorisation is the reschedule
 * token, checked there, and `ctx.callAsSystem` is the deliberately greppable
 * hand-off. Public here would have made a booking id enough to fetch somebody
 * else's signing token, and an id that appears in admin URLs is not a
 * credential.
 */
export const signingLink = defineService({
  name: "contracts.signingLink",
  summary: "The signing link for a subject's outstanding agreement.",
  kind: "query",
  permission: "scoped",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({
    subjectType: z.string().trim().min(1).max(50),
    subjectId: z.uuid(),
  }),
  output: z.object({ token: z.string().nullable() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({ token: contractDocuments.signToken })
      .from(contractDocuments)
      .where(
        and(
          eq(contractDocuments.subjectType, input.subjectType),
          eq(contractDocuments.subjectId, input.subjectId),
          eq(contractDocuments.status, "issued"),
        ),
      )
      .orderBy(desc(contractDocuments.issuedAt))
      .limit(1);
    return { token: found?.token ?? null };
  },
});

export const listContracts = defineService({
  name: "contracts.list",
  summary: "Agreements issued, signed and outstanding.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: z.uuid().optional(),
    subjectType: z.string().trim().max(50).optional(),
    subjectId: z.uuid().optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(documentRow),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // The signing token is never selected. It is a credential, and a list is
    // the easiest place in the product for one to reach a log or a screenshot.
    return ctx.tx
      .select({
        id: contractDocuments.id,
        contactId: contractDocuments.contactId,
        subjectType: contractDocuments.subjectType,
        subjectId: contractDocuments.subjectId,
        kind: contractDocuments.kind,
        title: contractDocuments.title,
        status: contractDocuments.status,
        bodyHash: contractDocuments.bodyHash,
        issuedAt: contractDocuments.issuedAt,
        signedAt: contractDocuments.signedAt,
        signerName: contractDocuments.signerName,
      })
      .from(contractDocuments)
      .where(
        and(
          input.contactId ? eq(contractDocuments.contactId, input.contactId) : undefined,
          input.subjectType
            ? eq(contractDocuments.subjectType, input.subjectType)
            : undefined,
          input.subjectId ? eq(contractDocuments.subjectId, input.subjectId) : undefined,
          input.status ? eq(contractDocuments.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(contractDocuments.issuedAt))
      .limit(input.limit);
  },
});

export const getContract = defineService({
  name: "contracts.get",
  summary: "One agreement, with the evidence of who signed it and how.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: documentRow
    .extend({
      body: z.string(),
      signerEmail: z.string().nullable(),
      signerIp: z.string().nullable(),
      signerUserAgent: z.string().nullable(),
      signatureHash: z.string().nullable(),
      /** Recomputed on read: proof the stored body is the one that was signed. */
      bodyIntact: z.boolean(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [found] = await ctx.tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.id, input.id))
      .limit(1);
    if (!found) return null;
    return {
      ...found,
      body: found.bodySnapshot,
      // Checked rather than assumed. A stored hash nobody ever recomputes
      // proves nothing at all — it is a comment with a database column.
      bodyIntact: sha256(found.bodySnapshot) === found.bodyHash,
    };
  },
});

export const voidContract = defineService({
  name: "contracts.void",
  summary: "Withdraw an agreement that was never signed.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [voided] = await ctx.tx
      .update(contractDocuments)
      .set({ status: "void", signToken: null, updatedAt: new Date() })
      .where(
        and(eq(contractDocuments.id, input.id), eq(contractDocuments.status, "issued")),
      )
      .returning({ id: contractDocuments.id });
    // A signed agreement cannot be withdrawn. What was agreed happened, and
    // the honest move is a second document saying otherwise.
    if (!voided) {
      throw new ServiceError(
        "conflict",
        "Only an agreement nobody has signed yet can be withdrawn.",
      );
    }
    ctx.setSubject("contract", voided.id);
    return voided;
  },
});

/**
 * What a merge means for an agreement (CLAUDE.md's non-negotiable).
 *
 * Unconditional. A waiver somebody signed is theirs whichever of two duplicate
 * records the business happened to file it under, and leaving it pointing at
 * the record that no longer exists would orphan the one document the business
 * most needs to be able to find.
 */
registerContactReference({
  table: "contract_documents",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contractDocuments)
      .set({ contactId: survivingId })
      .where(eq(contractDocuments.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: contractDocuments.id, contactId: contractDocuments.contactId })
      .from(contractDocuments)
      .where(inArray(contractDocuments.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((document) => document.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(contractDocuments)
        .set({ contactId: duplicateId })
        .where(inArray(contractDocuments.id, moved.map((document) => document.id)));
    }
  },
});

/**
 * What an agreement means for the person's own data (§30).
 *
 * Erasure blanks the *signer* and keeps the document, which is the opposite of
 * what it does to a waitlist entry and for a good reason: a signed waiver is a
 * record of a legal position the business relied on, and deleting it would
 * destroy the business's own evidence along with the person's data. The body
 * and hashes stay; who signed it goes.
 */
registerContactPrivacySource({
  scope: "contact.contracts",
  tables: ["contract_documents"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.contactId, contactId))
      .orderBy(asc(contractDocuments.issuedAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(contractDocuments)
      .set({
        signerName: null,
        signerEmail: null,
        signerIp: null,
        signerUserAgent: null,
        // A live signing link that outlived the request would be a way back to
        // a document they asked to be forgotten from.
        signToken: null,
        updatedAt: new Date(),
      })
      .where(eq(contractDocuments.contactId, contactId))
      .returning({ id: contractDocuments.id });
    return { affected: rows.length };
  },
});

export default [
  issueContract,
  contractByToken,
  signedForSubject,
  signingLink,
  signContract,
  declineContract,
  listContracts,
  getContract,
  voidContract,
];
