// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Credential encryption and the connection model (MASTER.md §41, §17).
//
// The reason this exists before any provider does: a place to keep somebody
// else's access token should be built and tested before the thing that goes
// and fetches one. So the tests are mostly about the encryption's properties
// rather than about connecting anything — ciphertext that cannot be moved
// between rows, a key that can be rotated without downtime, and a token that
// never appears in a response body.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { connectedAccounts } from "@/core/connections/schema";
import {
  credentialKeyConfigured,
  CredentialKeyError,
  decryptSecret,
  encryptSecret,
  needsRotation,
} from "@/core/connections/crypto";
import {
  flagConnection,
  listConnections,
  readCredentials,
  recordConnection,
  removeConnection,
  rotateCredentials,
  setCapability,
  setConnectionOptions,
  writeCredentials,
} from "@/core/connections/service";
import { resetEnvForTests } from "@/core/env";
import type { Actor } from "@/core/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

/** vitest.config.ts supplies a deterministic CREDENTIAL_KEY for the run. */
const AGENT: Actor = { kind: "agent", keyName: "Zapier", scopes: ["connections.*"] };
const VIEWER: Actor = {
  kind: "user",
  userId: STAFF.userId,
  role: "calendar-viewer",
  grants: [{ module: "connections", access: "view" }],
};

const TOKENS = { access_token: "ya29.a0-secret", refresh_token: "1//refresh-secret" };

