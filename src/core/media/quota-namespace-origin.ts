// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C10.32/C11.08: private provisioning provenance. Historical origin is
// distinct from current complete accounting, writer closure and I/O authority.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ORIGIN_FORMAT, ORIGIN_INSTALL_DIRECTORY, ORIGIN_INSTALL_FORMAT, originCanonical, originSha256, verifySignedOrigin } from "../../../packages/cli/src/launch/namespace-origin";
import type { StorageBinding } from "@/adapters/storage/types";
import { storageNamespace } from "./storage-quota";
import { transferConflict } from "./transfer-proof";

const hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime({ offset: true });
const metadata = z.object({ ownerDigest: hash.nullable(), listingDigest: hash, bucket: z.object({ name: z.string(), createdAt: date }).strict().nullable() }).strict();
const bindingSchema = z.object({ endpoint: z.string().url(), region: z.string().regex(/^[a-z0-9]+$/), bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/) }).strict();
const receiptSchema = z.object({
  admission: z.object({ format: z.literal(ORIGIN_FORMAT), requestId: z.string().uuid(), installationId: z.string().uuid(), suffix: z.string().regex(/^[a-f0-9]{32}$/), provider: z.literal("digitalocean-spaces"), accountDigest: hash, binding: bindingSchema, bindingDigest: hash, verifierDigest: hash, method: z.literal("PUT"), pathDigest: hash, bodyDigest: hash, admittedAt: date }).strict(),
  before: metadata.nullable(), response: z.object({ status: z.number().int().min(100).max(599), requestIdDigest: hash.nullable(), providerDate: date.nullable(), bodyDigest: hash }).strict().nullable(), returnedAt: date.nullable(), after: metadata.nullable(), disposition: z.enum(["created", "existing", "unknown"]),
}).strict();
const installSchema = z.object({ format: z.literal(ORIGIN_INSTALL_FORMAT), installationId: z.string().uuid(), dropletId: z.number().int().positive().safe(), receiptDigest: hash }).strict();
const envelopeSchema = z.object({ body: z.unknown(), signature: z.string() }).strict();
export interface NamespaceOriginIdentity { readonly requestId: string; readonly installationId: string; readonly namespace: string; readonly originBindingDigest: string; readonly accountDigest: string; readonly receiptDigest: string; readonly installationDigest: string }
const authenticated = new WeakSet<NamespaceOriginIdentity>();

/** Pure validation is useful for refusal controls, but its result is NOT an
 * authenticated runtime object. Only the fixed private installed loader below
 * can create one. Public services accept none of these artifacts as input. */
export function verifyNamespaceOriginArtifacts(input: { publicKey: string; receipt: unknown; installation: unknown; binding: StorageBinding }): NamespaceOriginIdentity {
  const envelope = envelopeSchema.parse(input.receipt), installEnvelope = envelopeSchema.parse(input.installation);
  const receipt = receiptSchema.parse(verifySignedOrigin(envelope, input.publicKey));
  const installation = installSchema.parse(verifySignedOrigin(installEnvelope, input.publicKey));
  const original = receipt.admission, binding = original.binding;
  if (input.binding.kind !== "s3" || binding.endpoint !== `https://${binding.region}.digitaloceanspaces.com` || input.binding.location.endpoint !== binding.endpoint || input.binding.location.bucket !== binding.bucket || input.binding.namespace !== storageNamespace({ id: "s3", endpoint: binding.endpoint, bucket: binding.bucket }) || original.bindingDigest !== originSha256(originCanonical(binding)) || original.verifierDigest !== originSha256(input.publicKey) || !binding.bucket.endsWith(`-media-${original.suffix}`) || original.pathDigest !== originSha256(`/${binding.bucket}`) || original.bodyDigest !== originSha256("")) transferConflict("The installed storage origin does not identify this exact configured private namespace.");
  if (receipt.disposition !== "created" || !receipt.before || receipt.before.bucket !== null || !receipt.after?.bucket || receipt.after.bucket.name !== binding.bucket || receipt.before.ownerDigest !== receipt.after.ownerDigest || !receipt.response || receipt.response.status !== 200 || !receipt.response.requestIdDigest || !receipt.response.providerDate || receipt.response.bodyDigest !== originSha256("") || !receipt.returnedAt) transferConflict("The original namespace creation is incomplete or ambiguous. Keep its original records for recovery.");
  const receiptDigest = originSha256(originCanonical(envelope));
  if (installation.installationId !== original.installationId || installation.receiptDigest !== receiptDigest) transferConflict("The original storage receipt cannot be rebound to another installation.");
  return Object.freeze({ requestId: original.requestId, installationId: original.installationId, namespace: input.binding.namespace, originBindingDigest: original.bindingDigest, accountDigest: original.accountDigest, receiptDigest, installationDigest: originSha256(originCanonical(installEnvelope)) });
}
async function installedFile(name: string): Promise<string> {
  const file = await open(join(ORIGIN_INSTALL_DIRECTORY, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o027) !== 0 || info.size > 65536) transferConflict("The private storage origin record is not securely installed.");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}
/** No path/env/public verifier override. Root-owned read-only installation
 * trust is deliberately separate from owner authentication and site API keys. */
export async function loadInstalledNamespaceOrigin(binding: StorageBinding): Promise<NamespaceOriginIdentity> {
  const directory = await lstat(ORIGIN_INSTALL_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o027) !== 0) transferConflict("The private storage origin directory is not securely installed.");
  const publicKey = await installedFile("public.pem"), receipt: unknown = JSON.parse(await installedFile("receipt.json")), installation: unknown = JSON.parse(await installedFile("installation.json"));
  const identity = verifyNamespaceOriginArtifacts({ publicKey, receipt, installation, binding });
  authenticated.add(identity); return identity;
}
export function requireInstalledNamespaceOrigin(identity: NamespaceOriginIdentity, namespace: string): void {
  if (!authenticated.has(identity) || identity.namespace !== namespace) transferConflict("Only the actual privately installed namespace origin can start initialization.");
}
