// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Named roles and stored per-module grants (MASTER.md §43 C1.01).
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { roleGrants, roles, users } from "@/core/auth/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  listServices,
  ServiceError,
  type GrantAccess,
} from "@/core/service";

const roleKeyResult = z.object({ key: z.string() });
const roleRow = row({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  assignable: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  grants: listed(
    row({
      module: z.string(),
      access: z.enum(["view", "manage"]),
    }),
  ),
  users: z.number(),
});

const roleKey = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, numbers, and hyphens");
const grant = z.object({
  module: z.string().min(1).max(80),
  access: z.enum(["view", "manage"]),
});

function installedModules(): Map<
  string,
  { queries: number; mutations: number }
> {
  const modules = new Map<string, { queries: number; mutations: number }>();
  modules.set("*", { queries: 1, mutations: 1 });
  // The admin shell is a grant-bearing surface even though it is not a
  // service. Without it, a customer with only personal auth access could walk
  // into an empty admin shell.
  modules.set("admin", { queries: 1, mutations: 0 });
  for (const service of listServices().values()) {
    if (service.def.permission !== "scoped") continue;
    const module = service.def.name.split(".")[0]!;
    const totals = modules.get(module) ?? { queries: 0, mutations: 0 };
    if (service.def.kind === "query") totals.queries += 1;
    else totals.mutations += 1;
    modules.set(module, totals);
  }
  return modules;
}

function assertGrants(
  values: Array<{ module: string; access: GrantAccess }>,
): void {
  const known = installedModules();
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.module)) {
      throw new ServiceError(
        "validation",
        `Choose ${value.module} only once.`,
      );
    }
    seen.add(value.module);
    if (value.module !== "*" && !known.has(value.module)) {
      throw new ServiceError(
        "validation",
        `${value.module} is not an installed permission module.`,
      );
    }
  }
}

function keyFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export const listRoleModules = defineService({
  name: "roles.modules",
  summary: "List installed modules a named role can be granted.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      module: z.string(),
      queries: z.number().int(),
      mutations: z.number().int(),
    }),
  ),
  handler: async () =>
    [...installedModules()]
      .map(([module, totals]) => ({ module, ...totals }))
      .sort((a, b) => a.module.localeCompare(b.module)),
});

export const listRoles = defineService({
  name: "roles.list",
  summary: "List named roles, their stored grants, and assignment counts.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(roleRow),
  handler: async (_input, ctx) => {
    const [rows, grants, assignments] = await Promise.all([
      ctx.tx.select().from(roles).orderBy(asc(roles.name)),
      ctx.tx
        .select({
          roleKey: roleGrants.roleKey,
          module: roleGrants.module,
          access: roleGrants.access,
        })
        .from(roleGrants)
        .orderBy(asc(roleGrants.module)),
      ctx.tx
        .select({ roleKey: users.role, users: count() })
        .from(users)
        .groupBy(users.role),
    ]);
    return rows.map((row) => ({
      ...row,
      grants: grants
        .filter((entry) => entry.roleKey === row.key)
        .map(({ roleKey: _roleKey, ...entry }) => entry),
      users: assignments.find((entry) => entry.roleKey === row.key)?.users ?? 0,
    }));
  },
});

export const createRole = defineService({
  name: "roles.create",
  summary: "Create an owner-defined named role with per-module grants.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    name: z.string().trim().min(2).max(80),
    key: roleKey.optional(),
    description: z.string().trim().max(500).default(""),
    grants: z.array(grant).max(100).default([]),
  }),
  output: roleKeyResult,
  handler: async (input, ctx) => {
    assertGrants(input.grants);
    const key = input.key ?? keyFromName(input.name);
    if (!roleKey.safeParse(key).success) {
      throw new ServiceError(
        "validation",
        "The role name must contain at least two letters or numbers.",
      );
    }
    await ctx.tx
      .insert(roles)
      .values({
        key,
        name: input.name,
        description: input.description,
        isSystem: false,
        assignable: true,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError("conflict", "A role with that key already exists.");
        }
        throw error;
      });
    if (input.grants.length > 0) {
      await ctx.tx
        .insert(roleGrants)
        .values(input.grants.map((entry) => ({ roleKey: key, ...entry })));
    }
    ctx.setSubject("role", key);
    ctx.queueEvent("role.created", { key, name: input.name });
    return { key };
  },
});

