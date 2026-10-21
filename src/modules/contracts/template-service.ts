// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Writing agreements once and issuing them many times (§4.3, C6.14).
//
// The authoring half of C6.09's signing half, and it deliberately changes
// nothing about how a signature works. `contracts.issueFromTemplate` renders a
// body and then calls the same `contracts.issue` a hand-typed waiver does, so
// there is exactly one path that produces a signable document and exactly one
// definition of what "signed" means.
//
// **Templates are versioned rather than edited in place.** A document issued
// last month points at the version it came from; an owner tightening their
// terms today publishes a new version and leaves that pointer valid. The
// alternative — editing the row — would quietly change what a stored document
// claims to be derived from, which is the one thing a template must never do.
import { z } from "zod";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { getBusiness } from "@/core/settings/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import {
  CONTRACT_KINDS,
  contractDocuments,
  contractTemplates,
} from "./schema";
import { renderTemplate, templateVariable, variablesIn } from "./templates";

const id = z.string().uuid();

/**
 * A person, or the platform acting for one.
 *
 * `permission: "scoped"` already refuses anonymous and unscoped callers. The
 * system actor passes so an accepted quote can issue the agreement its
 * conversion plan named (C6.13) — elevation from a caller that has already
 * established authority, which is the same reasoning C6.09 arrived at the
 * hard way.
 */
function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage templates.");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const templateRow = row({
  id: uuid,
  name: z.string(),
  kind: z.enum(CONTRACT_KINDS),
  version: z.number().int(),
  title: z.string(),
  body: z.string(),
  variables: z.unknown(),
  requiresCountersignature: z.boolean(),
  archivedAt: timestamp.nullable(),
});

export const saveTemplate = defineService({
  name: "contracts.saveTemplate",
  summary: "Write or revise a reusable agreement.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(CONTRACT_KINDS).default("waiver"),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(200_000),
    variables: z.array(templateVariable).max(50).default([]),
    requiresCountersignature: z.boolean().default(false),
  }),
  output: templateRow.extend({ undeclared: listed(z.string()) }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [latest] = await ctx.tx
      .select({ version: contractTemplates.version })
      .from(contractTemplates)
      .where(eq(contractTemplates.name, input.name))
      .orderBy(desc(contractTemplates.version))
      .limit(1);

    // A new version every time, never an edit. A document issued from version
    // 2 must keep meaning version 2 after the owner writes version 3.
    const [saved] = await ctx.tx
      .insert(contractTemplates)
      .values({
        name: input.name,
        kind: input.kind,
        version: (latest?.version ?? 0) + 1,
        title: input.title,
        body: input.body,
        variables: input.variables,
        requiresCountersignature: input.requiresCountersignature,
      })
      .returning();

    // Reported rather than refused: a variable the owner has not described yet
    // still renders, and telling them which ones are undeclared is more useful
    // than refusing to save the draft they are halfway through.
    const declared = new Set(input.variables.map((variable) => variable.key.toLowerCase()));
    const undeclared = variablesIn(input.body).filter((key) => !declared.has(key));
    ctx.setSubject("contractTemplate", saved!.id);
    return { ...saved!, undeclared };
  },
});

export const listTemplates = defineService({
  name: "contracts.listTemplates",
  summary: "The agreements the business can send, latest version first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: z.enum(CONTRACT_KINDS).optional(),
    includeArchived: z.boolean().default(false),
  }),
  output: listed(templateRow),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    return ctx.tx
      .select()
      .from(contractTemplates)
      .where(
        and(
          input.kind ? eq(contractTemplates.kind, input.kind) : undefined,
          input.includeArchived ? undefined : isNull(contractTemplates.archivedAt),
        ),
      )
      .orderBy(asc(contractTemplates.name), desc(contractTemplates.version));
  },
});

export const archiveTemplate = defineService({
  name: "contracts.archiveTemplate",
  summary: "Stop offering a template without losing what it said.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Archived, never deleted: documents issued from it still name it, and a
    // pointer to a row that no longer exists is evidence nobody can read.
    const [archived] = await ctx.tx
      .update(contractTemplates)
      .set({ archivedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(contractTemplates.id, input.id))
      .returning({ id: contractTemplates.id });
    if (!archived) throw new ServiceError("not_found", "That template is not here.");
    ctx.setSubject("contractTemplate", archived.id);
    return archived;
  },
});

