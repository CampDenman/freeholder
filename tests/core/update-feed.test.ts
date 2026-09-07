// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ReleaseFeedError, signFeed, verifyReleaseFeed } from "@/core/update/feed";
import { TRUSTED_RELEASE_KEYS } from "@/core/update/keys";
import { verifyFeed } from "@/core/update/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function entry() {
  return {
    version: "0.1.0",
    channel: "stable",
    minFromVersion: "0.1.0",
    schemaRisk: "compatible",
    cvss: null,
    severity: "none",
    manualSteps: [],
    pluginApi: "0.1.0",
    digest: `sha256:${"ab".repeat(32)}`,
    image: "ghcr.io/campdenman/freeholder",
    notesUrl: "https://github.com/CampDenman/freeholder/releases/tag/v0.1.0",
    publishedAt: "2026-09-07T00:00:00.000Z",
    provenance: { repository: "CampDenman/freeholder", workflow: "Publish image" },
  };
}

describe("signed release feed (C10.03)", () => {
  it("embeds a parseable active Ed25519 public key", () => {
    expect(TRUSTED_RELEASE_KEYS.some((key) => key.status === "active")).toBe(true);
    expect(TRUSTED_RELEASE_KEYS[0]?.publicKey).toMatch(/BEGIN PUBLIC KEY/);
  });

  it("accepts a feed signed by an active or retiring trusted key", () => {
    const active = pair();
    const retiring = pair();
    const keys = [
      { id: "now", publicKey: active.publicKey, status: "active" as const },
      { id: "was", publicKey: retiring.publicKey, status: "retiring" as const },
    ];
    const unsigned = { schema: "freeholder/releases/v1", releases: [entry()] };
    const current = verifyReleaseFeed(signFeed(unsigned, active.privateKey, "now", "2026-09-07T00:00:00.000Z"), keys);
    expect(current.releases).toHaveLength(1);
    expect(current.releases[0]?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const previous = verifyReleaseFeed(signFeed(unsigned, retiring.privateKey, "was", "2026-09-07T00:00:00.000Z"), keys);
    expect(previous.keyId).toBe("was");
  });

  it("hard-stops on a missing signature, a tamper, or an untrusted key", () => {
    const trusted = pair();
    const stranger = pair();
    const keys = [{ id: "now", publicKey: trusted.publicKey, status: "active" as const }];
    const unsigned = { schema: "freeholder/releases/v1", releases: [entry()] };
    const signed = signFeed(unsigned, trusted.privateKey, "now", "2026-09-07T00:00:00.000Z");
    expect(() => verifyReleaseFeed({ ...signed, signature: undefined }, keys)).toThrow(ReleaseFeedError);
    expect(() => verifyReleaseFeed({ ...signed, signature: undefined }, keys)).toThrow(/not a warning/i);
    const tampered = { ...signed, releases: [{ ...entry(), digest: `sha256:${"cd".repeat(32)}` }] };
    expect(() => verifyReleaseFeed(tampered, keys)).toThrow(/not signed by a trusted/i);
    expect(() => verifyReleaseFeed(signFeed(unsigned, stranger.privateKey, "now", "2026-09-07T00:00:00.000Z"), keys)).toThrow(
      /not signed by a trusted/i,
    );
    expect(() => verifyReleaseFeed(signFeed(unsigned, stranger.privateKey, "other", "2026-09-07T00:00:00.000Z"), keys)).toThrow(
      /unknown key/i,
    );
  });

  it("refuses to sign when the private key is missing", () => {
    const result = spawnSync(process.execPath, ["scripts/release-feed.mjs", "sign", "--in", "nope.json", "--out", "out.json"], {
      encoding: "utf8",
      env: { ...process.env, FREEHOLDER_RELEASE_SIGNING_KEY: "", FREEHOLDER_RELEASE_KEY_ID: "2026-09" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FREEHOLDER_RELEASE_SIGNING_KEY/);
  });
});

describe.runIf(hasDatabase)("platform.verifyReleaseFeed (C10.03)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("refuses anonymous callers and maps a bad signature to a hard stop", async () => {
    const denied = await failure(verifyFeed.call({ feed: { schema: "freeholder/releases/v1" } }, ANONYMOUS));
    expect(denied.code).toBe("permission");
    const bad = await failure(verifyFeed.call({ feed: { schema: "freeholder/releases/v1", signature: "nope" } }, OWNER));
    expect(bad.code).toBe("validation");
    expect(bad.message).toMatch(/not a warning/i);
  });
});
