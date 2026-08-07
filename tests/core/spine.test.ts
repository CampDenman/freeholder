// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The database-backed half: everything MASTER.md §11 claims is impossible
// rather than unlikely. Gated on a test database — see vitest.config.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { publish, resetBusForTests, subscribe } from "@/core/events";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import {
  login,
  logout,
  registerOwner,
  whoami,
} from "@/core/auth/service";
import {
  createContact,
  mergeContacts,
  resolveContact,
  updateContact,
} from "@/core/contacts/service";
import { defineService, ServiceError, type Actor } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const OWNER_PASSWORD = "a-sufficiently-long-owner-password";

const auditRows = () => db().select().from(auditLog);
const contactRows = () => db().select().from(contacts);
const timelineRows = () => db().select().from(timelineEvents);

describe.runIf(hasDatabase)("the spine, against a real database", () => {
  beforeEach(async () => {
    await truncateSpine();
    resetBusForTests();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("first boot", () => {
    it("creates the owner and a usable session", async () => {
      const result = await registerOwner.call(
        { email: "Owner@Example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      expect(result.userId).toBeTruthy();
      expect(result.token).toBeTruthy();

      const [owner] = await db().select().from(users);
      expect(owner!.email).toBe("owner@example.test"); // lowercased on the way in
      expect(owner!.role).toBe("owner");
      expect(owner!.passwordHash).not.toContain(OWNER_PASSWORD);
    });

    it("closes the door behind it", async () => {
      await registerOwner.call(
        { email: "first@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      const error = await failure(registerOwner
        .call(
          { email: "second@example.test", password: OWNER_PASSWORD },
          ANONYMOUS,
        ));
      expect(error.code).toBe("conflict");
      expect(error.message).toMatch(/already has an owner/);
    });

    it("survives a concurrent first boot — exactly one owner", async () => {
      // The check-then-insert in the service cannot see an uncommitted peer,
      // so this is the partial unique index doing the work.
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          registerOwner.call(
            { email: `race${i}@example.test`, password: OWNER_PASSWORD },
            ANONYMOUS,
          ),
        ),
      );
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const [owners] = await db()
        .select({ n: count() })
        .from(users)
        .where(eq(users.role, "owner"));
      expect(owners!.n).toBe(1);
    });

    it("rejects a weak owner password before writing anything", async () => {
      const error = await failure(registerOwner
        .call({ email: "owner@example.test", password: "short" }, ANONYMOUS));
      expect(error.code).toBe("validation");
      expect(await db().select().from(users)).toHaveLength(0);
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      await registerOwner.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
    });

    it("issues a session for the right password", async () => {
      const result = await login.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      expect(result.role).toBe("owner");
      const resolved = await whoami.call({ token: result.token }, ANONYMOUS);
      expect(resolved?.email).toBe("owner@example.test");
      expect(resolved?.role).toBe("owner");
    });

    it("answers identically for a wrong password and an unknown address", async () => {
      const wrongPassword = await failure(login
        .call({ email: "owner@example.test", password: "not-it-at-all" }, ANONYMOUS));
      const unknownEmail = await failure(login
        .call({ email: "nobody@example.test", password: OWNER_PASSWORD }, ANONYMOUS));
      expect(wrongPassword.message).toBe(unknownEmail.message);
      expect(wrongPassword.code).toBe(unknownEmail.code);
      // A malformed address must not be distinguishable either.
      const malformed = await failure(login
        .call({ email: "not-an-email", password: OWNER_PASSWORD }, ANONYMOUS));
      expect(malformed.message).toBe(wrongPassword.message);
    });

    it("never records the password in the audit trail", async () => {
      await login.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      const rows = await auditRows();
      expect(JSON.stringify(rows)).not.toContain(OWNER_PASSWORD);
      expect(JSON.stringify(rows)).toContain("[redacted]");
    });

    it("stamps last_login_at", async () => {
      const before = await db().select().from(users);
      expect(before[0]!.lastLoginAt).toBeNull();
      await login.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      const after = await db().select().from(users);
      expect(after[0]!.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe("logout", () => {
    it("revokes the session whose token was presented", async () => {
      const { token } = await registerOwner.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      await expect(
        whoami.call({ token }, ANONYMOUS),
      ).resolves.toBeDefined();
      await logout.call({ token }, OWNER);
      await expect(whoami.call({ token }, ANONYMOUS)).resolves.toBeUndefined();
    });

    it("cannot revoke a session it does not hold the token for", async () => {
      const owner = await registerOwner.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      // A logged-in customer guessing at other sessions has nothing to name:
      // the only handle is the token itself.
      await logout.call({ token: "some-other-token" }, CUSTOMER);
      await expect(
        whoami.call({ token: owner.token }, ANONYMOUS),
      ).resolves.toBeDefined();
    });

    it("treats an already-gone session as a successful logout", async () => {
      await expect(
        logout.call({ token: "never-existed" }, CUSTOMER),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe("contacts — the identity rule", () => {
    it("writes a timeline event and an audit row in one go", async () => {
      const contact = await createContact.call(
        { name: "Ada Lovelace", email: "ada@example.test" },
        STAFF,
      );
      const timeline = await timelineRows();
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.eventType).toBe("contact.created");
      expect(timeline[0]!.contactId).toBe(contact.id);
      expect(timeline[0]!.actor).toBe(`user:${STAFF.userId}`);

      const audit = await auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("contacts.create");
      expect(audit[0]!.subjectType).toBe("contact");
      expect(audit[0]!.subjectId).toBe(contact.id);
    });

    it("refuses a second contact for the same address", async () => {
      await createContact.call(
        { name: "Ada", email: "ada@example.test" },
        STAFF,
      );
      const error = await failure(createContact
        .call({ name: "Ada Again", email: "Ada@Example.test" }, STAFF));
      expect(error.code).toBe("conflict");
      expect(error.message).toContain("ada@example.test");
      // This string lands on a business owner's screen, so it must not name
      // internal services — "use contacts.resolve" is a sentence only its
      // author can act on.
      expect(error.message).not.toMatch(/contacts\./);
      expect(await contactRows()).toHaveLength(1);
    });

    it("still allows many contacts without an address", async () => {
      await createContact.call({ name: "Walk-in one" }, STAFF);
      await createContact.call({ name: "Walk-in two" }, STAFF);
      expect(await contactRows()).toHaveLength(2);
    });

    it("resolve creates once, then finds", async () => {
      const first = await resolveContact.call(
        { email: "lead@example.test", name: "A Lead", source: "contact-form" },
        STAFF,
      );
      expect(first.created).toBe(true);

      const second = await resolveContact.call(
        { email: "Lead@Example.test", name: "Ignored" },
        STAFF,
      );
      expect(second.created).toBe(false);
      expect(second.contact.id).toBe(first.contact.id);
      expect(second.contact.name).toBe("A Lead");
      expect(await contactRows()).toHaveLength(1);
      // Only the creation is newsworthy.
      expect(await timelineRows()).toHaveLength(1);
    });

    it("resolve is safe under concurrency", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          resolveContact.call({ email: "busy@example.test" }, STAFF),
        ),
      );
      expect(await contactRows()).toHaveLength(1);
      expect(new Set(results.map((r) => r.contact.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    });

    it("falls back to the address when no name is given", async () => {
      const { contact } = await resolveContact.call(
        { email: "noname@example.test" },
        STAFF,
      );
      expect(contact.name).toBe("noname@example.test");
      expect(contact.lifecycleStage).toBe("lead");
    });

    // §4.6 names the destination contact_create *or update*: a returning
    // visitor who finally gives their phone number must not have it discarded.
    it("fills blanks on a contact it already knows", async () => {
      const first = await resolveContact.call(
        { email: "returning@example.test", name: "Ada", source: "newsletter" },
        STAFF,
      );

      const second = await resolveContact.call(
        {
          email: "returning@example.test",
          phone: "+1 250 555 0100",
          preferredLocale: "fr-CA",
          tags: ["quote-request"],
        },
        STAFF,
      );

      expect(second.created).toBe(false);
      expect(second.updated).toBe(true);
      expect(second.contact.id).toBe(first.contact.id);
      expect(second.contact.phone).toBe("+1 250 555 0100");
      expect(second.contact.preferredLocale).toBe("fr-CA");
      expect(second.contact.tags).toEqual(["quote-request"]);
      // Creation, then the enrichment — both are newsworthy on the timeline.
      expect(await timelineRows()).toHaveLength(2);
    });

    it("never overwrites what the owner already recorded", async () => {
      await resolveContact.call(
        {
          email: "known@example.test",
          name: "Grace Hopper",
          phone: "+1 250 555 0111",
          source: "contact-form",
        },
        STAFF,
      );

      const second = await resolveContact.call(
        {
          email: "known@example.test",
          name: "typo mcgee",
          phone: "+1 000 000 0000",
          // First touch is what the funnel attributes to; a second form
          // submission must not relabel where this contact came from.
          source: "footer-signup",
        },
        STAFF,
      );

      expect(second.updated).toBe(false);
      expect(second.contact.name).toBe("Grace Hopper");
      expect(second.contact.phone).toBe("+1 250 555 0111");
      expect(second.contact.source).toBe("contact-form");
      // Nothing changed, so nothing is written — updated_at is a change
      // cursor, and a form view is not a change.
      expect(await timelineRows()).toHaveLength(1);
    });

    it("upgrades the placeholder name exactly once", async () => {
      const first = await resolveContact.call(
        { email: "anon@example.test" },
        STAFF,
      );
      expect(first.contact.name).toBe("anon@example.test");

      const named = await resolveContact.call(
        { email: "anon@example.test", name: "Sam Okonjo" },
        STAFF,
      );
      expect(named.contact.name).toBe("Sam Okonjo");

      const later = await resolveContact.call(
        { email: "anon@example.test", name: "Someone Else" },
        STAFF,
      );
      expect(later.updated).toBe(false);
      expect(later.contact.name).toBe("Sam Okonjo");
    });

    it("moves lifecycle forward but never backward", async () => {
      await resolveContact.call(
        { email: "buyer@example.test", lifecycleStage: "customer" },
        STAFF,
      );

      const demote = await resolveContact.call(
        { email: "buyer@example.test", lifecycleStage: "lead" },
        STAFF,
      );
      expect(demote.contact.lifecycleStage).toBe("customer");

      const promote = await resolveContact.call(
        { email: "buyer@example.test", lifecycleStage: "repeat" },
        STAFF,
      );
      expect(promote.contact.lifecycleStage).toBe("repeat");
    });

    it("leaves updated_at alone when nothing changed", async () => {
      const { contact } = await resolveContact.call(
        { email: "quiet@example.test", name: "Quiet" },
        STAFF,
      );

      await resolveContact.call({ email: "quiet@example.test" }, STAFF);

      const [after] = await db()
        .select()
        .from(contacts)
        .where(eq(contacts.id, contact.id));
      expect(after!.updatedAt).toEqual(contact.updatedAt);
    });

    // The column maintains itself now ($onUpdate), so no service sets it and
    // none can forget to. This proves the mechanism rather than the caller.
    it("stamps updated_at without any service setting it", async () => {
      const created = await createContact.call(
        { name: "Stamp Test", email: "stamp@example.test" },
        STAFF,
      );
      const changed = await updateContact.call(
        { id: created.id, phone: "+1 250 555 0122" },
        STAFF,
      );
      expect(changed.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime(),
      );
      expect(changed.createdAt).toEqual(created.createdAt);
    });
  });

  describe("contacts.merge", () => {
    it("moves history, unions tags, and advances lifecycle", async () => {
      const survivor = await createContact.call(
        {
          name: "Grace Hopper",
          email: "grace@example.test",
          tags: ["vip"],
          lifecycleStage: "lead",
          customFields: { referredBy: "conference" },
        },
        STAFF,
      );
      const duplicate = await createContact.call(
        {
          name: "G. Hopper",
          phone: "+1-555-0100",
          tags: ["newsletter"],
          lifecycleStage: "customer",
          ownerNotes: "Met at the meetup",
        },
        STAFF,
      );

      const merged = await mergeContacts.call(
        { survivingId: survivor.id, duplicateId: duplicate.id },
        OWNER,
      );

      expect(await contactRows()).toHaveLength(1);
      expect(merged.id).toBe(survivor.id);
      expect(merged.email).toBe("grace@example.test");
      expect(merged.phone).toBe("+1-555-0100"); // inherited what it lacked
      expect(merged.ownerNotes).toBe("Met at the meetup");
      expect([...merged.tags].sort()).toEqual(["newsletter", "vip"]);
      expect(merged.lifecycleStage).toBe("customer"); // only moves forward
      expect(merged.customFields).toEqual({ referredBy: "conference" });

      // No history is orphaned: both creation events now hang off the survivor.
      const timeline = await timelineRows();
      expect(timeline).toHaveLength(3); // 2 creates + 1 merge
      expect(timeline.every((e) => e.contactId === survivor.id)).toBe(true);
      expect(timeline.some((e) => e.eventType === "contact.merged")).toBe(true);
    });

    it("lets the survivor inherit a unique email from the duplicate", async () => {
      const survivor = await createContact.call({ name: "No Email" }, STAFF);
      const duplicate = await createContact.call(
        { name: "Has Email", email: "has@example.test" },
        STAFF,
      );
      const merged = await mergeContacts.call(
        { survivingId: survivor.id, duplicateId: duplicate.id },
        OWNER,
      );
      expect(merged.email).toBe("has@example.test");
    });

    it("refuses when both contacts can sign in", async () => {
      // contacts.user_id is unique and 1:1, so a merge can keep only one
      // login. Choosing silently either orphans a credential that still signs
      // in and resolves to nobody, or destroys a real person's password.
      const [one, two] = await db()
        .insert(users)
        .values([
          { email: "one@example.test", role: "staff" },
          { email: "two@example.test", role: "staff" },
        ])
        .returning();
      const survivor = await createContact.call({ name: "One" }, STAFF);
      const duplicate = await createContact.call({ name: "Two" }, STAFF);
      await db()
        .update(contacts)
        .set({ userId: one!.id })
        .where(eq(contacts.id, survivor.id));
      await db()
        .update(contacts)
        .set({ userId: two!.id })
        .where(eq(contacts.id, duplicate.id));

      const error = await failure(
        mergeContacts.call(
          { survivingId: survivor.id, duplicateId: duplicate.id },
          OWNER,
        ),
      );
      expect(error.code).toBe("conflict");
      expect(error.message).toContain("login");

      // Nothing moved: both contacts and both logins survive the refusal.
      expect(await contactRows()).toHaveLength(2);
      expect(await db().select().from(users)).toHaveLength(2);
    });

    it("lets the survivor inherit the duplicate's login", async () => {
      const [account] = await db()
        .insert(users)
        .values({ email: "solo@example.test", role: "customer" })
        .returning();
      const survivor = await createContact.call({ name: "No Login" }, STAFF);
      const duplicate = await createContact.call({ name: "Login" }, STAFF);
      await db()
        .update(contacts)
        .set({ userId: account!.id })
        .where(eq(contacts.id, duplicate.id));

      const merged = await mergeContacts.call(
        { survivingId: survivor.id, duplicateId: duplicate.id },
        OWNER,
      );
      expect(merged.userId).toBe(account!.id);
    });

    it("refuses to merge a contact into itself", async () => {
      const contact = await createContact.call({ name: "Solo" }, STAFF);
      const error = await failure(mergeContacts
        .call({ survivingId: contact.id, duplicateId: contact.id }, OWNER));
      expect(error.code).toBe("validation");
      expect(await contactRows()).toHaveLength(1);
    });

    it("is owner-only", async () => {
      const a = await createContact.call({ name: "A" }, STAFF);
      const b = await createContact.call({ name: "B" }, STAFF);
      const error = await failure(mergeContacts
        .call({ survivingId: a.id, duplicateId: b.id }, STAFF));
      expect(error.code).toBe("permission");
      expect(await contactRows()).toHaveLength(2);
    });
  });

  describe("composition shares one transaction", () => {
    const twoContacts = defineService({
      name: "test.twoContacts",
      summary: "Creates two contacts through the service layer.",
      kind: "mutation",
      permission: "staff",
      input: z.object({ fail: z.boolean().default(false) }),
      handler: async (input, ctx) => {
        await ctx.call(createContact, {
          name: "Inner A",
          email: "inner-a@example.test",
        });
        await ctx.callAsSystem(createContact, {
          name: "Inner B",
          email: "inner-b@example.test",
        });
        ctx.queueEvent("test.composed", { ok: true });
        if (input.fail) {
          throw new ServiceError("conflict", "deliberate failure");
        }
        return { ok: true };
      },
    });

    it("commits every nested write together", async () => {
      await twoContacts.call({}, STAFF);
      expect(await contactRows()).toHaveLength(2);
      // One audit row per service call, outer included.
      const audit = await auditRows();
      expect(audit.map((a) => a.action).sort()).toEqual([
        "contacts.create",
        "contacts.create",
        "test.twoContacts",
      ]);
      // Elevation is visible in the trail rather than hidden.
      expect(audit.filter((a) => a.actor === "system")).toHaveLength(1);
      expect(
        audit.filter((a) => a.actor === `user:${STAFF.userId}`),
      ).toHaveLength(2);
    });

    it("rolls every nested write back together", async () => {
      // This is the whole point of fixing composition: before ctx.call, the
      // inner services opened their own transactions and these rows survived.
      await expect(twoContacts.call({ fail: true }, STAFF)).rejects.toThrow(
        /deliberate failure/,
      );
      expect(await contactRows()).toHaveLength(0);
      expect(await timelineRows()).toHaveLength(0);
      expect(await auditRows()).toHaveLength(0);
    });

    it("publishes queued events once, only after the outer commit", async () => {
      const seen: string[] = [];
      subscribe("contact.created", () => void seen.push("contact.created"));
      subscribe("test.composed", () => void seen.push("test.composed"));

      await twoContacts.call({}, STAFF);
      expect(seen.filter((e) => e === "contact.created")).toHaveLength(2);
      expect(seen.filter((e) => e === "test.composed")).toHaveLength(1);
    });

    it("publishes nothing when the outer call rolls back", async () => {
      const seen: string[] = [];
      subscribe("contact.created", () => void seen.push("contact.created"));
      subscribe("test.composed", () => void seen.push("test.composed"));

      await expect(twoContacts.call({ fail: true }, STAFF)).rejects.toThrow();
      expect(seen).toEqual([]);
    });

    it("does not let composition escape the caller's permissions", async () => {
      // ctx.call inherits the actor, so a customer driving this gets nowhere.
      const error = await failure(twoContacts
        .call({}, CUSTOMER));
      expect(error.code).toBe("permission");
      expect(await contactRows()).toHaveLength(0);
    });
  });

  describe("the audit trail", () => {
    it("records nothing for a query", async () => {
      await createContact.call({ name: "Queried" }, STAFF);
      const before = (await auditRows()).length;
      await whoami.call({ token: "irrelevant" }, ANONYMOUS);
      expect(await auditRows()).toHaveLength(before);
    });

    it("records nothing when permission is refused", async () => {
      await createContact
        .call({ name: "Nope" }, CUSTOMER)
        .catch(() => undefined);
      expect(await auditRows()).toHaveLength(0);
      expect(await contactRows()).toHaveLength(0);
    });

    it("attributes an agent by key name", async () => {
      const claude: Actor = {
        kind: "agent",
        keyName: "claude",
        scopes: ["contacts.*"],
      };
      await createContact.call({ name: "Agent-made" }, claude);
      const audit = await auditRows();
      expect(audit[0]!.actor).toBe("agent:claude");
      const timeline = await timelineRows();
      expect(timeline[0]!.actor).toBe("agent:claude");
    });
  });

  describe("the event bus", () => {
    it("isolates a failing listener from the publisher", async () => {
      const reached: string[] = [];
      subscribe("boom", () => {
        throw new Error("listener exploded");
      });
      subscribe("boom", () => void reached.push("second"));
      await expect(publish("boom", {})).resolves.toBeUndefined();
      expect(reached).toEqual(["second"]);
    });
  });
});
