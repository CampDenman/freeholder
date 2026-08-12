// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Passwordless customer entry and Contact -> User linking (MASTER.md C1.05).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import { GET as stageMagicLink } from "../../app/portal/magic/route";
import { resetMailForTests } from "@/adapters/mail";
import { users, sessions } from "@/core/auth/schema";
import {
  consumeCustomerMagicLink,
  requestCustomerMagicLink,
} from "@/core/auth/magic-links/service";
import { actorFromToken } from "@/core/http/actor";
import { contacts, customerMagicLinks, timelineEvents } from "@/core/contacts/schema";
import { mergeContacts } from "@/core/contacts/service";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import { businessProfile } from "@/core/settings/schema";
import { sweepCustomerMagicLinks } from "@/core/jobs/core-jobs";
import {
  ANONYMOUS,
  OWNER,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const EMAIL = "portal-customer@example.test";

function tokenFrom(logged: string[]): string {
  const match = /[?&]token=([^&\s]+)/.exec(logged.join("\n"));
  if (!match) throw new Error(`no customer magic link in:\n${logged.join("\n")}`);
  return decodeURIComponent(match[1]!);
}

describe("the customer magic-link browser handoff", () => {
  it("stages a credential without consuming it on GET", () => {
    const token = "scanner-safe-customer-magic-token";
    const response = stageMagicLink(
      new Request(`https://freeholder.example/portal/magic?token=${token}`),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://freeholder.example/portal/magic/confirm",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("freeholder_customer_magic=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/portal");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("preserves a non-default locale through the scanner-safe confirmation", () => {
    const response = stageMagicLink(new Request(
      "https://freeholder.example/fr/portal/magic?token=scanner-safe-customer-magic-token&locale=fr&default=en",
    ));
    expect(response.headers.get("location")).toBe(
      "https://freeholder.example/fr/portal/magic/confirm",
    );
    expect(response.headers.get("set-cookie")).toContain("Path=/fr/portal");
  });
});

describe.runIf(hasDatabase)("customer magic-link lifecycle", () => {
  let logged: string[] = [];

  async function createContact(email = EMAIL, name = "Portal Customer") {
    const [contact] = await db().insert(contacts).values({ email, name }).returning();
    return contact!;
  }

  async function requestToken(email = EMAIL): Promise<string> {
    logged = [];
    await requestCustomerMagicLink.call({ email }, ANONYMOUS);
    return tokenFrom(logged);
  }

  beforeEach(async () => {
    resetEnvForTests();
    resetMailForTests();
    await truncateSpine();
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    resetMailForTests();
    await closeDb();
  });

  it("does not disclose whether a contact exists and stores only a token hash", async () => {
    await createContact();
    const known = await requestCustomerMagicLink.call({ email: EMAIL }, ANONYMOUS);
    const token = tokenFrom(logged);
    const unknown = await requestCustomerMagicLink.call(
      { email: "nobody@example.test" },
      ANONYMOUS,
    );
    expect(unknown).toEqual(known);
    const rows = await db().select().from(customerMagicLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(await db().select().from(auditLog))).not.toContain(token);
  });

  it("renders the magic-link template and URL from Contact.preferred_locale", async () => {
    await db().insert(businessProfile).values({
      name: "Atelier Rivage",
      country: "CA",
      defaultLocale: "en",
      enabledLocales: ["en", "fr"],
      baseCurrency: "CAD",
      timezone: "America/Toronto",
    });
    await db().insert(contacts).values({
      email: EMAIL,
      name: "Cliente francophone",
      preferredLocale: "fr",
    });
    await requestCustomerMagicLink.call({ email: EMAIL }, ANONYMOUS);
    const output = logged.join("\n");
    expect(output).toContain("Votre lien de connexion à Atelier Rivage");
    expect(output).toContain("Le lien expire dans 15 minutes");
    expect(output).toContain("/fr/portal/magic?token=");
    expect(output).toContain("locale=fr");
  });

  it("makes a proven first-use portal selection the Contact preference", async () => {
    await db().insert(businessProfile).values({
      name: "Atelier Rivage",
      country: "CA",
      defaultLocale: "en",
      enabledLocales: ["en", "fr"],
      baseCurrency: "CAD",
      timezone: "America/Toronto",
    });
    await createContact();
    await requestCustomerMagicLink.call({ email: EMAIL, locale: "fr" }, ANONYMOUS);
    expect(logged.join("\n")).toContain("Votre lien de connexion à Atelier Rivage");
    const result = await consumeCustomerMagicLink.call(
      { token: tokenFrom(logged) },
      ANONYMOUS,
    );
    expect(result.locale).toBe("fr");
    expect((await db().select().from(contacts))[0]?.preferredLocale).toBe("fr");
  });

  it("proves the email, creates one passwordless customer User, and links the same Contact", async () => {
    const contact = await createContact();
    const token = await requestToken();
    const result = await consumeCustomerMagicLink.call(
      { token },
      {
        kind: "anonymous",
        request: {
          ip: "203.0.113.42",
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0",
        },
      },
    );

    expect(result).toMatchObject({ contactId: contact.id, linked: true });
    const [linked] = await db().select().from(contacts);
    const [user] = await db().select().from(users);
    expect(await db().select().from(contacts)).toHaveLength(1);
    expect(user).toMatchObject({ email: EMAIL, role: "customer", passwordHash: null });
    expect(linked?.userId).toBe(user?.id);
    expect((await actorFromToken(result.token)).kind).toBe("user");
    const [session] = await db().select().from(sessions);
    expect(session?.ip).toBe("203.0.113.xxx");
    expect(JSON.stringify(session)).not.toContain("203.0.113.42");
    const events = await db().select().from(timelineEvents);
    expect(events.some((event) => event.eventType === "contact.portalAccountLinked")).toBe(true);
  });

  it("allows exactly one concurrent redemption", async () => {
    await createContact();
    const token = await requestToken();
    const settled = await Promise.allSettled([
      consumeCustomerMagicLink.call({ token }, ANONYMOUS),
      consumeCustomerMagicLink.call({ token }, ANONYMOUS),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db().select().from(users)).toHaveLength(1);
    expect(await db().select().from(sessions)).toHaveLength(1);
  });

  it("invalidates proof when the Contact email changes", async () => {
    const contact = await createContact();
    const token = await requestToken();
    await db()
      .update(contacts)
      .set({ email: "changed@example.test" })
      .where(eq(contacts.id, contact.id));
    expect((await failure(consumeCustomerMagicLink.call({ token }, ANONYMOUS))).code)
      .toBe("permission");
    expect(await db().select().from(users)).toHaveLength(0);
    expect((await db().select().from(customerMagicLinks))[0]?.usedAt).toBeNull();
  });

  it("links an existing grant-free customer User but never a privileged account", async () => {
    await createContact();
    const [customer] = await db()
      .insert(users)
      .values({ email: EMAIL, role: "customer", passwordHash: null })
      .returning();
    const token = await requestToken();
    const linked = await consumeCustomerMagicLink.call({ token }, ANONYMOUS);
    expect(linked.userId).toBe(customer?.id);
    expect((await db().select().from(contacts))[0]?.userId).toBe(customer?.id);

    await truncateSpine();
    const privilegedContact = await createContact();
    const [editor] = await db()
      .insert(users)
      .values({ email: EMAIL, role: "editor", passwordHash: null })
      .returning();
    const privilegedToken = await requestToken();
    expect(
      (await failure(consumeCustomerMagicLink.call({ token: privilegedToken }, ANONYMOUS))).code,
    ).toBe("permission");
    expect((await db().select().from(contacts))[0]?.userId).toBeNull();
    expect(await db().select().from(sessions).where(eq(sessions.userId, editor!.id)))
      .toHaveLength(0);
    expect(privilegedContact.userId).toBeNull();
  });

  it("invalidates a duplicate Contact's bearer links during merge", async () => {
    const [survivor, duplicate] = await db()
      .insert(contacts)
      .values([
        { name: "Survivor" },
        { name: "Duplicate", email: EMAIL },
      ])
      .returning();
    const token = await requestToken();
    await mergeContacts.call(
      { survivingId: survivor!.id, duplicateId: duplicate!.id },
      OWNER,
    );
    expect(await db().select().from(customerMagicLinks)).toHaveLength(0);
    expect((await failure(consumeCustomerMagicLink.call({ token }, ANONYMOUS))).code)
      .toBe("permission");
  });

  it("sweeps used and expired credentials", async () => {
    await createContact();
    await requestToken();
    await requestToken();
    await db()
      .update(customerMagicLinks)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(isNull(customerMagicLinks.usedAt));
    await expect(sweepCustomerMagicLinks.handler({})).resolves.toEqual({ deleted: 2 });
    expect(await db().select().from(customerMagicLinks)).toHaveLength(0);
  });
});

describe("the customer magic-link migration", () => {
  it("is additive and indexes the bearer credential", () => {
    const migration = readFileSync("db/migrations/0021_customer-magic-links.sql", "utf8");
    expect(migration).toContain('CREATE TABLE "customer_magic_links"');
    expect(migration).toContain('CREATE UNIQUE INDEX "customer_magic_links_token_idx"');
    expect(migration).not.toMatch(/\bDROP\b/i);
  });
});
