// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Organization groups on the Contact spine (MASTER.md C1.06).
import { asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { applyCustomFieldPatch } from "@/core/contacts/custom-fields";
import { contacts, organizations } from "@/core/contacts/schema";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError } from "@/core/service";

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/,
    "Enter a domain such as example.com, without https:// or a path.",
  );

const organizationFields = z.object({
  name: z.string().trim().min(1).max(200),
  domain: domainSchema.nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

const organizationRow = row({
  id: uuid,
  name: z.string(),
  domain: z.string().nullable(),
  customFields: z.unknown(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

function domainConflict(error: unknown, domain: string | null | undefined): never {
  if (domain && isUniqueViolation(error, "organizations_domain_idx")) {
    throw new ServiceError(
      "conflict",
      `${domain} is already assigned to another organization.`,
    );
  }
  throw error;
}

export const createOrganization = defineService({
  name: "contacts.createOrganization",
  summary: "Create an organization that contacts can belong to.",
  kind: "mutation",
  permission: "scoped",
  input: organizationFields,
  output: organizationRow,
  handler: async (input, ctx) => {
    const customFields = await applyCustomFieldPatch(
      ctx.tx,
      "organization",
      input.customFields,
    );
    try {
      const [organization] = await ctx.tx
        .insert(organizations)
        .values({ ...input, customFields })
        .returning();
      ctx.setSubject("organization", organization!.id);
      return organization!;
    } catch (error) {
      domainConflict(error, input.domain);
    }
  },
});

export const updateOrganization = defineService({
  name: "contacts.updateOrganization",
  summary: "Update an organization without replacing its members.",
  kind: "mutation",
  permission: "scoped",
  input: organizationFields.partial().extend({ id: z.string().uuid() }),
  output: organizationRow,
  handler: async (input, ctx) => {
    const { id, ...requested } = input;
    const [existing] = await ctx.tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That organization no longer exists.");
    if (Object.keys(requested).length === 0) {
      throw new ServiceError("validation", "Choose something to change.");
    }
    const customFields = requested.customFields
      ? await applyCustomFieldPatch(
          ctx.tx,
          "organization",
          requested.customFields,
          existing.customFields as Record<string, unknown>,
        )
      : undefined;
    try {
      const [updated] = await ctx.tx
        .update(organizations)
        .set({ ...requested, customFields })
        .where(eq(organizations.id, id))
        .returning();
      ctx.setSubject("organization", id);
      return updated!;
    } catch (error) {
      domainConflict(error, requested.domain);
    }
  },
});

export const getOrganization = defineService({
  name: "contacts.getOrganization",
  summary: "Fetch one organization from the Contact spine.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: organizationRow,
  handler: async (input, ctx) => {
    const [organization] = await ctx.tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.id))
      .limit(1);
    if (!organization) {
      throw new ServiceError("not_found", "That organization no longer exists.");
    }
    return organization;
  },
});

export const listOrganizations = defineService({
  name: "contacts.listOrganizations",
  summary: "Search and page through organizations with member counts.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    search: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    rows: listed(organizationRow.and(row({ memberCount: z.number().int() }))),
    total: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const where = input.search
      ? or(
          ilike(organizations.name, `%${input.search}%`),
          ilike(organizations.domain, `%${input.search}%`),
        )
      : undefined;
    const rows = await ctx.tx
      .select()
      .from(organizations)
      .where(where)
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(input.limit)
      .offset(input.offset);
    const ids = rows.map((row) => row.id);
    const counts = ids.length
      ? await ctx.tx
          .select({ orgId: contacts.orgId, n: count() })
          .from(contacts)
          .where(inArray(contacts.orgId, ids))
          .groupBy(contacts.orgId)
      : [];
    const byId = new Map(counts.map((row) => [row.orgId, row.n]));
    const [total] = await ctx.tx.select({ n: count() }).from(organizations).where(where);
    return {
      rows: rows.map((row) => ({ ...row, memberCount: byId.get(row.id) ?? 0 })),
      total: total?.n ?? 0,
    };
  },
});

export const deleteOrganization = defineService({
  name: "contacts.deleteOrganization",
  summary: "Delete an empty organization while preserving every contact.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [member] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.orgId, input.id))
      .limit(1);
    if (member) {
      throw new ServiceError(
        "conflict",
        "Move this organization's contacts before deleting it.",
      );
    }
    const [deleted] = await ctx.tx
      .delete(organizations)
      .where(eq(organizations.id, input.id))
      .returning({ id: organizations.id });
    if (!deleted) throw new ServiceError("not_found", "That organization no longer exists.");
    ctx.setSubject("organization", input.id);
    return { ok: true };
  },
});

export default [
  createOrganization,
  updateOrganization,
  getOrganization,
  listOrganizations,
  deleteOrganization,
];