export const updateRole = defineService({
  name: "roles.update",
  summary: "Update a role and atomically replace its module grants.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    key: roleKey,
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(""),
    grants: z.array(grant).max(100),
  }),
  output: roleKeyResult,
  handler: async (input, ctx) => {
    assertGrants(input.grants);
    const [existing] = await ctx.tx
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, input.key))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "Role not found.");

    // The owner is the recovery path for every other grant mistake. Its
    // authority is still a stored row; this guard only refuses deleting that
    // last recovery row through the ordinary editor.
    if (
      input.key === "owner" &&
      !input.grants.some(
        (entry) => entry.module === "*" && entry.access === "manage",
      )
    ) {
      throw new ServiceError(
        "validation",
        "The owner role must retain full manage access.",
      );
    }

    await ctx.tx
      .update(roles)
      .set({ name: input.name, description: input.description })
      .where(eq(roles.key, input.key));
    await ctx.tx
      .delete(roleGrants)
      .where(eq(roleGrants.roleKey, input.key));
    if (input.grants.length > 0) {
      await ctx.tx.insert(roleGrants).values(
        input.grants.map((entry) => ({ roleKey: input.key, ...entry })),
      );
    }
    ctx.setSubject("role", input.key);
    ctx.queueEvent("role.updated", { key: input.key });
    return { key: input.key };
  },
});

export const deleteRole = defineService({
  name: "roles.delete",
  summary: "Delete an unused owner-defined role.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ key: roleKey }),
  output: roleKeyResult,
  handler: async (input, ctx) => {
    const [role] = await ctx.tx
      .select({ isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.key, input.key))
      .limit(1);
    if (!role) throw new ServiceError("not_found", "Role not found.");
    if (role.isSystem) {
      throw new ServiceError(
        "conflict",
        "Built-in roles can be renamed and reconfigured, but not deleted.",
      );
    }
    const [assigned] = await ctx.tx
      .select({ users: count() })
      .from(users)
      .where(eq(users.role, input.key));
    if ((assigned?.users ?? 0) > 0) {
      throw new ServiceError(
        "conflict",
        "Move every account to another role before deleting this one.",
      );
    }
    await ctx.tx.delete(roles).where(eq(roles.key, input.key));
    ctx.setSubject("role", input.key);
    ctx.queueEvent("role.deleted", { key: input.key });
    return { key: input.key };
  },
});

export const listRoleUsers = defineService({
  name: "roles.users",
  summary: "List accounts and the named roles assigned to them.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      email: z.string(),
      role: z.string(),
      lastLoginAt: timestamp.nullable(),
    }),
  ),
  handler: async (_input, ctx) =>
    ctx.tx
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.email)),
});

export const assignRole = defineService({
  name: "roles.assign",
  summary: "Assign an existing non-owner account to a named role.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ userId: z.string().uuid(), roleKey }),
  output: z.object({ userId: uuid, role: z.string() }),
  handler: async (input, ctx) => {
    const [targetRole] = await ctx.tx
      .select({ assignable: roles.assignable })
      .from(roles)
      .where(eq(roles.key, input.roleKey))
      .limit(1);
    if (!targetRole) throw new ServiceError("not_found", "Role not found.");
    if (!targetRole.assignable) {
      throw new ServiceError("validation", "That role cannot be assigned.");
    }
    const [account] = await ctx.tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!account) throw new ServiceError("not_found", "Account not found.");
    if (account.role === "owner") {
      throw new ServiceError(
        "conflict",
        "The owner account cannot be reassigned through role management.",
      );
    }
    const [updated] = await ctx.tx
      .update(users)
      .set({ role: input.roleKey })
      .where(and(eq(users.id, input.userId), eq(users.role, account.role)))
      .returning({ id: users.id });
    if (!updated) {
      throw new ServiceError(
        "conflict",
        "That account changed while you were assigning it. Reload and try again.",
      );
    }
    ctx.setSubject("user", input.userId);
    ctx.queueEvent("role.assigned", {
      userId: input.userId,
      from: account.role,
      to: input.roleKey,
    });
    return { userId: input.userId, role: input.roleKey };
  },
});

export default [
  assignRole,
  createRole,
  deleteRole,
  listRoleModules,
  listRoles,
  listRoleUsers,
  updateRole,
];
