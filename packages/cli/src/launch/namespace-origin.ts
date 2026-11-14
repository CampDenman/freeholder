// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C10.32/C11.08: an actual one-shot provisioning receipt, never an
// empty-bucket assertion. No credentials or raw provider response are retained.
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BucketCreateObserver, SpacesClient } from "./s3.js";

export const ORIGIN_FORMAT = "freeholder.provider-namespace-origin/v1";
export const ORIGIN_INSTALL_FORMAT = "freeholder.provider-namespace-installation/v1";
export const ORIGIN_INSTALL_DIRECTORY = "/run/freeholder/namespace-origin";
export const originSha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
/** A separate domain from all existing media HMAC/whole-row proof domains. */
export function originCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(originCanonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${originCanonical(item)}`).join(",") + "}";
  throw new Error("Invalid namespace origin proof value.");
}
export interface OriginBinding { endpoint: string; region: string; bucket: string }
export interface BucketMetadata {
  ownerDigest: string | null;
  listingDigest: string;
  bucket: { name: string; createdAt: string } | null;
}
interface Admission {
  format: typeof ORIGIN_FORMAT;
  requestId: string;
  installationId: string;
  suffix: string;
  provider: "digitalocean-spaces";
  accountDigest: string;
  binding: OriginBinding;
  bindingDigest: string;
  verifierDigest: string;
  method: "PUT";
  pathDigest: string;
  bodyDigest: string;
  admittedAt: string;
}
interface ResponseFact { status: number; requestIdDigest: string | null; providerDate: string | null; bodyDigest: string }
export interface NamespaceOriginReceipt {
  admission: Admission;
  before: BucketMetadata | null;
  response: ResponseFact | null;
  returnedAt: string | null;
  after: BucketMetadata | null;
  disposition: "created" | "existing" | "unknown";
}
export interface SignedOrigin<T> { body: T; signature: string }
export interface NamespaceOriginInstallation {
  format: typeof ORIGIN_INSTALL_FORMAT;
  installationId: string;
  dropletId: number;
  receiptDigest: string;
}
const digest = (value: unknown) => originSha256(originCanonical(value));
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

/** Exclusive, fsynced first write, including its directory entry. A crash never
 * permits replacing an admission/outcome with a newer alleged first request. */
async function firstWrite(directory: string, name: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || typeof process.getuid !== "function" || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new Error("Namespace origin records require the owner's private directory.");
  const file = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
  // The receipt directory may itself have been created in this operation.
  const ancestor = await open(dirname(directory), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await ancestor.sync(); } finally { await ancestor.close(); }
}
async function present(directory: string, name: string): Promise<boolean> {
  try { const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW); await file.close(); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}
async function key(directory: string): Promise<{ privateKey: string; publicKey: string }> {
  if (!(await present(directory, "origin-private.pem"))) {
    // A lost key beside existing evidence is debt, never permission to rotate.
    if (await present(directory, "admission.json")) throw new Error("The original namespace signer needs recovery.");
    const pair = generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
    await firstWrite(directory, "origin-private.pem", pair.privateKey);
    await firstWrite(directory, "origin-public.pem", pair.publicKey);
  }
  return { privateKey: await readFile(join(directory, "origin-private.pem"), "utf8"), publicKey: await readFile(join(directory, "origin-public.pem"), "utf8") };
}
function signed<T>(body: T, privateKey: string): SignedOrigin<T> { return { body, signature: sign(null, Buffer.from(originCanonical(body)), privateKey).toString("base64") }; }
export function verifySignedOrigin<T>(envelope: SignedOrigin<T>, publicKey: string): T {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519" || !envelope || typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) || !verify(null, Buffer.from(originCanonical(envelope.body)), key, Buffer.from(envelope.signature, "base64"))) throw new Error("The installed namespace origin signature is invalid.");
  return envelope.body;
}

/** Finite dependency-free ListBuckets grammar. Rejects DTDs, comments,
 * attributes outside the one standard xmlns, entities, duplicate names and
 * unexpected structure. It is deliberately NOT the permissive listKeys regex.
 * Bucket names/dates/owner IDs cannot contain XML entity characters. */
export function readBucketMetadata(xml: string, bucket: string): BucketMetadata {
  if (Buffer.byteLength(xml) > 4 * 1024 * 1024 || /[&\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw new Error("Unverifiable Spaces bucket metadata.");
  const text = xml.trim().replace(/^<\?xml version="1\.0"(?: encoding="UTF-8")?\?>\s*/, "");
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== text) throw new Error("Malformed Spaces bucket metadata.");
  const stack: string[] = [], values = new Map<string, string[]>();
  const paths = new Set(["ListAllMyBucketsResult", "ListAllMyBucketsResult/Owner", "ListAllMyBucketsResult/Owner/ID", "ListAllMyBucketsResult/Owner/DisplayName", "ListAllMyBucketsResult/Buckets", "ListAllMyBucketsResult/Buckets/Bucket", "ListAllMyBucketsResult/Buckets/Bucket/Name", "ListAllMyBucketsResult/Buckets/Bucket/CreationDate"]);
  const entries: { name: string; createdAt: string }[] = [];
  let roots = 0, current: { name?: string; createdAt?: string } | null = null;
  let bucketFields = new Set<string>();
  const expanded = tokens.flatMap(token => /^<(Buckets|DisplayName)\s*\/>$/.test(token) ? [`<${/^<([A-Za-z]+)/.exec(token)?.[1]}>`, `</${/^<([A-Za-z]+)/.exec(token)?.[1]}>`] : [token]);
  for (const token of expanded) {
    if (token.startsWith("</")) {
      const name = token.slice(2, -1);
      if (stack.pop() !== name) throw new Error("Unbalanced Spaces bucket metadata.");
      if (name === "Bucket") { if (!current?.name || !current.createdAt) throw new Error("Incomplete Spaces bucket metadata."); entries.push({ name: current.name, createdAt: current.createdAt }); current = null; }
    } else if (token.startsWith("<")) {
      const match = /^<([A-Za-z]+)(?: xmlns="http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/")?>$/.exec(token);
      if (!match || stack.length === 0 && ++roots !== 1) throw new Error("Unsupported Spaces bucket metadata.");
      const name = match[1]!; stack.push(name);
      if (!paths.has(stack.join("/")) || token.includes(" xmlns=") && stack.length !== 1) throw new Error("Unexpected Spaces bucket metadata field.");
      const path = stack.join("/");
      if (["Name", "CreationDate"].includes(name)) { if (bucketFields.has(name)) throw new Error("Duplicate Spaces bucket metadata field."); bucketFields.add(name); }
      if (!["Bucket", "Name", "CreationDate", "ID", "DisplayName"].includes(name)) { if (values.has(path)) throw new Error("Duplicate Spaces bucket metadata."); values.set(path, []); }
      if (name === "Bucket") { if (current) throw new Error("Nested Spaces bucket metadata."); current = {}; bucketFields = new Set(); }
    } else {
      if (!token.trim()) continue;
      const path = stack.join("/"), name = stack.at(-1);
      if (!["ID", "DisplayName", "Name", "CreationDate"].includes(name ?? "") || token !== token.trim()) throw new Error("Unexpected Spaces bucket metadata text.");
      if (name === "Name" || name === "CreationDate") {
        if (!current || name === "Name" && current.name || name === "CreationDate" && current.createdAt) throw new Error("Duplicate Spaces bucket metadata field.");
        if (name === "Name") current.name = token; else current.createdAt = token;
      } else { if (values.has(path)) throw new Error("Duplicate Spaces owner metadata."); values.set(path, [token]); }
    }
  }
  const owner = values.get("ListAllMyBucketsResult/Owner/ID")?.[0];
  // DO's published response omits Owner. The authenticated account UUID and
  // actual temporary-key creation remain mandatory; never invent an Owner ID.
  if (stack.length || roots !== 1 || values.has("ListAllMyBucketsResult/Owner") && !owner || !values.has("ListAllMyBucketsResult/Buckets") || new Set(entries.map(entry => entry.name)).size !== entries.length || entries.some(entry => !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(entry.name) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(entry.createdAt) || !Number.isFinite(Date.parse(entry.createdAt)))) throw new Error("Incomplete Spaces bucket identity metadata.");
  return { ownerDigest: owner ? originSha256(owner) : null, listingDigest: digest(entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), bucket: entries.find(entry => entry.name === bucket) ?? null };
}

/** This object is installed only by the actual owner-run launcher. A resumed
 * admission cannot dispatch again, even if its first request lost its reply. */
export async function createNamespaceOrigin(directory: string, input: { siteName: string; accountId: string; endpoint: string; region: string }): Promise<{ bucket: string; create(spaces: SpacesClient): Promise<void> }> {
  const keys = await key(directory);
  if (await present(directory, "admission.json")) throw new Error("This namespace creation was already admitted; retain its original evidence for recovery.");
  const suffix = randomBytes(16).toString("hex"), bucket = `${input.siteName.slice(0, 24)}-media-${suffix}`;
  const binding = { endpoint: input.endpoint, region: input.region, bucket };
  const admission: Admission = { format: ORIGIN_FORMAT, requestId: randomUUID(), installationId: randomUUID(), suffix, provider: "digitalocean-spaces", accountDigest: originSha256(input.accountId), binding, bindingDigest: digest(binding), verifierDigest: originSha256(keys.publicKey), method: "PUT", pathDigest: originSha256(`/${bucket}`), bodyDigest: originSha256(""), admittedAt: new Date().toISOString() };
  await firstWrite(directory, "admission.json", JSON.stringify(signed(admission, keys.privateKey)));
  let consumed = false;
  return { bucket, async create(spaces) {
    if (consumed) throw new Error("The original namespace request cannot be replayed."); consumed = true;
    // A distinct durable dispatch fence prevents another process/closure from
    // replaying the real provider request after a lost reply or process crash.
    await firstWrite(directory, "dispatch.json", JSON.stringify({ requestId: admission.requestId }));
    let before: BucketMetadata | null = null, after: BucketMetadata | null = null;
    const observed: { response: ResponseFact | null; returnedAt: string | null } = { response: null, returnedAt: null };
    let disposition: NamespaceOriginReceipt["disposition"] = "unknown";
    const observer: BucketCreateObserver = { async response(fact) { observed.response = fact; await firstWrite(directory, "response.json", JSON.stringify(signed({ requestId: admission.requestId, fact }, keys.privateKey))); }, async returned() { observed.returnedAt = new Date().toISOString(); await firstWrite(directory, "returned.json", JSON.stringify(signed({ requestId: admission.requestId, returnedAt: observed.returnedAt }, keys.privateKey))); } };
    try {
      before = readBucketMetadata(await spaces.bucketMetadata(), bucket);
      await firstWrite(directory, "before.json", JSON.stringify(signed({ requestId: admission.requestId, metadata: before }, keys.privateKey)));
      if (before.bucket) throw new Error("The admitted new namespace already exists; no create was attempted.");
      const created = await spaces.createBucket(bucket, observer);
      after = readBucketMetadata(await spaces.bucketMetadata(), bucket);
      await firstWrite(directory, "after.json", JSON.stringify(signed({ requestId: admission.requestId, metadata: after }, keys.privateKey)));
      // The unpredictable never-reused name, actual one-shot original request,
      // account metadata and private provenance are all necessary. HTTP200 by
      // itself is deliberately insufficient (including AWS us-east-1).
      const fact = observed.response;
      if (created && fact && fact.status === 200 && fact.bodyDigest === originSha256("") && fact.requestIdDigest && fact.providerDate && observed.returnedAt && after.bucket && after.ownerDigest === before.ownerDigest) disposition = "created";
      else if (!created) disposition = "existing";
    } finally {
      const body: NamespaceOriginReceipt = { admission, before, response: observed.response, returnedAt: observed.returnedAt, after, disposition };
      await firstWrite(directory, "receipt.json", JSON.stringify(signed(body, keys.privateKey)));
    }
  } };
}

export async function namespaceOriginInstallation(directory: string, dropletId: number): Promise<{ publicKey: string; receipt: string; installation: string }> {
  if (!Number.isSafeInteger(dropletId) || dropletId <= 0) throw new Error("The actual original server identity is missing.");
  const keys = await key(directory), receipt = await readFile(join(directory, "receipt.json"), "utf8");
  const envelope = JSON.parse(receipt) as SignedOrigin<NamespaceOriginReceipt>;
  const original = verifySignedOrigin(envelope, keys.publicKey);
  const body: NamespaceOriginInstallation = { format: ORIGIN_INSTALL_FORMAT, installationId: original.admission.installationId, dropletId, receiptDigest: digest(envelope) };
  const installation = JSON.stringify(signed(body, keys.privateKey));
  if (!(await present(directory, "installation.json"))) await firstWrite(directory, "installation.json", installation);
  const retained = await readFile(join(directory, "installation.json"), "utf8");
  if (originCanonical(verifySignedOrigin(JSON.parse(retained) as SignedOrigin<NamespaceOriginInstallation>, keys.publicKey)) !== originCanonical(body)) throw new Error("The namespace origin belongs to a different installation; it cannot be rebound.");
  return { publicKey: keys.publicKey, receipt, installation: retained };
}

/** Resume only the already returned first successful media creation. This
 * completes remaining launch steps; it never replays that create request. */
export async function requireReturnedNamespaceOrigin(directory: string, bucket: string, expected: { accountId: string; endpoint: string; region: string }): Promise<void> {
  const publicKey = await readFile(join(directory, "origin-public.pem"), "utf8");
  const retained = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")) as SignedOrigin<NamespaceOriginReceipt>;
  const receipt = verifySignedOrigin(retained, publicKey);
  if (receipt.disposition !== "created" || receipt.admission.binding.bucket !== bucket || receipt.admission.accountDigest !== originSha256(expected.accountId) || receipt.admission.binding.endpoint !== expected.endpoint || receipt.admission.binding.region !== expected.region || !receipt.returnedAt || receipt.response?.status !== 200 || !receipt.after?.bucket || receipt.before?.bucket) throw new Error("The original namespace creation has no complete successful first receipt; preserve it for recovery.");
}
