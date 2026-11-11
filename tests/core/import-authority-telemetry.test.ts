// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: last-use telemetry cannot interfere with guarded key authority reads.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey } from "@/core/apikeys/tokens";
import { actorFromRequest } from "@/core/http/actor";
import { hasDatabase, truncateSpine } from "../helpers/spine";

async function credential() {
  const minted = mintApiKey();
  const [key] = await db().insert(apiKeys).values({ name: "Fictional concurrent source authority", prefix: minted.prefix, tokenHash: minted.tokenHash, scopes: ["imports.sourceGraph"] }).returning();
  return { id: key!.id, request: () => new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${minted.token}` } }) };
}

describe.runIf(hasDatabase)("guarded import authentication telemetry", () => {
  beforeEach(truncateSpine);
  afterAll(() => { vi.restoreAllMocks(); return closeDb(); });
  it("finishes concurrent request telemetry before exposing actors to a guarded authority transaction", async () => {
    const key = await credential();
    const actors = await Promise.all(Array.from({ length: 12 }, () => actorFromRequest(key.request())));
    for (const actor of actors) expect(actor).toMatchObject({ kind: "agent", keyId: key.id });
    await db().transaction(async tx => {
      const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, key.id)).for("share", { noWait: true });
      expect(row!.lastUsedAt).not.toBeNull();
    });
  });
  it("authenticates without waiting on a key already held by an authorized operation", async () => {
    const key = await credential();
    let entered!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const transaction = db().transaction(async tx => { await tx.select().from(apiKeys).where(eq(apiKeys.id, key.id)).for("share"); entered(); await gate; });
    try {
      await locked;
      expect(await actorFromRequest(key.request())).toMatchObject({ kind: "agent", keyId: key.id });
      expect((await db().select().from(apiKeys).where(eq(apiKeys.id, key.id)))[0]!.lastUsedAt).toBeNull();
    } finally { release(); await transaction; }
  });
  it("preserves authentication when the best-effort telemetry write fails", async () => {
    const key = await credential(), warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const write = vi.spyOn(db(), "execute").mockRejectedValueOnce(new Error("Fictional last-use telemetry failure"));
    try {
      expect(await actorFromRequest(key.request())).toMatchObject({ kind: "agent", keyId: key.id });
      expect(warning).toHaveBeenCalledWith("[apikeys] could not record last use", expect.any(Error));
    } finally { write.mockRestore(); warning.mockRestore(); }
  });
});