export const previewTemplate = defineService({
  name: "contracts.previewTemplate",
  summary: "See a template as one particular customer would.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id,
    contactId: id.optional(),
    values: z.record(z.string(), z.string()).optional(),
  }),
  output: z.object({
    title: z.string(),
    body: z.string(),
    /** Variables nothing supplied, left visible in the body. */
    missing: listed(z.string()),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [template] = await ctx.tx
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, input.id))
      .limit(1);
    if (!template) throw new ServiceError("not_found", "That template is not here.");
    const values = await standardValues(ctx, input.contactId, input.values);
    const declared = z.array(templateVariable).parse(template.variables);
    const rendered = renderTemplate(template.body, values, declared);
    return {
      title: renderTemplate(template.title, values, declared).body,
      body: rendered.body,
      missing: rendered.missing,
    };
  },
});

/**
 * The values the platform can fill in by itself, plus whatever the caller adds.
 *
 * Deliberately few. Everything here is a fact the platform is the authority on
 * — who the customer is, what the business is called, today's date — and
 * anything else is the owner's to supply, because a template that quietly
 * invented a figure would be putting words in their mouth. The caller's values
 * win, so an owner can override any of it without editing the template.
 */
async function standardValues(
  ctx: ServiceContext,
  contactId: string | undefined,
  extra: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  const business = await ctx.call(getBusiness, {});
  const values: Record<string, string> = {
    business_name: business?.name ?? "",
    today: new Date().toISOString().slice(0, 10),
  };
  if (contactId) {
    const [contact] = await ctx.tx
      .select({ name: contacts.name, email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (contact) {
      values.customer_name = contact.name;
      values.customer_email = contact.email ?? "";
    }
  }
  return { ...values, ...(extra ?? {}) };
}

export const issueFromTemplate = defineService({
  name: "contracts.issueFromTemplate",
  summary: "Send a reusable agreement to somebody, filled in for them.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    templateId: id,
    contactId: id,
    subjectType: z.string().trim().min(1).max(50).default("contact"),
    subjectId: id.nullish(),
    values: z.record(z.string(), z.string()).optional(),
  }),
  output: row({ id: uuid, title: z.string(), missing: listed(z.string()) }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [template] = await ctx.tx
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, input.templateId))
      .limit(1);
    if (!template) throw new ServiceError("not_found", "That template is not here.");
    if (template.archivedAt) {
      throw new ServiceError("conflict", "That template is archived. Choose a live one.");
    }

    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");

    // The same values the preview used, so what an owner proofread is what the
    // customer receives.
    const values = await standardValues(ctx, input.contactId, input.values);
    const declared = z.array(templateVariable).parse(template.variables);
    const rendered = renderTemplate(template.body, values, declared);
    const title = renderTemplate(template.title, values, declared).body;

    // The same door a hand-typed waiver goes through. One path produces a
    // signable document, and one definition of "signed" applies to all of them.
    const issued = (await ctx.call(getService("contracts.issue"), {
      contactId: input.contactId,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      kind: template.kind,
      title,
      body: rendered.body,
    })) as { id: string };

    // The template pointer and its countersignature rule travel with the
    // document, so it knows its own rules without asking a row that may have
    // been archived since.
    await ctx.tx
      .update(contractDocuments)
      .set({
        templateId: template.id,
        requiresCountersignature: template.requiresCountersignature,
        updatedAt: new Date(),
      })
      .where(eq(contractDocuments.id, issued.id));

    ctx.setSubject("contract", issued.id);
    return { id: issued.id, title, missing: rendered.missing };
  },
});

