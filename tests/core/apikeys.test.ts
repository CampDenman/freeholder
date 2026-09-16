// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// API keys (MASTER.md §11, §26, §28).
//
// A key is a standing grant against the whole service registry, held by
// something that is not a person and cannot be asked what it meant to do. So
// the tests are about the three properties that keep that from being a
// liability: the secret is useless at rest, a scoped key stays scoped, and a
// key cannot become a bigger key.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { apiKeys } from "@/core/apikeys/schema";
import { users } from "@/core/auth/schema";
import {
  createApiKey,
  listApiKeys,
  listScopes,
  revokeApiKey,
} from "@/core/apikeys/service";
import { hashApiKey, KEY_PREFIX, mintApiKey, verifyApiKey } from "@/core/apikeys/tokens";
import { auditLog } from "@/core/events/schema";
import { listContacts } from "@/core/contacts/service";
import { getBusiness } from "@/core/settings/service";
import { permits, type Actor } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const agent = (scopes: string[]): Actor => ({
  kind: "agent",
  keyName: "test-key",
  scopes,
});

/**
 * Give the shared OWNER actor a real row.
 *
 * `api_keys.created_by` is a genuine foreign key — a key records who issued
 * it — and the spine's actors are synthetic ids that no table has ever had to
 * resolve before. Making the actor real is truer than dropping the constraint:
 * in production the minting owner always exists.
 */
async function realiseOwner(): Promise<void> {
  await db()
    .insert(users)
    .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
    .onConflictDoNothing();
}

describe("what a scope grants", () => {
  // permits() predates this table by several phases; these pin the behaviour
  // the key model is built on rather than re-testing the registry.
  it("admits the service it names", () => {
    expect(permits(agent(["contacts.create"]), "scoped", "contacts.create")).toBe(true);
    expect(permits(agent(["contacts.create"]), "scoped", "contacts.list")).toBe(false);
  });

  it("admits a whole area with a family scope", () => {
    expect(permits(agent(["contacts.*"]), "scoped", "contacts.merge")).toBe(true);
    expect(permits(agent(["contacts.*"]), "scoped", "media.delete")).toBe(false);
  });

  it("gives an unscoped key exactly what a visitor has", () => {
    // Not nothing, and not more: "public" is the same reach anonymous already
    // has, so granting it to a key grants nothing extra.
    expect(permits(agent([]), "public", "settings.getBusiness")).toBe(true);
    expect(permits(agent([]), "scoped", "contacts.list")).toBe(false);
  });
});

describe("the token itself", () => {
  it("carries a prefix a secret scanner can match", () => {
    // A leaked key should be recognisable as a Freeholder key by a scanner
    // that has never heard of this instance.
    const minted = mintApiKey();
    expect(minted.token.startsWith(KEY_PREFIX)).toBe(true);
    expect(minted.prefix.startsWith(KEY_PREFIX)).toBe(true);
  });

  it("shows enough to recognise and not enough to use", () => {
    const minted = mintApiKey();
    expect(minted.prefix.length).toBeLessThan(minted.token.length / 2);
    expect(minted.token.startsWith(minted.prefix)).toBe(true);
  });

  it("stores a hash, never the token", () => {
    const minted = mintApiKey();
    expect(minted.tokenHash).not.toBe(minted.token);
    expect(minted.tokenHash).toBe(hashApiKey(minted.token));
  });

  it("mints a different key every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintApiKey().token));
    expect(seen.size).toBe(50);
  });
});