describe("encrypting a credential", () => {
  it("round-trips", () => {
    const envelope = encryptSecret("hello", "row-1");
    expect(decryptSecret(envelope, "row-1")).toBe("hello");
  });

  it("does not look like the plaintext", () => {
    const envelope = encryptSecret(JSON.stringify(TOKENS), "row-1");
    expect(envelope).not.toContain("ya29");
    expect(envelope).not.toContain("refresh-secret");
  });

  it("produces different ciphertext every time", () => {
    // A fresh nonce per encryption. Identical output for identical input would
    // tell an observer which accounts share a token.
    const seen = new Set(
      Array.from({ length: 20 }, () => encryptSecret("same", "row-1")),
    );
    expect(seen.size).toBe(20);
  });

  it("refuses a ciphertext moved to another row", () => {
    // The reason the account id is authenticated data: a token lifted from one
    // row and pasted into another must fail rather than quietly authenticate
    // as somebody else's account.
    const envelope = encryptSecret("hello", "row-1");
    expect(() => decryptSecret(envelope, "row-2")).toThrow(CredentialKeyError);
  });

  it("refuses a tampered ciphertext", () => {
    // GCM authenticates before it returns anything.
    const envelope = encryptSecret("hello", "row-1");
    const parts = envelope.split(".");
    const body = Buffer.from(parts[2]!, "base64url");
    body[0] = body[0]! ^ 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${body.toString("base64url")}`;
    expect(() => decryptSecret(tampered, "row-1")).toThrow(CredentialKeyError);
  });

  it("refuses something that is not an envelope", () => {
    expect(() => decryptSecret("not-an-envelope", "row-1")).toThrow(CredentialKeyError);
    expect(() => decryptSecret("v9.aaa.bbb", "row-1")).toThrow(CredentialKeyError);
    expect(() => decryptSecret("v1.short.x", "row-1")).toThrow(CredentialKeyError);
  });

  it("refuses to work with no key rather than storing anything in the clear", () => {
    // The failure mode this guards: an instance with no CREDENTIAL_KEY must
    // not quietly write a token as plaintext. Doctor reports the same thing
    // ahead of time; this is the floor underneath it.
    vi.stubEnv("CREDENTIAL_KEY", "");
    resetEnvForTests();
    expect(() => encryptSecret("hello", "row-1")).toThrow(CredentialKeyError);
    expect(credentialKeyConfigured()).toBe(false);
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("refuses a key that is the wrong length", () => {
    // A 16-byte key is not a weaker AES-256 key, it is not a key at all, and
    // the message says which two forms are accepted.
    vi.stubEnv("CREDENTIAL_KEY", "0011223344556677");
    resetEnvForTests();
    expect(() => encryptSecret("hello", "row-1")).toThrow(/32 bytes/);
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("accepts base64url as well as hex", () => {
    // Both are what a person gets from the tool they reach for.
    vi.stubEnv("CREDENTIAL_KEY", Buffer.alloc(32, 7).toString("base64url"));
    resetEnvForTests();
    expect(decryptSecret(encryptSecret("hello", "r"), "r")).toBe("hello");
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("carries a version, so the format can change later", () => {
    expect(encryptSecret("hello", "row-1").startsWith("v1.")).toBe(true);
  });

  it("knows what is already written with the current key", () => {
    // What rotation iterates on: an interrupted run resumes rather than
    // starting over, and running it twice is harmless.
    const envelope = encryptSecret("hello", "row-1");
    expect(needsRotation(envelope, "row-1")).toBe(false);
    expect(needsRotation(envelope, "row-2")).toBe(true);
    expect(needsRotation("v1.aaaa.bbbb", "row-1")).toBe(true);
  });
});

describe.runIf(hasDatabase)("keeping a connection", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await db()
      .insert(users)
      .values({ id: STAFF.userId, email: "staff@example.test", role: "staff" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  const record = (overrides: Record<string, unknown> = {}, actor: Actor = OWNER) =>
    recordConnection.call(
      {
        userId: OWNER.userId,
        provider: "google",
        providerAccountId: "google-123",
        email: "tony@example.test",
        credentials: TOKENS,
        capabilities: ["calendar_read"],
        ...overrides,
      },
      actor,
    );

  it("stores the token encrypted, never in the clear", async () => {
    const { id } = await record();
    const [row] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));

    expect(row?.credentials).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("ya29");
    expect(JSON.stringify(row)).not.toContain("refresh-secret");
  });

  it("reads it back through the one function that may", async () => {
    const { id } = await record();
    const credentials = await readCredentials(db(), id);
    expect(credentials).toEqual(TOKENS);
  });

  it("keeps the token out of every response body", async () => {
    // The surest way to keep a secret out of a log or a devtools panel is for
    // the query never to ask for it.
    const { id } = await record();
    const listed = await listConnections.call({ mine: false }, OWNER);
    expect(JSON.stringify(listed)).not.toContain("ya29");
    expect(listed.some((row) => row.id === id)).toBe(true);
  });

  it("keeps the token out of the audit trail", async () => {
    await record();
    const { auditLog } = await import("@/core/events/schema");
    const rows = await db().select().from(auditLog);
    expect(JSON.stringify(rows)).not.toContain("ya29");
    expect(JSON.stringify(rows)).not.toContain("refresh-secret");
  });

  it("refuses the same account twice", async () => {
    await record();
    const error = await failure(record());
    expect(error.code).toBe("conflict");
  });

  it("allows the same provider for a different account", async () => {
    // The normal case §41 is built around: a personal Gmail and a work one.
    await record();
    await expect(
      record({ providerAccountId: "google-456", email: "shop@example.test" }),
    ).resolves.toHaveProperty("id");
  });

  it("starts personal, unshared, and busy-only", async () => {
    // The defaults are the privacy design: an account is a person's first, and
    // titles are not synced until somebody says so.
    const { id } = await record();
    const [row] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));
    expect(row?.kind).toBe("personal");
    expect(row?.sharedWithBusiness).toBe(false);
    expect(row?.detailVisibility).toBe("busy_only");
  });

  it("lets the holder change what it shares", async () => {
    const { id } = await record();
    const updated = await setConnectionOptions.call(
      { id, sharedWithBusiness: true, detailVisibility: "full" },
      OWNER,
    );
    expect(updated.sharedWithBusiness).toBe(true);
    expect(updated.detailVisibility).toBe("full");
  });

  it("hides one person's connection from another", async () => {
    // A staff member connecting their calendar has not handed it to a
    // colleague. Not-yours and not-there answer alike.
    const { id } = await record({ userId: STAFF.userId }, STAFF);
    const listedByOther = await listConnections.call({ mine: true }, OWNER);
    expect(listedByOther.some((row) => row.id === id)).toBe(false);
  });

  it("lets a connection manager act for the business, but not a viewer", async () => {
    await expect(record({ userId: OWNER.userId }, STAFF)).resolves.toHaveProperty(
      "id",
    );
    expect(
      (await failure(record({ userId: OWNER.userId }, VIEWER))).code,
    ).toBe("permission");
  });

  it("is closed to API keys entirely", async () => {
    // A token store is not something an agent should be able to read, write,
    // or enumerate.
    expect((await failure(listConnections.call({}, AGENT))).code).toBe("permission");
    expect((await failure(record({}, AGENT))).code).toBe("permission");
  });

  it("forgets the credentials when disconnected", async () => {
    // Keeping a revoked connection "for the history" means keeping a token
    // nobody intends to use.
    const { id } = await record();
    await removeConnection.call({ id }, OWNER);
    expect(await db().select().from(connectedAccounts)).toHaveLength(0);
  });

  it("records a revoked grant as a state rather than an error", async () => {
    const { id } = await record();
    await flagConnection.call(
      { id, status: "needs_reconnect", reason: "The provider revoked access." },
      OWNER,
    );
    const [row] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));
    expect(row?.status).toBe("needs_reconnect");
    expect(row?.lastError).toContain("revoked");
  });

  it("switches a capability on and off without duplicating it", async () => {
    const { id } = await record();
    await setCapability.call({ id, capability: "mail_read", enabled: true }, OWNER);
    const off = await setCapability.call(
      { id, capability: "mail_read", enabled: false },
      OWNER,
    );
    expect(off.enabled).toBe(false);

    const { enabledCapabilities } = await import("@/core/connections/service");
    expect(await enabledCapabilities(db(), id)).toEqual(["calendar_read"]);
  });

  it("re-encrypts on a token refresh", async () => {
    const { id } = await record();
    const [before] = await db()
      .select({ c: connectedAccounts.credentials })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));

    await writeCredentials(db(), id, { access_token: "fresh", refresh_token: "r2" });

    const [after] = await db()
      .select({ c: connectedAccounts.credentials })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));
    expect(after?.c).not.toBe(before?.c);
    expect(await readCredentials(db(), id)).toEqual({
      access_token: "fresh",
      refresh_token: "r2",
    });
  });
});

describe.runIf(hasDatabase)("rotating the key", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  it("does nothing when everything is already current", async () => {
    // Running it twice is harmless, which is what makes it safe to re-run
    // after an interruption.
    await recordConnection.call(
      {
        userId: OWNER.userId,
        provider: "google",
        providerAccountId: "g-1",
        credentials: TOKENS,
      },
      OWNER,
    );
    expect(await rotateCredentials.call({}, OWNER)).toEqual({
      examined: 1,
      rotated: 0,
      failed: 0,
    });
  });

  it("flags a row it cannot read rather than destroying it", async () => {
    // A row whose key is gone still has to be visible: the owner needs to see
    // it in order to reconnect the account.
    const { id } = await recordConnection.call(
      {
        userId: OWNER.userId,
        provider: "google",
        providerAccountId: "g-1",
        credentials: TOKENS,
      },
      OWNER,
    );
    // Ciphertext bound to a different row is exactly what an unreadable
    // credential looks like from here.
    await db()
      .update(connectedAccounts)
      .set({ credentials: encryptSecret("something", "a-different-row") })
      .where(eq(connectedAccounts.id, id));

    expect(await rotateCredentials.call({}, OWNER)).toMatchObject({ failed: 1 });

    const [row] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, id));
    expect(row?.status).toBe("needs_reconnect");
    expect(row?.lastError).toContain("Reconnect");
  });

  it("requires connections manage and remains closed to keys", async () => {
    await expect(rotateCredentials.call({}, STAFF)).resolves.toBeDefined();
    expect((await failure(rotateCredentials.call({}, VIEWER))).code).toBe(
      "permission",
    );
    expect((await failure(rotateCredentials.call({}, AGENT))).code).toBe("permission");
  });
});
