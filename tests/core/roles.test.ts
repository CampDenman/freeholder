// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Named roles and stored module grants (MASTER.md §43 C1.01).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { roleGrants, roles, users } from "@/core/auth/schema";
import { createSession, validateSession } from "@/core/auth/sessions";
import { createContact, listContacts } from "@/core/contacts/service";
import { auditLog } from "@/core/events/schema";
import {
  assignRole,
  createRole,
  deleteRole,
  listRoleModules,
  listRoles,
  updateRole,
} from "@/core/roles/service";
import type { Actor } from "@/core/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const USER_ID = "00000000-0000-4000-8000-000000000080";

async function realiseAccounts(): Promise<void> {
  await db().insert(users).values([
    { id: OWNER.userId, email: "owner@example.test", role: "owner" },
    { id: USER_ID, email: "editor@example.test", role: "editor" },
  ]);
}

describe.runIf(hasDatabase)("named roles and module grants", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseAccounts();
  });

  afterAll(closeDb);

  it("seeds every promised default as data, including rollback compatibility", async () => {
    const rows = await db().select().from(roles);
    expect(rows.map((row) => row.key).sort()).toEqual([
      "administrator",
      "bookkeeper",
      "customer",
      "editor",
      "owner",
      "service-provider",
      "staff",
    ]);
    const owner = await db()
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.roleKey, "owner"));
    expect(owner).toMatchObject([{ module: "*", access: "manage" }]);
    expect(rows.find((row) => row.key === "staff")?.assignable).toBe(false);
  });

  it("derives grantable modules from the live service registry", async () => {
    const modules = await listRoleModules.call({}, OWNER);
    expect(modules.map((entry) => entry.module)).toEqual(
      expect.arrayContaining(["*", "admin", "contacts", "roles"]),
    );
    const contacts = modules.find((entry) => entry.module === "contacts");
    expect(contacts?.queries).toBeGreaterThan(0);
    expect(contacts?.mutations).toBeGreaterThan(0);
  });

  it("creates and updates a named role with an auditable atomic grant set", async () => {
    const created = await createRole.call(
      {
        name: "Contact observer",
        description: "Reads contacts without changing them.",
        grants: [{ module: "contacts", access: "view" }],
      },
      OWNER,
    );
    expect(created.key).toBe("contact-observer");

    await updateRole.call(
      {
        key: created.key,
        name: "Contact steward",
        description: "May maintain contacts.",
        grants: [{ module: "contacts", access: "manage" }],
      },
      OWNER,
    );
    const catalogue = await listRoles.call({}, OWNER);
    expect(catalogue.find((role) => role.key === created.key)).toMatchObject({
      name: "Contact steward",
      grants: [{ module: "contacts", access: "manage" }],
    });
    const audit = await db()
      .select({ action: auditLog.action, subjectId: auditLog.subjectId })
      .from(auditLog)
      .where(eq(auditLog.subjectId, created.key));
    expect(audit.map((entry) => entry.action)).toEqual([
      "roles.create",
      "roles.update",
    ]);
  });

  it("lets view read, requires manage to change, and ignores the role name", async () => {
    const viewer: Actor = {
      kind: "user",
      userId: USER_ID,
      role: "whatever-label",
      grants: [{ module: "contacts", access: "view" }],
    };
    await expect(listContacts.call({}, viewer)).resolves.toMatchObject({
      rows: [],
    });
    expect(
      (await failure(
        createContact.call({ name: "No write" }, viewer),
      )).code,
    ).toBe("permission");

    const manager: Actor = {
      ...viewer,
      grants: [{ module: "contacts", access: "manage" }],
    };
    await expect(
      createContact.call({ name: "Allowed write" }, manager),
    ).resolves.toMatchObject({ name: "Allowed write" });
  });

  it("reloads grants through an existing session after assignment", async () => {
    const session = await db().transaction((tx) => createSession(tx, USER_ID));
    const before = await db().transaction((tx) => validateSession(tx, session.token));
    expect(before).toMatchObject({ role: "editor" });
    expect(before?.grants).toContainEqual({ module: "cms", access: "manage" });

    await assignRole.call(
      { userId: USER_ID, roleKey: "bookkeeper" },
      OWNER,
    );
    const after = await db().transaction((tx) => validateSession(tx, session.token));
    expect(after).toMatchObject({ role: "bookkeeper" });
    expect(after?.grants).toContainEqual({ module: "contacts", access: "view" });
    expect(after?.grants).not.toContainEqual({ module: "cms", access: "manage" });
  });

  it("protects the recovery role and refuses deletion while assigned", async () => {
    const ownerError = await failure(
      updateRole.call(
        {
          key: "owner",
          name: "Owner",
          description: "",
          grants: [],
        },
        OWNER,
      ),
    );
    expect(ownerError.code).toBe("validation");

    const created = await createRole.call(
      { name: "Temporary staff", grants: [] },
      OWNER,
    );
    await assignRole.call({ userId: USER_ID, roleKey: created.key }, OWNER);
    expect((await failure(deleteRole.call({ key: created.key }, OWNER))).code).toBe(
      "conflict",
    );
    expect((await failure(deleteRole.call({ key: "editor" }, OWNER))).code).toBe(
      "conflict",
    );
  });
});

describe("the additive migration", () => {
  it("seeds all defaults before constraining legacy user rows", () => {
    const sql = readFileSync(
      "db/migrations/0017_named-roles-grants.sql",
      "utf8",
    );
    for (const key of [
      "owner",
      "administrator",
      "editor",
      "bookkeeper",
      "service-provider",
      "customer",
      "staff",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql.indexOf("INSERT INTO \"roles\"")).toBeLessThan(
      sql.indexOf("users_role_roles_key_fk"),
    );
  });
});