describe.runIf(hasDatabase)("minting a key", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseOwner();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns the token once and stores only its hash", async () => {
    const key = await createApiKey.call(
      { name: "Zapier", scopes: ["contacts.*"] },
      OWNER,
    );
    expect(key.token.startsWith(KEY_PREFIX)).toBe(true);

    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.tokenHash).not.toBe(key.token);
    expect(JSON.stringify(row)).not.toContain(key.token);

    // And it cannot be read back by any later call.
    const listed = await listApiKeys.call({}, OWNER);
    expect(JSON.stringify(listed)).not.toContain(key.token);
  });

  it("never writes the token to the audit trail", async () => {
    const key = await createApiKey.call({ name: "Zapier", scopes: [] }, OWNER);
    const rows = await db().select().from(auditLog);
    expect(JSON.stringify(rows)).not.toContain(key.token);
  });

  it("refuses a scope that names nothing", async () => {
    // A misspelt scope grants nothing and grants it silently, which reads as
    // "the API is broken" rather than "the scope is wrong".
    const error = await failure(
      createApiKey.call({ name: "Typo", scopes: ["contacts.craete"] }, OWNER),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("contacts.craete");
  });

  it("accepts a family scope for a module that exists", async () => {
    await expect(
      createApiKey.call({ name: "Wide", scopes: ["contacts.*"] }, OWNER),
    ).resolves.toHaveProperty("token");
  });

  it("refuses an internal service name as a grantable capability", async () => {
    const error = await failure(
      createApiKey.call(
        { name: "Scheduler", scopes: ["briefing.assemble"] },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("briefing.assemble");
  });

  it("refuses a second live key with the same name", async () => {
    await createApiKey.call({ name: "Zapier", scopes: [] }, OWNER);
    const error = await failure(
      createApiKey.call({ name: "Zapier", scopes: [] }, OWNER),
    );
    expect(error.code).toBe("conflict");
  });

  it("lets a revoked name be reused", async () => {
    // Otherwise rotating a key means renaming the integration.
    const first = await createApiKey.call({ name: "Zapier", scopes: [] }, OWNER);
    await revokeApiKey.call({ id: first.id }, OWNER);
    await expect(
      createApiKey.call({ name: "Zapier", scopes: [] }, OWNER),
    ).resolves.toHaveProperty("token");
  });

  it("requires the stored API-key manage grant, regardless of role name", async () => {
    const restricted: Actor = {
      kind: "user",
      userId: OWNER.userId,
      role: "owner",
      grants: [{ module: "contacts", access: "manage" }],
    };
    expect(
      (await failure(createApiKey.call({ name: "x", scopes: [] }, restricted)))
        .code,
    ).toBe("permission");
    expect(
      (await failure(createApiKey.call({ name: "x", scopes: [] }, ANONYMOUS))).code,
    ).toBe("permission");
  });
});

describe.runIf(hasDatabase)("a key cannot become a bigger key", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseOwner();
  });

  it("refuses to mint, however it is scoped", async () => {
    // The escalation this closes: §11's scope model ignores role rank, so a
    // key scoped apikeys.* would satisfy an `owner` permission. It could then
    // mint a second key with every scope, and the first key's limits were
    // decoration.
    const error = await failure(
      createApiKey.call({ name: "Escalation", scopes: [] }, agent(["apikeys.*"])),
    );
    expect(error.code).toBe("permission");
    expect(error.message).toContain("Sign in");
  });

  it("refuses to revoke, so one key cannot disable another", async () => {
    const victim = await createApiKey.call({ name: "Victim", scopes: [] }, OWNER);
    const error = await failure(
      revokeApiKey.call({ id: victim.id }, agent(["apikeys.revoke"])),
    );
    expect(error.code).toBe("permission");

    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, victim.id));
    expect(row?.revokedAt).toBeNull();
  });

  it("still lets a scoped key do its actual job", async () => {
    // The refusal above must not have made keys useless.
    await expect(listContacts.call({}, agent(["contacts.*"]))).resolves.toBeDefined();
  });
});

describe.runIf(hasDatabase)("presenting a key", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseOwner();
  });

  it("resolves a live key to its name and scopes", async () => {
    const key = await createApiKey.call(
      { name: "Till", scopes: ["contacts.create"] },
      OWNER,
    );
    await expect(verifyApiKey(key.token)).resolves.toMatchObject({
      name: "Till",
      scopes: ["contacts.create"],
    });
  });

  it("refuses a revoked key", async () => {
    const key = await createApiKey.call({ name: "Old", scopes: [] }, OWNER);
    await revokeApiKey.call({ id: key.id }, OWNER);
    await expect(verifyApiKey(key.token)).resolves.toBeUndefined();
  });

  it("refuses an expired key", async () => {
    const key = await createApiKey.call(
      { name: "Migration", scopes: [], expiresInDays: 1 },
      OWNER,
    );
    await expect(verifyApiKey(key.token)).resolves.toBeDefined();

    await db()
      .update(apiKeys)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(apiKeys.id, key.id));
    await expect(verifyApiKey(key.token)).resolves.toBeUndefined();
  });

  it("refuses an invented one, and anything that is not a key at all", async () => {
    await expect(verifyApiKey(`${KEY_PREFIX}not-a-real-token`)).resolves.toBeUndefined();
    await expect(verifyApiKey("bearer-something-else")).resolves.toBeUndefined();
    await expect(verifyApiKey(undefined)).resolves.toBeUndefined();
    await expect(verifyApiKey("")).resolves.toBeUndefined();
  });

  it("records that it was used", async () => {
    const key = await createApiKey.call({ name: "Seen", scopes: [] }, OWNER);
    const { touchApiKey } = await import("@/core/apikeys/tokens");
    touchApiKey(key.id);
    // Fire-and-forget by design, so give the write a moment before reading.
    await new Promise((resolve) => setTimeout(resolve, 120));

    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.lastUsedAt).not.toBeNull();
  });
});

