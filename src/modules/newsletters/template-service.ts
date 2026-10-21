// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Templates every kind of message shares (MASTER.md §30, §4.9, C9.05).
//
// The rendering itself is `cms/email-render.ts`, which already turns a block
// tree into inbox-safe table HTML and fills `{{slots}}`. This file is about
// everything around that: which template, in which language, with which
// variables promised — and whether the sender actually supplied them.
//
// **The check is the point.** §30 calls them "locked variable slots", and a
// slot that silently renders as `{{invoice.total}}` in a customer's receipt is
// worse than an error, because nobody finds out until the customer does. So a
// template declares what it needs and `renderTemplate` refuses to render
// without it.
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { entityTranslations } from "@/core/i18n/schema";
import { users } from "@/core/auth/schema";
import { renderEmailHtml, renderEmailText, EMAIL_SLOTS } from "@/modules/cms/email-render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { TEMPLATE_KINDS, emailTemplates } from "./template-schema";

const ENTITY = "email_template";

const templateRow = row({
  id: uuidSchema,
  kind: z.enum(TEMPLATE_KINDS),
  name: z.string(),
  slug: z.string().nullable(),
  subject: z.string(),
  blocks: z.unknown(),
  variables: z.unknown(),
  status: z.enum(["draft", "active", "archived"]),
  /** Whether an owner has edited away from what shipped. */
  customised: z.boolean(),
  updatedAt: z.date(),
});

/** The slot list a template declares, read defensively — it is jsonb. */
function slotsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];
}

function blocksOf(value: unknown): BlockNode[] {
  return Array.isArray(value) ? (value as BlockNode[]) : [];
}

/**
 * Whether the owner has edited away from the shipped wording.
 *
 * Compared rather than flagged. A flag has to be set by whoever edits, and the
 * one edit path that forgets makes "reset to default" lie about whether there
 * is anything to reset.
 */
function isCustomised(rowValue: {
  subject: string;
  blocks: unknown;
  defaultSubject: string | null;
  defaultBlocks: unknown;
}): boolean {
  if (rowValue.defaultBlocks === null || rowValue.defaultBlocks === undefined) return false;
  return (
    rowValue.subject !== (rowValue.defaultSubject ?? "") ||
    JSON.stringify(rowValue.blocks) !== JSON.stringify(rowValue.defaultBlocks)
  );
}

function view(rowValue: typeof emailTemplates.$inferSelect) {
  return {
    id: rowValue.id,
    kind: rowValue.kind,
    name: rowValue.name,
    slug: rowValue.slug,
    subject: rowValue.subject,
    blocks: rowValue.blocks,
    variables: rowValue.variables,
    status: rowValue.status,
    customised: isCustomised(rowValue),
    updatedAt: rowValue.updatedAt,
  };
}

/**
 * The subject and blocks for one locale.
 *
 * The default locale is the row itself — §4.9's rule, and the reason
 * `entity_translations` never holds one. A locale with no translation falls
 * back rather than failing: a receipt in the wrong language still tells
 * somebody what they were charged, and refusing to send would be worse.
 */
async function localised(
  tx: Tx,
  template: typeof emailTemplates.$inferSelect,
  locale: string | null,
): Promise<{ subject: string; blocks: BlockNode[]; locale: string | null }> {
  if (!locale) {
    return { subject: template.subject, blocks: blocksOf(template.blocks), locale: null };
  }
  const [translation] = await tx
    .select({ fields: entityTranslations.fields })
    .from(entityTranslations)
    .where(
      and(
        eq(entityTranslations.entityType, ENTITY),
        eq(entityTranslations.entityId, template.id),
        eq(entityTranslations.locale, locale),
      ),
    );
  const fields = (translation?.fields ?? {}) as { subject?: unknown; blocks?: unknown };
  return {
    subject: typeof fields.subject === "string" ? fields.subject : template.subject,
    blocks: Array.isArray(fields.blocks) ? (fields.blocks as BlockNode[]) : blocksOf(template.blocks),
    locale: translation ? locale : null,
  };
}

/* ------------------------------------------------------------- authoring */

export const saveTemplate = defineService({
  name: "templates.save",
  writeClass: "write",
  summary: "Create or change a message template.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    kind: z.enum(TEMPLATE_KINDS),
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, "Use dotted lowercase, like invoice.sent.")
      .max(80)
      .nullish(),
    subject: z.string().trim().max(300).default(""),
    blocks: z.array(z.unknown()).default([]),
    variables: z.array(z.enum(EMAIL_SLOTS)).max(20).default([]),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
  }),
  output: templateRow,
  handler: async (input, ctx) => {
    const [actingUser] =
      ctx.actor.kind === "user"
        ? await ctx.tx.select({ id: users.id }).from(users).where(eq(users.id, ctx.actor.userId))
        : [];

    const values = {
      kind: input.kind,
      name: input.name,
      slug: input.slug ?? null,
      subject: input.subject,
      blocks: input.blocks,
      variables: input.variables,
      status: input.status,
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(emailTemplates)
        .set(values)
        .where(eq(emailTemplates.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such template.");
      ctx.setSubject("email_template", updated.id);
      return view(updated);
    }

    const [created] = await ctx.tx
      .insert(emailTemplates)
      .values({ ...values, createdByUserId: actingUser?.id ?? null })
      .returning();
    ctx.setSubject("email_template", created!.id);
    ctx.queueEvent("template.saved", { templateId: created!.id, kind: created!.kind });
    return view(created!);
  },
});

