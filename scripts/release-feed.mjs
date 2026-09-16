// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Build, sign and verify the update feed (MASTER.md §39.3, C10.03).
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FEED_SCHEMA = "freeholder/releases/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export class ReleaseFeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseFeedError";
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function unsignedEnvelope(feed) {
  const rest = { ...feed };
  delete rest.signature;
  return rest;
}

export function signFeed(feed, privateKeyPem, keyId, signedAt = new Date().toISOString()) {
  if (!keyId) throw new ReleaseFeedError("A release feed signature must name the key that produced it.");
  const envelope = {
    ...unsignedEnvelope(feed),
    schema: FEED_SCHEMA,
    keyId,
    signedAt,
  };
  const signature = sign(null, Buffer.from(canonicalJson(envelope)), createPrivateKey(privateKeyPem)).toString(
    "base64",
  );
  return { ...envelope, signature };
}

export function verifyFeed(feed, keys) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw new ReleaseFeedError("This is not a Freeholder release feed. Refusing to read it. This is not a warning.");
  }
  if (feed.schema !== FEED_SCHEMA) {
    throw new ReleaseFeedError("This is not a Freeholder release feed. Refusing to read it. This is not a warning.");
  }
  if (typeof feed.signature !== "string" || feed.signature.length === 0) {
    throw new ReleaseFeedError("This release feed has no signature. Refusing to read it. This is not a warning.");
  }
  const key = (keys ?? []).find((candidate) => candidate.id === feed.keyId);
  if (!key) {
    throw new ReleaseFeedError(
      `This release feed is signed by unknown key ${feed.keyId ?? "(missing)"}. Refusing to read it. This is not a warning.`,
    );
  }
  const payload = canonicalJson(unsignedEnvelope(feed));
  let ok = false;
  try {
    ok = verify(null, Buffer.from(payload), createPublicKey(key.publicKey), Buffer.from(feed.signature, "base64"));
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new ReleaseFeedError(
      "This release feed is not signed by a trusted Freeholder key. Refusing to read it. This is not a warning.",
    );
  }
  return unsignedEnvelope(feed);
}

export function upsertRelease(releases, entry) {
  const next = (releases ?? []).filter(
    (release) => !(release.version === entry.version && release.channel === entry.channel),
  );
  next.push(entry);
  next.sort((a, b) => (a.version < b.version ? 1 : a.version > b.version ? -1 : a.channel.localeCompare(b.channel)));
  return next;
}

export function buildReleaseEntry(input) {
  if (!DIGEST.test(input.digest ?? "")) {
    throw new ReleaseFeedError("A release entry must name an image digest (sha256: and 64 hex characters).");
  }
  if (!input.image) throw new ReleaseFeedError("A release entry must name the image repository.");
  if (!input.notesUrl) throw new ReleaseFeedError("A release entry must link to the assembled release notes.");
  if (!input.publishedAt) throw new ReleaseFeedError("A release entry must declare publishedAt.");
  if (!input.provenance?.repository || !input.provenance?.workflow) {
    throw new ReleaseFeedError("A release entry must name the repository and workflow that built it.");
  }
  return {
    version: input.version,
    channel: input.channel,
    minFromVersion: input.minFromVersion,
    schemaRisk: input.schemaRisk,
    cvss: input.cvss ?? null,
    severity: input.severity,
    manualSteps: input.manualSteps ?? [],
    pluginApi: input.pluginApi,
    digest: input.digest,
    image: input.image,
    notesUrl: input.notesUrl,
    publishedAt: input.publishedAt,
    provenance: {
      repository: input.provenance.repository,
      workflow: input.provenance.workflow,
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function main() {
  const command = process.argv[2];
  if (command === "sign") {
    const input = arg("--in");
    const output = arg("--out");
    const keyId = arg("--key-id", process.env.FREEHOLDER_RELEASE_KEY_ID);
    const privateKey = process.env.FREEHOLDER_RELEASE_SIGNING_KEY;
    if (!input || !output) throw new ReleaseFeedError("usage: release-feed.mjs sign --in unsigned.json --out releases.json");
    if (!privateKey) {
      throw new ReleaseFeedError("FREEHOLDER_RELEASE_SIGNING_KEY is required to sign the release feed.");
    }
    if (!keyId) throw new ReleaseFeedError("FREEHOLDER_RELEASE_KEY_ID or --key-id is required to sign the release feed.");
    const signed = signFeed(readJson(input), privateKey, keyId);
    writeJson(output, signed);
    return;
  }
  if (command === "publish") {
    const output = arg("--out");
    const previousPath = arg("--previous");
    const keyId = arg("--key-id", process.env.FREEHOLDER_RELEASE_KEY_ID);
    const privateKey = process.env.FREEHOLDER_RELEASE_SIGNING_KEY;
    if (!output) throw new ReleaseFeedError("usage: release-feed.mjs publish --out releases.json ...");
    if (!privateKey) {
      throw new ReleaseFeedError("FREEHOLDER_RELEASE_SIGNING_KEY is required to sign the release feed.");
    }
    if (!keyId) throw new ReleaseFeedError("FREEHOLDER_RELEASE_KEY_ID or --key-id is required to sign the release feed.");
    const previous = previousPath ? readJson(previousPath) : { releases: [] };
    const releases = Array.isArray(previous.releases) ? previous.releases : [];
    const cvssRaw = arg("--cvss");
    const entry = buildReleaseEntry({
      version: arg("--version"),
      channel: arg("--channel"),
      minFromVersion: arg("--min-from-version"),
      schemaRisk: arg("--schema-risk"),
      cvss: cvssRaw === undefined || cvssRaw === "null" ? null : Number(cvssRaw),
      severity: arg("--severity"),
      manualSteps: JSON.parse(arg("--manual-steps", "[]")),
      pluginApi: arg("--plugin-api"),
      digest: arg("--digest"),
      image: arg("--image"),
      notesUrl: arg("--notes-url"),
      publishedAt: arg("--published-at", new Date().toISOString()),
      provenance: {
        repository: arg("--repository"),
        workflow: arg("--workflow", "Publish image"),
      },
    });
    const signed = signFeed({ schema: FEED_SCHEMA, releases: upsertRelease(releases, entry) }, privateKey, keyId);
    writeJson(output, signed);
    return;
  }
  throw new ReleaseFeedError("usage: release-feed.mjs sign|publish");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
