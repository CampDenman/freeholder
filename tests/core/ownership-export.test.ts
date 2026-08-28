// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { connectedAccounts } from "@/core/connections/schema";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { assets } from "@/core/media/schema";
import {
  buildMediaManifest,
  createOwnershipExport,
  credentialKeyFingerprint,
  isSecretColumn,
  type MediaManifest,
} from "@/core/portability/ownership-export.mjs";
import {
  guardedDrillUrl,
  runOwnershipDrill,
} from "../../scripts/ownership-drill.mjs";
import {
  closeDb,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("ownership export boundaries", () => {
  it("names authentication material rather than trusting a broad substring", () => {
    expect(isSecretColumn("credentials")).toBe(true);
    expect(isSecretColumn("token_hash")).toBe(true);
    expect(isSecretColumn("encrypted_secret")).toBe(true);
    expect(isSecretColumn("provider_upload_id")).toBe(true);
    expect(isSecretColumn("refresh_token")).toBe(true);
    expect(isSecretColumn("input_tokens")).toBe(false);
    expect(isSecretColumn("credential_ref")).toBe(false);
    expect(isSecretColumn("public_key")).toBe(false);
  });

  it("fingerprints valid credential keys without preserving their encoding", () => {
    const bytes = Buffer.alloc(32, 7);
    expect(credentialKeyFingerprint(bytes.toString("hex"))).toBe(
      credentialKeyFingerprint(bytes.toString("base64url")),
    );
    expect(credentialKeyFingerprint("too-short")).toBeNull();
    expect(credentialKeyFingerprint()).toBeNull();
  });

  it("reports media inventory gaps in both directions", () => {
    const manifest = buildMediaManifest(
      [
        {
          id: "asset-1",
          filename: "photo.jpg",
          kind: "image",
          mime: "image/jpeg",
          byte_size: 10,
          status: "ready",
          scan_status: "clean",
          storage_key: "original.jpg",
          variants: { webp: [{ key: "variant.webp" }] },
          checksum_sha256: "a".repeat(64),
          source: "upload",
          deleted_at: null,
          purge_after: null,
        },
      ],
      [
        {
          key: "original.jpg",
          asset_id: "asset-1",
          upload_id: null,
          role: "original",
          state: "attached",
          bytes: 10,
          content_type: "image/jpeg",
        },
        {
          key: "orphan.tmp",
          asset_id: null,
          upload_id: null,
          role: "staged",
          state: "pending",
          bytes: 2,
          content_type: "application/octet-stream",
        },
      ],
    );
    expect(manifest.integrity.missingInventoryKeys).toEqual(["variant.webp"]);
    expect(manifest.integrity.unreferencedInventoryKeys).toEqual(["orphan.tmp"]);
  });

  it("refuses an ordinary database before a destructive restore rehearsal", () => {
    expect(() => guardedDrillUrl()).toThrow(/disposable database/);
    expect(() => guardedDrillUrl("postgres://localhost/freeholder_prod")).toThrow(
      /test or drill/,
    );
    expect(
      guardedDrillUrl("postgres://localhost/freeholder_test").database,
    ).toBe("freeholder_test");
  });

  it("refuses libpq routing overrides before opening an admin connection", async () => {
    await expect(
      runOwnershipDrill({
        sourceDatabaseUrl:
          "postgres://localhost/freeholder_test?host=somewhere-else",
      }),
    ).rejects.toThrow(/query parameter "host"/);
  });
});

describe.runIf(hasDatabase)("complete ownership export", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
      passwordHash: "password-hash-must-not-export",
    });
    await db().insert(connectedAccounts).values({
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "ownership-export",
      email: "owner@example.test",
      credentials: "oauth-credential-must-not-export",
    });
    await db().insert(auditLog).values({
      actor: "user:ownership-export",
      action: "ownership.fixture",
      diff: {
        refreshToken: "nested-refresh-must-not-export",
        inputTokens: 123,
      },
    });
    await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: "ownership/original.jpg",
        filename: "original.jpg",
        mime: "image/jpeg",
        legacyBytes: 12,
        bytes: 12,
        checksumSha256: "b".repeat(64),
        scanStatus: "clean",
      });
  });

  afterAll(async () => {
    await closeDb();
  });

  it(
    "covers every application table, inventories media, and emits no secret value",
    async () => {
      const parent = await mkdtemp(path.join(tmpdir(), "freeholder-export-test-"));
      const output = path.join(parent, "export");
      const credentialKey = Buffer.alloc(32, 9).toString("hex");
      try {
        const configPath = path.resolve("freeholder.config.ts");
        const result = await createOwnershipExport({
          databaseUrl: process.env.DATABASE_URL!,
          outputDirectory: output,
          configuration: {
            filename: path.basename(configPath),
            contents: await readFile(configPath, "utf8"),
          },
          environment: {
            NODE_ENV: "test",
            APP_URL:
              "https://operator:app-url-secret@example.test/freeholder?token=query-secret",
            CREDENTIAL_KEY: credentialKey,
            SESSION_SECRET: "session-secret-must-not-export",
            DATABASE_URL: "database-url-must-not-export",
            S3_SECRET_ACCESS_KEY: "storage-secret-must-not-export",
          },
          now: new Date("2026-08-13T00:00:00.000Z"),
        });

        const tableCount = await db().execute<{ count: number }>(sql`
          select count(*)::int as count
          from information_schema.tables
          where table_type = 'BASE TABLE'
            and table_schema not in ('information_schema', 'pg_catalog')
            and table_schema not like 'pg_toast%'
            and table_schema not like 'pg_temp_%'
        `);
        expect(result.manifest.tableCount).toBe(tableCount[0]!.count);
        expect(result.manifest.completeTableInventory).toBe(true);
        expect(result.manifest.secretValuesIncluded).toBe(false);

        const accountExport = await readFile(
          path.join(output, "data", "public", "connected_accounts.json"),
          "utf8",
        );
        const userExport = await readFile(
          path.join(output, "data", "public", "users.json"),
          "utf8",
        );
        const recovery = await readFile(
          path.join(output, "recovery.json"),
          "utf8",
        );
        const auditExport = await readFile(
          path.join(output, "data", "public", "audit_log.json"),
          "utf8",
        );
        const media = JSON.parse(
          await readFile(path.join(output, "media-manifest.json"), "utf8"),
        ) as unknown as MediaManifest;
        const manifest = await readFile(
          path.join(output, "manifest.json"),
          "utf8",
        );

        expect(accountExport).toContain('"credentials": "[REDACTED]"');
        expect(userExport).toContain('"password_hash": "[REDACTED]"');
        expect(accountExport).not.toContain("oauth-credential-must-not-export");
        expect(userExport).not.toContain("password-hash-must-not-export");
        expect(auditExport).not.toContain("nested-refresh-must-not-export");
        expect(auditExport).toContain('"refreshToken": "[REDACTED]"');
        expect(auditExport).toContain('"inputTokens": 123');
        expect(recovery).not.toContain(credentialKey);
        expect(recovery).not.toContain("session-secret-must-not-export");
        expect(recovery).not.toContain("database-url-must-not-export");
        expect(recovery).not.toContain("storage-secret-must-not-export");
        expect(recovery).not.toContain("app-url-secret");
        expect(recovery).not.toContain("query-secret");
        expect(recovery).toContain("https://example.test/freeholder");
        expect(recovery).toContain(credentialKeyFingerprint(credentialKey));
        expect(media.assets).toHaveLength(1);
        expect(media.objects).toHaveLength(1);
        expect(media.integrity).toEqual({
          missingInventoryKeys: [],
          unreferencedInventoryKeys: [],
        });
        expect(manifest).not.toContain(process.env.DATABASE_URL!);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