/**
 * Put the shipped wording back.
 *
 * §30's escape hatch. It restores rather than deletes: an owner who resets and
 * immediately regrets it has lost their edit either way, but a delete would
 * also lose the slug, the variables and every translation hanging off the id.
 */
export const resetTemplate = defineService({
  name: "templates.reset",
  writeClass: "write",
  summary: "Put a template back to the wording it shipped with.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: templateRow,
  handler: async (input, ctx) => {
    const [template] = await ctx.tx
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, input.id));
    if (!template) throw new ServiceError("not_found", "There is no such template.");
    if (template.defaultBlocks === null) {
      throw new ServiceError(
        "conflict",
        "This template was written here, so there is no default to go back to.",
      );
    }
    const [restored] = await ctx.tx
      .update(emailTemplates)
      .set({
        subject: template.defaultSubject ?? "",
        blocks: template.defaultBlocks,
      })
      .where(eq(emailTemplates.id, template.id))
      .returning();
    ctx.setSubject("email_template", template.id);
    ctx.queueEvent("template.reset", { templateId: template.id });
    return view(restored!);
  },
});

export const listTemplates = defineService({
  name: "templates.list",
  summary: "Message templates, by kind.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: z.enum(TEMPLATE_KINDS).optional(),
    status: z.enum(["draft", "active", "archived"]).optional(),
  }),
  output: listed(templateRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(emailTemplates)
      .where(
        and(
          input.kind ? eq(emailTemplates.kind, input.kind) : undefined,
          input.status ? eq(emailTemplates.status, input.status) : undefined,
        ),
      )
      .orderBy(asc(emailTemplates.kind), asc(emailTemplates.name));
    return rows.map(view);
  },
});

export const getTemplate = defineService({
  name: "templates.get",
  summary: "One template, with the locales it has been translated into.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ template: templateRow, locales: z.array(z.string()) }),
  handler: async (input, ctx) => {
    const [template] = await ctx.tx
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, input.id));
    if (!template) throw new ServiceError("not_found", "There is no such template.");
    const translations = await ctx.tx
      .select({ locale: entityTranslations.locale })
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityType, ENTITY),
          eq(entityTranslations.entityId, template.id),
        ),
      )
      .orderBy(asc(entityTranslations.locale));
    return { template: view(template), locales: translations.map((each) => each.locale) };
  },
});

/* -------------------------------------------------------------- rendering */

const renderedRow = row({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  /** Which locale actually rendered, so a caller can tell a fallback apart. */
  locale: z.string().nullable(),
});

/**
 * Render one template for one recipient.
 *
 * Refuses when a promised slot has no value. §30 calls these locked slots, and
 * a receipt that reaches somebody saying `{{invoice.total}}` is worse than a
 * failed send: the send can be retried, the impression cannot.
 */
export const renderTemplate = defineService({
  name: "templates.render",
  summary: "Render a template for one recipient, in their language.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    slug: z.string().trim().max(80).optional(),
    locale: z.string().trim().max(20).nullish(),
    variables: z.record(z.string(), z.string()).default({}),
  }),
  output: renderedRow,
  handler: async (input, ctx) => {
    if (!input.id && !input.slug) {
      throw new ServiceError("validation", "Name the template by id or by slug.");
    }
    const [template] = await ctx.tx
      .select()
      .from(emailTemplates)
      .where(
        input.id
          ? eq(emailTemplates.id, input.id)
          : eq(emailTemplates.slug, input.slug!),
      );
    if (!template) throw new ServiceError("not_found", "There is no such template.");

    const promised = slotsOf(template.variables);
    const missing = promised.filter((slot) => !(slot in input.variables));
    if (missing.length > 0) {
      throw new ServiceError(
        "validation",
        `This template needs ${missing.join(", ")} and did not get ${missing.length === 1 ? "it" : "them"}.`,
      );
    }

    const chosen = await localised(ctx.tx, template, input.locale ?? null);
    const vars = input.variables as Parameters<typeof renderEmailHtml>[1];
    return {
      subject: fillSubject(chosen.subject, input.variables),
      html: renderEmailHtml(chosen.blocks, vars),
      text: renderEmailText(chosen.blocks, vars),
      locale: chosen.locale,
    };
  },
});

/**
 * The subject line takes slots too.
 *
 * "Your receipt from {{business.name}}" is the line somebody sees in their
 * inbox list, and it is the one place an unfilled slot is guaranteed to be
 * read. The same substitution the body uses, applied to one string.
 */
function fillSubject(subject: string, vars: Record<string, string>): string {
  return subject.replace(/\{\{\s*([a-z0-9._]+)\s*\}\}/gi, (_match, slot: string) => {
    return vars[slot.trim()] ?? `{{${slot.trim()}}}`;
  });
}

export const templateSlots = defineService({
  name: "templates.slots",
  summary: "The variable slots a template may promise.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(row({ slot: z.string() })),
  // From the block library rather than a list here, so the editor's palette
  // and the sender's contract can never disagree about what exists.
  handler: () => Promise.resolve(EMAIL_SLOTS.map((slot) => ({ slot }))),
});

export default [
  saveTemplate,
  resetTemplate,
  listTemplates,
  getTemplate,
  renderTemplate,
  templateSlots,
];