describe.runIf(hasDatabase)("what an owner sees", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseOwner();
  });

  it("lists live keys by default and revoked ones on request", async () => {
    const gone = await createApiKey.call({ name: "Gone", scopes: [] }, OWNER);
    await createApiKey.call({ name: "Here", scopes: [] }, OWNER);
    await revokeApiKey.call({ id: gone.id }, OWNER);

    await expect(listApiKeys.call({}, OWNER)).resolves.toHaveLength(1);
    await expect(listApiKeys.call({ includeRevoked: true }, OWNER)).resolves.toHaveLength(2);
  });

  it("offers every scope the instance actually has", async () => {
    // Derived from the registry, so a module added tomorrow is grantable
    // tomorrow without this screen changing (§28).
    const areas = await listScopes.call({}, OWNER);
    const names = areas.map((area) => area.area);
    expect(names).toContain("contacts");
    expect(names).toContain("apikeys");

    const contacts = areas.find((area) => area.area === "contacts")!;
    expect(contacts.family).toBe("contacts.*");
    expect(contacts.services.some((s) => s.name === "contacts.create")).toBe(true);
    // The summary is what the admin screen shows beside each checkbox, and it
    // comes from the service rather than from a second list to maintain.
    expect(contacts.services.every((s) => s.summary.length > 0)).toBe(true);

    const briefing = areas.find((area) => area.area === "briefing")!;
    expect(briefing.services.some((s) => s.name === "briefing.today")).toBe(true);
    expect(briefing.services.some((s) => s.name === "briefing.assemble")).toBe(false);
  });

  it("says the same thing for a key that is already revoked as for one that never existed", async () => {
    const key = await createApiKey.call({ name: "Once", scopes: [] }, OWNER);
    await revokeApiKey.call({ id: key.id }, OWNER);
    const twice = await failure(revokeApiKey.call({ id: key.id }, OWNER));
    const never = await failure(
      revokeApiKey.call({ id: "00000000-0000-4000-8000-00000000dead" }, OWNER),
    );
    expect(twice.message).toBe(never.message);
  });

  it("keeps a revoked key's row, so the audit trail still resolves", async () => {
    const key = await createApiKey.call({ name: "Historic", scopes: [] }, OWNER);
    await revokeApiKey.call({ id: key.id }, OWNER);
    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.name).toBe("Historic");
  });
});

describe.runIf(hasDatabase)("what a key can reach", () => {
  beforeEach(async () => {
    await truncateSpine();
    await realiseOwner();
  });

  it("tells a key holder which scope is missing", async () => {
    // The reader of this message is a developer holding a credential, not a
    // business owner looking at a form. "Your account does not have
    // permission" sends them to the wrong place entirely.
    const error = await failure(listApiKeys.call({}, agent(["contacts.list"])));
    expect(error.message).toContain("apikeys.list");
    expect(error.message).toContain("apikeys.*");
  });

  it("reads what it is scoped for and refuses the rest", async () => {
    const actor = agent(["contacts.list"]);
    await expect(listContacts.call({}, actor)).resolves.toBeDefined();
    // Public services stay public — a key is never *less* than a visitor.
    await expect(getBusiness.call({}, actor)).resolves.toBeDefined();
    expect((await failure(listApiKeys.call({}, actor))).code).toBe("permission");
  });
});