export const countersignContract = defineService({
  name: "contracts.countersign",
  summary: "Sign an agreement on the business's side.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  stepUp: true,
  input: z.object({
    id,
    /** Typed by whoever is signing, as on the customer's side. */
    signerName: z.string().trim().min(2).max(200),
  }),
  output: row({ id: uuid, countersignedAt: timestamp }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [document] = await ctx.tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.id, input.id))
      .limit(1);
    if (!document) throw new ServiceError("not_found", "That agreement is not here.");
    if (document.status !== "signed") {
      // Countersigning first would produce a document the business has agreed
      // to and the customer has not, which is an offer rather than an
      // agreement — and offers are quotes (C6.12).
      throw new ServiceError(
        "conflict",
        "The customer signs first. Countersign once they have.",
      );
    }
    if (document.countersignedAt) {
      throw new ServiceError("conflict", "This has already been countersigned.");
    }

    const countersignedAt = new Date();
    const countersignatureHash = sha256(
      [
        document.bodyHash,
        document.signatureHash ?? "",
        input.signerName,
        countersignedAt.toISOString(),
      ].join("\n"),
    );
    const [done] = await ctx.tx
      .update(contractDocuments)
      .set({
        countersignedAt,
        countersignerUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        countersignerName: input.signerName,
        // Chained to the customer's signature hash on purpose: the
        // countersignature is evidence about *that* signature on *that* body,
        // and a hash that did not include it could be moved to another
        // document.
        countersignatureHash,
        updatedAt: countersignedAt,
      })
      .where(eq(contractDocuments.id, document.id))
      .returning({
        id: contractDocuments.id,
        countersignedAt: contractDocuments.countersignedAt,
      });

    await ctx.emitTimeline({
      contactId: document.contactId,
      eventType: "contract.countersigned",
      subjectType: "contract",
      subjectId: document.id,
      payload: { signerName: input.signerName },
    });
    ctx.setSubject("contract", document.id);
    ctx.queueEvent("contract.countersigned", {
      id: document.id,
      contactId: document.contactId,
    });
    return { id: done!.id, countersignedAt: done!.countersignedAt! };
  },
});

/**
 * The document as a file somebody can keep.
 *
 * Plain text with the evidence appended rather than a PDF, and that is a
 * deliberate v1 choice: a PDF renderer is a dependency, a font licence and a
 * layout engine, and none of those make the document more *true*. What makes
 * it true is that the words, the hashes, the signer and the times are all
 * there and independently checkable — which they are, in a format that will
 * still open in thirty years.
 */
export const exportContract = defineService({
  name: "contracts.export",
  summary: "The agreement and its evidence, as a file.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: z.object({ filename: z.string(), body: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [document] = await ctx.tx
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.id, input.id))
      .limit(1);
    if (!document) throw new ServiceError("not_found", "That agreement is not here.");

    const lines = [
      document.title,
      "=".repeat(document.title.length),
      "",
      document.bodySnapshot,
      "",
      "---",
      `Status: ${document.status}`,
      `Issued: ${document.issuedAt.toISOString()}`,
    ];
    if (document.signedAt) {
      lines.push(
        `Signed by: ${document.signerName ?? "(erased)"}`,
        `Signed at: ${document.signedAt.toISOString()}`,
        `From: ${document.signerIp ?? "unrecorded"}`,
        `Using: ${document.signerUserAgent ?? "unrecorded"}`,
      );
    }
    if (document.countersignedAt) {
      lines.push(
        `Countersigned by: ${document.countersignerName ?? "(erased)"}`,
        `Countersigned at: ${document.countersignedAt.toISOString()}`,
      );
    }
    lines.push(
      "",
      // Both hashes, so anybody holding this file can recompute the first from
      // the words above it and check the second against it. Evidence nobody
      // can verify is decoration.
      `Document fingerprint (SHA-256 of the text above): ${document.bodyHash}`,
      document.signatureHash ? `Signature fingerprint: ${document.signatureHash}` : "",
      document.countersignatureHash
        ? `Countersignature fingerprint: ${document.countersignatureHash}`
        : "",
    );

    return {
      filename: `${document.title.replace(/[^\w.-]+/g, "-").slice(0, 80)}.txt`,
      body: lines.filter((line) => line !== "").join("\n"),
    };
  },
});

export default [
  saveTemplate,
  listTemplates,
  archiveTemplate,
  previewTemplate,
  issueFromTemplate,
  countersignContract,
  exportContract,
];
