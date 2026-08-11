// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Changing your own password (MASTER.md §9, §13 step 1).
//
// This exists because of a real problem on a real instance: freeholder.ai's
// owner credential was generated into a session transcript and there was no
// way to rotate it from inside the product. The tests are about the two
// properties that make a change worth making — the old password stops working,
// and so does everybody else's session.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { sessions, users } from "@/core/auth/schema";
import { auditLog } from "@/core/events/schema";
import {
  changePassword,
  login,
  registerOwner,
  whoami,
} from "@/core/auth/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const OLD = "the-original-owner-password";
const NEW = "a-replacement-that-is-long-enough";

describe.runIf(hasDatabase)("changing your own password", () => {
  let ownerId = "";
  let token = "";

  beforeEach(async () => {
    await truncateSpine();
    const registered = await registerOwner.call(
      { email: "owner@example.test", password: OLD },
      ANONYMOUS,
    );
    ownerId = registered.userId;
    token = registered.token;
  });

  afterAll(async () => {
    await closeDb();
  });

  const asOwner = {
    kind: "user",
    userId: "",
    role: "owner",
    grants: [{ module: "*", access: "manage" }],
  } as const;
  const actor = () => ({ ...asOwner, userId: ownerId });

  it("replaces the password, and the old one stops working", async () => {
    const result = await changePassword.call(
      { currentPassword: OLD, newPassword: NEW, keepSessionToken: token },
      actor(),
    );
    expect(result.ok).toBe(true);

    await expect(
      login.call({ email: "owner@example.test", password: NEW }, ANONYMOUS),
    ).resolves.toMatchObject({ role: "owner" });

    const stale = await failure(
      login.call({ email: "owner@example.test", password: OLD }, ANONYMOUS),
    );
    expect(stale.code).toBe("permission");
  });

  it("signs every other device out, and leaves the one being used", async () => {
    // The whole point of changing a password is that somebody else might have
    // it. Leaving their session alive would make the act ceremonial.
    const elsewhere = await login.call(
      { email: "owner@example.test", password: OLD },
      ANONYMOUS,
    );
    expect(await db().select().from(sessions)).toHaveLength(2);

    const result = await changePassword.call(
      { currentPassword: OLD, newPassword: NEW, keepSessionToken: token },
      actor(),
    );
    expect(result.otherSessionsRevoked).toBe(1);

    // The other device is out…
    await expect(
      whoami.call({ token: elsewhere.token }, ANONYMOUS),
    ).resolves.toBeUndefined();
    // …and the screen the owner is looking at still works, because signing
    // somebody out of the page they just used is a bug, not security.
    await expect(whoami.call({ token }, ANONYMOUS)).resolves.toBeDefined();
  });

  it("refuses without the current password", async () => {
    // A session left open on a shared machine is the ordinary way an account
    // is taken over. Knowing the old password is the cheapest proof that the
    // person typing is the person the account belongs to.
    const error = await failure(
      changePassword.call(
        { currentPassword: "not-it-at-all", newPassword: NEW },
        actor(),
      ),
    );
    expect(error.code).toBe("permission");

    // And nothing changed.
    await expect(
      login.call({ email: "owner@example.test", password: OLD }, ANONYMOUS),
    ).resolves.toBeDefined();
  });

  it("refuses a password that is not really a change", async () => {
    const error = await failure(
      changePassword.call({ currentPassword: OLD, newPassword: OLD }, actor()),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses one too short to be worth having", async () => {
    const error = await failure(
      changePassword.call({ currentPassword: OLD, newPassword: "short" }, actor()),
    );
    expect(error.code).toBe("validation");
  });

  it("is not something a stranger can call", async () => {
    const error = await failure(
      changePassword.call(
        { currentPassword: OLD, newPassword: NEW },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("permission");
  });

  it("never writes either password to the audit trail", async () => {
    await changePassword.call(
      { currentPassword: OLD, newPassword: NEW, keepSessionToken: token },
      actor(),
    );
    const rows = await db().select().from(auditLog);
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(OLD);
    expect(dumped).not.toContain(NEW);
    expect(dumped).toContain("[redacted]");
    // The change itself *is* recorded — an owner reading their audit trail
    // should see that a password changed, just not what it became.
    expect(rows.some((row) => row.action === "auth.changePassword")).toBe(true);
  });

  it("stores a hash, not the password", async () => {
    await changePassword.call(
      { currentPassword: OLD, newPassword: NEW, keepSessionToken: token },
      actor(),
    );
    const [user] = await db().select().from(users);
    expect(user?.passwordHash).not.toContain(NEW);
    expect(user?.passwordHash).toMatch(/^scrypt:/);
  });
});
