// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer portal shell (MASTER.md §4.1, C8.10).
//
// The rules:
//
//   1. A signed-in customer reads their own record and nobody else's.
//   2. They may correct what the business knows about them.
//   3. They may not become somebody else: email is the spine's identity, so
//      it is readable and not writable here.
//   4. Whether they have a password is a fact the portal needs; the hash is
//      never one of them.
//   5. A staff account is not a customer, and the portal says so rather than
//      rendering an empty shell.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { myProfile, updateMyProfile } from "@/core/portal/service";
import {
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("the portal shell", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  /** A customer user joined to their contact, the way a magic link leaves it. */
  async function signedInCustomer(email = "rae@example.test") {
    const contact = await createContact.call({ name: "Rae Lane", email }, OWNER);
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email,
      role: "customer",
    });
    await db()
      .update(contacts)
      .set({ userId: CUSTOMER.userId })
      .where(eq(contacts.id, contact.id));
    return contact;
  }

  it("reads the signed-in customer's own record", async () => {
    const contact = await signedInCustomer();
    const profile = await myProfile.call({}, CUSTOMER);
    expect(profile).toMatchObject({
      contactId: contact.id,
      name: "Rae Lane",
      email: "rae@example.test",
      hasPassword: false,
    });
    // Whether they have a password is a fact the portal needs. The hash is
    // never one of them.
    expect(JSON.stringify(profile)).not.toContain("passwordHash");
  });

  it("lets them correct their own details", async () => {
    await signedInCustomer();
    const saved = await updateMyProfile.call(
      { name: "Rae Lane-Turner", phone: "+1 250 555 0134" },
      CUSTOMER,
    );
    expect(saved).toMatchObject({
      name: "Rae Lane-Turner",
      phone: "+1 250 555 0134",
    });
  });

  it("will not let them change the email the spine identifies them by", async () => {
    const contact = await signedInCustomer();
    // Not a validation message — the field simply is not in the contract.
    // Changing it would silently fork or merge two people's histories, which
    // is a merge the owner performs, not a text box.
    await updateMyProfile.call(
      { name: "Rae", email: "someone.else@example.test" } as never,
      CUSTOMER,
    );
    const [after] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
    expect(after!.email).toBe("rae@example.test");
  });

  it("tells a staff account there is nothing here for it", async () => {
    // OWNER has no contact row. An empty portal would look broken; saying so
    // is the honest answer.
    expect((await failure(myProfile.call({}, OWNER))).message).toContain(
      "no customer record",
    );
  });

  it("refuses an anonymous caller", async () => {
    expect(
      (await failure(myProfile.call({}, { kind: "anonymous" }))).code,
    ).toBe("permission");
  });
});
