// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: members join with a handle under the site's rules, keep their own
// profile, and the site admin approves, suspends and invites.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { ready } from "@/core/runtime";
import {
  handleAvailability,
  inviteMember,
  joinSite,
  listMembers,
  membershipRules,
  myMembership,
  setMemberStatus,
  updateMembershipRules,
  updateMyMembership,
} from "@/modules/members/service";
import { memberProfiles } from "@/modules/members/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const OTHER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const join = (handle: string, extra: Partial<{ isAdult: boolean; displayName: string }> = {}) => ({
  handle,
  displayName: extra.displayName ?? "Rae Lane",
  meetsMinimumAge: true as const,
  isAdult: extra.isAdult ?? true,
});

describe.runIf(hasDatabase)("members (C12.01)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: CUSTOMER.userId, email: "rae@example.test", role: "customer" },
      { id: OTHER.userId, email: "sam@example.test", role: "customer" },
    ]);
  });
  afterAll(closeDb);

  it("lets a signed-in person join an open site and links them to the spine", async () => {
    expect(await membershipRules.call({}, ANONYMOUS)).toMatchObject({ joinPolicy: "open", minimumAge: 16, marketplaceEnabled: false });
    expect((await handleAvailability.call({ handle: "Rae_Lane" }, ANONYMOUS)).available).toBe(true);
    const joined = await joinSite.call(join("Rae_Lane"), CUSTOMER);
    expect(joined).toMatchObject({ handle: "rae_lane", displayName: "Rae Lane", status: "active", isAdult: true });
    const [contact] = await db().select().from(contacts).where(eq(contacts.email, "rae@example.test"));
    expect(contact?.userId).toBe(CUSTOMER.userId);
    expect(await myMembership.call({}, CUSTOMER)).toMatchObject({ handle: "rae_lane" });
    expect(await myMembership.call({}, OTHER)).toBeNull();
    expect((await failure(joinSite.call(join("another"), CUSTOMER))).code).toBe("conflict");
  });

  it("refuses anonymous joins, taken or reserved handles, and a missing age confirmation", async () => {
    expect((await failure(joinSite.call(join("visitor"), ANONYMOUS))).code).toBe("permission");
    await joinSite.call(join("rae"), CUSTOMER);
    expect(await handleAvailability.call({ handle: "rae" }, ANONYMOUS)).toEqual({ available: false, reason: "That handle is taken." });
    expect((await failure(joinSite.call(join("rae"), OTHER))).code).toBe("conflict");
    expect((await failure(joinSite.call(join("admin"), OTHER))).code).toBe("conflict");
    expect((await failure(joinSite.call(join("no spaces"), OTHER))).code).toBe("validation");
    expect((await failure(joinSite.call({ ...join("sam"), meetsMinimumAge: false }, OTHER))).code).toBe("validation");
  });

  it("holds new members for approval when the site asks, and keeps a suspension reason", async () => {
    await updateMembershipRules.call({ joinPolicy: "approval", minimumAge: 18 }, OWNER);
    expect((await failure(updateMembershipRules.call({ joinPolicy: "open", minimumAge: 16 }, CUSTOMER))).code).toBe("permission");
    const pending = await joinSite.call(join("rae"), CUSTOMER);
    expect(pending.status).toBe("pending");
    expect((await listMembers.call({ status: "pending" }, OWNER)).total).toBe(1);
    expect((await failure(listMembers.call({}, CUSTOMER))).code).toBe("permission");
    expect((await setMemberStatus.call({ userId: CUSTOMER.userId, status: "active" }, OWNER)).status).toBe("active");
    expect((await failure(setMemberStatus.call({ userId: CUSTOMER.userId, status: "suspended" }, OWNER))).code).toBe("validation");
    const suspended = await setMemberStatus.call({ userId: CUSTOMER.userId, status: "suspended", reason: "Spam" }, OWNER);
    expect(suspended.status).toBe("suspended");
    expect((await listMembers.call({ search: "rae@" }, OWNER)).members[0]).toMatchObject({ statusReason: "Spam" });
  });

  it("admits only invited email addresses on an invite-only site, once", async () => {
    await updateMembershipRules.call({ joinPolicy: "invite", minimumAge: 16 }, OWNER);
    expect((await failure(joinSite.call(join("rae"), CUSTOMER))).code).toBe("permission");
    await inviteMember.call({ email: "Rae@Example.test" }, OWNER);
    expect((await joinSite.call(join("rae"), CUSTOMER)).status).toBe("active");
    expect((await failure(joinSite.call(join("sam"), OTHER))).code).toBe("permission");
  });

  it("lets members edit their own profile and limits handle changes", async () => {
    await joinSite.call(join("rae", { isAdult: false }), CUSTOMER);
    const edited = await updateMyMembership.call({ displayName: "Rae L.", bio: "Coastal photographer.", isAdult: true }, CUSTOMER);
    expect(edited).toMatchObject({ displayName: "Rae L.", bio: "Coastal photographer.", isAdult: true });
    expect((await updateMyMembership.call({ handle: "rae_lane" }, CUSTOMER)).handle).toBe("rae_lane");
    expect((await failure(updateMyMembership.call({ handle: "rae_again" }, CUSTOMER))).code).toBe("conflict");
    expect((await failure(updateMyMembership.call({ bio: "x" }, OTHER))).code).toBe("not_found");
    const [row] = await db().select().from(memberProfiles).where(eq(memberProfiles.userId, CUSTOMER.userId));
    expect(row?.handleChangedAt).toBeTruthy();
  });
});
