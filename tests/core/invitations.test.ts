// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Staff invitation lifecycle (MASTER.md §43 C1.02).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import {
  roleGrants,
  staffInvitations,
  users,
} from "@/core/auth/schema";
import { login } from "@/core/auth/service";
import { auditLog } from "@/core/events/schema";
import { expireStaffInvitations } from "@/core/jobs/core-jobs";
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitationRoles,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/core/invitations/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const EMAIL = "teammate@example.test";
const PASSWORD = "a-staff-password-long-enough";

function tokenFrom(lines: string[]): string {
  const match = /\/invite\?token=([^\s]+)/.exec(lines.join("\n"));
  if (!match) throw new Error(`no invitation link in:\n${lines.join("\n")}`);
  return decodeURIComponent(match[1]!);
}

describe.runIf(hasDatabase)("staff invitations", () => {
  let logged: string[] = [];

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDb();
  });

  async function invite(roleKey = "editor") {
    const result = await createInvitation.call(
      { email: EMAIL, roleKey, expiresInDays: 7 },
      OWNER,
    );
    return { ...result, token: tokenFrom(logged) };
  }

  it("stores only a hash and truthfully reports console delivery", async () => {
    const created = await invite();
    const [row] = await db().select().from(staffInvitations);

    expect(created.delivery).toBe("logged");
    expect(row).toMatchObject({
      email: EMAIL,
      roleKey: "editor",
      status: "pending",
      sendCount: 1,
      deliveryAdapter: "console",
      lastSentAt: null,
    });
    expect(row?.tokenHash).not.toBe(created.token);
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      6 * 24 * 60 * 60 * 1000,
    );

    const audit = await db().select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain(created.token);
    expect(audit).toContainEqual(
      expect.objectContaining({
        action: "invitations.create",
        subjectType: "staff_invitation",
        subjectId: row!.id,
      }),
    );
  });

  it("offers only assignable roles that can enter the admin shell", async () => {
    const catalogue = await listInvitationRoles.call({}, OWNER);
    expect(catalogue.map((role) => role.key)).toEqual(
      expect.arrayContaining([
        "administrator",
        "bookkeeper",
        "editor",
        "service-provider",
      ]),
    );
    expect(catalogue.map((role) => role.key)).not.toContain("owner");
    expect(catalogue.map((role) => role.key)).not.toContain("customer");

    const error = await failure(
      createInvitation.call(
        { email: EMAIL, roleKey: "customer", expiresInDays: 7 },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses duplicate pending invitations and existing accounts", async () => {
    await invite();
    const duplicate = await failure(
      createInvitation.call(
        { email: EMAIL, roleKey: "editor", expiresInDays: 7 },
        OWNER,
      ),
    );
    expect(duplicate.code).toBe("conflict");

    const account = await failure(
      createInvitation.call(
        {
          email: "owner@example.test",
          roleKey: "editor",
          expiresInDays: 7,
        },
        OWNER,
      ),
    );
    expect(account.message).toMatch(/already has an account/i);
  });

  it("rotates the bearer token every time it is resent", async () => {
    const first = await invite();
    logged = [];
    await resendInvitation.call({ id: first.id }, OWNER);
    const second = tokenFrom(logged);

    expect(second).not.toBe(first.token);
    await expect(
      inspectInvitation.call({ token: first.token }, ANONYMOUS),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      inspectInvitation.call({ token: second }, ANONYMOUS),
    ).resolves.toMatchObject({ status: "pending", email: EMAIL });
    const [row] = await db().select().from(staffInvitations);
    expect(row?.sendCount).toBe(2);
  });

  it("revokes a live link immediately and records the history", async () => {
    const created = await invite();
    await revokeInvitation.call({ id: created.id }, OWNER);

    await expect(
      inspectInvitation.call({ token: created.token }, ANONYMOUS),
    ).resolves.toMatchObject({ status: "revoked" });
    const error = await failure(
      acceptInvitation.call(
        { token: created.token, password: PASSWORD },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("permission");

    const listed = await listInvitations.call({}, OWNER);
    expect(listed[0]).toMatchObject({
      id: created.id,
      status: "revoked",
    });
    expect(listed[0]?.history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["invitations.create", "invitations.revoke"]),
    );
  });

  it("accepts once, creates the assigned login, and retires the link", async () => {
    const created = await invite("bookkeeper");
    const accepted = await acceptInvitation.call(
      { token: created.token, password: PASSWORD },
      ANONYMOUS,
    );
    expect(accepted).toMatchObject({ email: EMAIL, role: "bookkeeper" });

    await expect(
      login.call({ email: EMAIL, password: PASSWORD }, ANONYMOUS),
    ).resolves.toMatchObject({ role: "bookkeeper" });
    const [account] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(account?.passwordHash).toMatch(/^scrypt:/);
    expect(account?.passwordHash).not.toContain(PASSWORD);

    const reused = await failure(
      acceptInvitation.call(
        { token: created.token, password: "another-valid-staff-password" },
        ANONYMOUS,
      ),
    );
    expect(reused.code).toBe("permission");
    const [row] = await db().select().from(staffInvitations);
    expect(row).toMatchObject({
      status: "accepted",
      acceptedUserId: account!.id,
    });
    const audit = await db().select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain(created.token);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(audit.map((entry) => entry.action)).toContain("invitations.accept");
  });

  it("allows only one winner when the same link is accepted concurrently", async () => {
    const created = await invite();
    const attempts = await Promise.allSettled([
      acceptInvitation.call(
        { token: created.token, password: PASSWORD },
        ANONYMOUS,
      ),
      acceptInvitation.call(
        { token: created.token, password: "a-different-valid-password" },
        ANONYMOUS,
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(await db().select().from(users).where(eq(users.email, EMAIL))).toHaveLength(1);
  });

  it("makes token rotation and acceptance mutually exclusive", async () => {
    const created = await invite();
    logged = [];
    const attempts = await Promise.allSettled([
      resendInvitation.call({ id: created.id }, OWNER),
      acceptInvitation.call(
        { token: created.token, password: PASSWORD },
        ANONYMOUS,
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const [row] = await db().select().from(staffInvitations);
    if (row?.status === "pending") {
      expect(await db().select().from(users).where(eq(users.email, EMAIL))).toHaveLength(0);
      expect(tokenFrom(logged)).toBeTruthy();
    } else {
      expect(row?.status).toBe("accepted");
      expect(await db().select().from(users).where(eq(users.email, EMAIL))).toHaveLength(1);
    }
  });

  it("revalidates the selected role when the link is accepted", async () => {
    const created = await invite();
    await db()
      .delete(roleGrants)
      .where(
        sql`${roleGrants.roleKey} = 'editor' and ${roleGrants.module} = 'admin'`,
      );

    await expect(
      inspectInvitation.call({ token: created.token }, ANONYMOUS),
    ).resolves.toMatchObject({ status: "unavailable" });
    const error = await failure(
      acceptInvitation.call(
        { token: created.token, password: PASSWORD },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("permission");
    expect(await db().select().from(users).where(eq(users.email, EMAIL))).toHaveLength(0);
  });

  it("releases an expired address for a fresh invitation and can resend expiry", async () => {
    const first = await invite();
    await db()
      .update(staffInvitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(staffInvitations.id, first.id));
    await expect(
      inspectInvitation.call({ token: first.token }, ANONYMOUS),
    ).resolves.toMatchObject({ status: "expired" });

    logged = [];
    const second = await createInvitation.call(
      { email: EMAIL, roleKey: "editor", expiresInDays: 3 },
      OWNER,
    );
    expect(second.id).not.toBe(first.id);
    const rows = await db().select().from(staffInvitations);
    expect(rows.find((row) => row.id === first.id)?.status).toBe("expired");

    await db()
      .update(staffInvitations)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(staffInvitations.id, second.id));
    logged = [];
    await resendInvitation.call({ id: first.id }, OWNER);
    expect(tokenFrom(logged)).toBeTruthy();
    expect(
      (await db().select().from(staffInvitations).where(eq(staffInvitations.id, first.id)))[0]
        ?.status,
    ).toBe("pending");
  });

  it("materializes elapsed expiry on the scheduled sweep", async () => {
    const created = await invite();
    await db()
      .update(staffInvitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(staffInvitations.id, created.id));

    await expect(expireStaffInvitations.handler({})).resolves.toEqual({ expired: 1 });
    const [row] = await db().select().from(staffInvitations);
    expect(row?.status).toBe("expired");
  });
});

describe("the invitation migration", () => {
  it("creates the lifecycle indexes and grants existing administrators access", () => {
    const migration = readFileSync(
      "db/migrations/0018_staff-invitations.sql",
      "utf8",
    );
    expect(migration).toContain("staff_invitations_pending_email_idx");
    expect(migration).toContain("('administrator', 'invitations', 'manage')");
    expect(migration).toContain("('staff', 'invitations', 'view')");
  });
});
