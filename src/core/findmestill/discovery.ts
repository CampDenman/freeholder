// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C7.08: verify public contact discovery before a Freeholder flow can link it.
import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const profile = "findmestill-card-v0.1";
const protectedHeader = Buffer.from(`{"alg":"Ed25519","typ":"${profile}"}`).toString("base64url");
const compactSegment = /^[A-Za-z0-9_-]+$/;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const maxDocumentBytes = 262_144;
const maxCardBytes = 4_090;
const maxCards = 64;
const clockSkewSeconds = 300;
const maxLifetimeSeconds = 366 * 86_400;
const contactIdentifier = /^fms1-[A-Za-z0-9_-]{43}$/;
export const findMeStillContactId = z.string().regex(contactIdentifier);

function base64url(segment: string, bytes?: number): Buffer {
  if (!compactSegment.test(segment)) throw new Error("Invalid FindMeStill base64url segment.");
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment || (bytes !== undefined && decoded.length !== bytes)) {
    throw new Error("Noncanonical FindMeStill base64url segment.");
  }
  return decoded;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

const locator = z.string().max(768).refine((value) => {
  const match = /^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?(\/[A-Za-z0-9_.~/-]*)$/.exec(value);
  const [, host, port, path] = match ?? [];
  if (!host || !path) return false;
  const labels = host.split(".");
  return host.length <= 253 && labels.length >= 2 && !host.endsWith(".localhost")
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && /^[a-z]/.test(labels.at(-1) ?? "")
    && (!port || (port !== "443" && Number(port) <= 65_535))
    && !path.includes("//") && !path.split("/").some((segment) => segment === "." || segment === "..")
    && URL.canParse(value) && new URL(value).href === value;
});
const timestamp = z.int().positive();
const cardPayload = z.tuple([
  z.literal(profile),
  findMeStillContactId,
  z.string().length(43),
  z.int().positive(),
  z.string().length(43).nullable(),
  timestamp,
  timestamp,
  locator,
  z.array(locator).max(2),
]);

export interface VerifiedFindMeStillCard {
  readonly contactId: string;
  readonly revision: number;
  readonly compactJws: string;
  readonly digest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly primaryCardUrl: string;
  readonly backupCardUrls: readonly string[];
}

function verifyCard(compactJws: string, expectedContactId: string, now: number) {
  if (compactJws.length > maxCardBytes) throw new Error("FindMeStill card is too large.");
  const [header, payload, signature, ...extra] = compactJws.split(".");
  if (header !== protectedHeader || !payload || !signature || extra.length > 0) {
    throw new Error("Invalid FindMeStill compact JWS header or structure.");
  }
  const json = strictUtf8.decode(base64url(payload));
  const values = cardPayload.parse(JSON.parse(json));
  if (JSON.stringify(values) !== json) throw new Error("Noncanonical FindMeStill card payload.");
  const [, contactId, root, revision, previousDigest, issuedAt, expiresAt, primaryCardUrl, backupCardUrls] = values;
  base64url(root, 32);
  const jwk = { crv: "Ed25519", kty: "OKP", x: root };
  // RFC 7638 and RFC 8037 use exactly these JWK members in lexical order.
  if (contactId !== expectedContactId || contactId !== `fms1-${digest(JSON.stringify(jwk))}`) {
    throw new Error("FindMeStill contact identifier does not match the signing key.");
  }
  if ((revision === 1) !== (previousDigest === null)) throw new Error("Invalid FindMeStill predecessor.");
  if (previousDigest !== null) base64url(previousDigest, 32);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (!verify(null, Buffer.from(`${header}.${payload}`), publicKey, base64url(signature, 64))) {
    throw new Error("Invalid FindMeStill card signature.");
  }
  if (issuedAt - now > clockSkewSeconds || expiresAt <= issuedAt || expiresAt - issuedAt > maxLifetimeSeconds
    || new Set([primaryCardUrl, ...backupCardUrls]).size !== 1 + backupCardUrls.length) {
    throw new Error("Invalid FindMeStill card lifetime or locators.");
  }
  return {
    contactId, revision, previousDigest, compactJws, digest: digest(compactJws),
    issuedAt, expiresAt, primaryCardUrl, backupCardUrls,
  };
}

const chainDocument = z.array(z.string().max(maxCardBytes)).min(1).max(maxCards);

export function verifyFindMeStillDocument(document: Uint8Array, contactId: string, now: number): VerifiedFindMeStillCard[] {
  if (document.byteLength > maxDocumentBytes) throw new Error("FindMeStill discovery document is too large.");
  const chain = chainDocument.parse(JSON.parse(strictUtf8.decode(document)));
  const verified: VerifiedFindMeStillCard[] = [];
  for (const compactJws of chain) {
    const previous = verified.at(-1);
    const { previousDigest, ...card } = verifyCard(compactJws, contactId, now);
    if (card.revision !== verified.length + 1 || previousDigest !== (previous?.digest ?? null)
      || (previous && card.issuedAt < previous.issuedAt)) {
      throw new Error("FindMeStill discovery chain is out of sequence.");
    }
    verified.push(card);
  }
  return verified;
}

/** Inspect an exact local pin, including an expired pin whose locators can still carry a move. */
export function inspectFindMeStillPin(compactJws: string, contactId: string, now: number): VerifiedFindMeStillCard {
  const { previousDigest: _previousDigest, ...pin } = verifyCard(compactJws, contactId, now);
  return pin;
}

/**
 * Select a card from public discovery bytes. Locators are fetched by the caller.
 * Use the expected ID from a trusted introduction or saved contact. A refresh uses
 * the saved contact's previously verified JWS and its signed locators.
 * A verified card establishes signing-key continuity. Site grants are a separate check.
 */
export function selectFindMeStillDiscovery(documents: readonly Uint8Array[], options: {
  now: number;
  contactId: string;
  pinnedJws?: string;
}): VerifiedFindMeStillCard {
  const { contactId, now, pinnedJws } = options;
  if (!contactIdentifier.test(contactId) || !Number.isSafeInteger(now) || now < 1) {
    throw new Error("FindMeStill discovery requires a contact identifier and UTC clock.");
  }
  const observed = new Map<number, string>();
  const pin = pinnedJws === undefined ? undefined : verifyCard(pinnedJws, contactId, now);
  let head: VerifiedFindMeStillCard | undefined;
  if (pin) {
    const { previousDigest: _previousDigest, ...savedCard } = pin;
    head = savedCard;
    observed.set(pin.revision, pin.compactJws);
  }
  for (const document of documents) {
    let chain: VerifiedFindMeStillCard[];
    try {
      chain = verifyFindMeStillDocument(document, contactId, now);
    } catch {
      // A damaged copy is unavailable. A separately valid copy still counts.
      continue;
    }
    if (pin) {
      // Genesis is index 0, and the pin signs the exact bytes at revision N-1.
      const predecessor = chain[pin.revision - 2];
      if (predecessor && predecessor.digest !== pin.previousDigest) {
        throw new Error("Conflicting FindMeStill discovery chains.");
      }
    }
    for (const card of chain) {
      const other = observed.get(card.revision);
      if (other !== undefined && other !== card.compactJws) {
        throw new Error("Conflicting FindMeStill discovery chains.");
      }
      observed.set(card.revision, card.compactJws);
      if (!head || card.revision > head.revision) head = card;
    }
  }
  if (!head) throw new Error("No verified FindMeStill discovery card.");
  if (head.expiresAt <= now) throw new Error("FindMeStill discovery head has expired.");
  return head;
}
