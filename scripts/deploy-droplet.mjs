// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Operator image swap for the droplet recipe (MASTER.md §21b).
//
// GitHub publishes a signed image when main's CI succeeds. Nothing in that
// workflow changes a server. This command is the missing step, and it is
// meant to run from the private forge, not from GitHub: the host address
// arrives in the environment and is never written here.
//
// `docker buildx imagetools create` makes the `sha-<12>` tag an OCI index.
// `gh attestation verify` answers 404 for that index digest. The attestation
// is on the linux/amd64 manifest the index points at, and that manifest is
// the pin Compose must use. Verifying or pinning the index is the wrong
// digest.
//
// This is not C10.06 and it does not turn unattended apply back on. A person
// still names the revision and confirms the production deploy.
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const IMAGE = "ghcr.io/campdenman/freeholder";
export const REPOSITORY = "CampDenman/freeholder";
export const SIGNER_WORKFLOW =
  "https://github.com/CampDenman/freeholder/.github/workflows/ci.yml@refs/heads/main";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PIN = /^ghcr\.io\/campdenman\/freeholder@sha256:[a-f0-9]{64}$/;
const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);
const MANIFEST_ACCEPT = [
  ...INDEX_TYPES,
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const remoteScriptPath = fileURLToPath(
  new URL("./deploy-droplet-remote.sh", import.meta.url),
);

export function parseRevision(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (PIN.test(value)) {
    return { reference: value.slice(value.indexOf("@") + 1), gitSha: null };
  }
  if (/^[a-f0-9]{40}$/.test(value)) {
    return { reference: `sha-${value.slice(0, 12)}`, gitSha: value };
  }
  const tagged = /^sha-([a-f0-9]{12})$/.exec(value);
  if (tagged) return { reference: value, gitSha: tagged[1] };
  if (/^[a-f0-9]{12}$/.test(value)) {
    return { reference: `sha-${value}`, gitSha: value };
  }
  throw new Error(
    "revision must be a 40-character commit, a 12-character commit, sha-<12>, or ghcr.io/campdenman/freeholder@sha256:<64>",
  );
}

export function selectLinuxAmd64Digest(manifest) {
  const body = manifest?.body;
  const mediaType = manifest?.mediaType || body?.mediaType;
  const index = INDEX_TYPES.has(mediaType) || Array.isArray(body?.manifests);
  if (index) {
    const matches = (body?.manifests ?? []).filter((item) => {
      const platform = item?.platform;
      return platform?.os === "linux"
        && platform?.architecture === "amd64"
        && (platform.variant == null || platform.variant === "");
    });
    if (matches.length !== 1 || !DIGEST.test(matches[0]?.digest ?? "")) {
      throw new Error("the published tag's index did not contain exactly one linux/amd64 manifest");
    }
    return matches[0].digest;
  }
  if (!DIGEST.test(manifest?.headerDigest ?? "")) {
    throw new Error("the registry response did not include a sha256 docker-content-digest");
  }
  return manifest.headerDigest;
}

export async function resolvePublishedDigest(revision, fetchImpl = globalThis.fetch) {
  const parsed = parseRevision(revision);
  const tokenResponse = await fetchImpl(
    "https://ghcr.io/token?service=ghcr.io&scope=repository:campdenman/freeholder:pull",
  );
  if (!tokenResponse.ok) {
    throw new Error(`registry token request failed (${tokenResponse.status})`);
  }
  const tokenBody = await tokenResponse.json();
  if (typeof tokenBody.token !== "string" || tokenBody.token.length === 0) {
    throw new Error("registry token response had no token");
  }
  const manifestResponse = await fetchImpl(
    `https://ghcr.io/v2/campdenman/freeholder/manifests/${parsed.reference}`,
    {
      headers: {
        Authorization: `Bearer ${tokenBody.token}`,
        Accept: MANIFEST_ACCEPT,
      },
    },
  );
  if (!manifestResponse.ok) {
    throw new Error(`manifest ${parsed.reference} was not found (${manifestResponse.status})`);
  }
  const headerDigest = manifestResponse.headers.get("docker-content-digest") ?? "";
  const mediaType = (manifestResponse.headers.get("content-type") ?? "").split(";")[0].trim();
  const body = await manifestResponse.json();
  const digest = selectLinuxAmd64Digest({ mediaType, headerDigest, body });
  return { ...parsed, digest, pin: `${IMAGE}@${digest}` };
}

export function attestationArguments(pin) {
  if (!PIN.test(pin)) throw new Error("refusing to verify a pin that is not an immutable image digest");
  return [
    "attestation",
    "verify",
    `oci://${pin}`,
    "--repo",
    REPOSITORY,
    "--cert-identity",
    SIGNER_WORKFLOW,
    "--cert-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "--format",
    "json",
  ];
}

export function assertReleaseAttestation(payload, { pin, gitSha }) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("expected exactly one attestation for the published image");
  }
  const result = payload[0]?.verificationResult;
  const certificate = result?.signature?.certificate;
  const subject = result?.statement?.subject?.[0];
  const digest = subject?.digest?.sha256;
  if (subject?.name !== IMAGE || digest !== pin.slice(pin.indexOf("sha256:") + "sha256:".length)) {
    throw new Error("attestation subject is not the linux/amd64 image being pinned");
  }
  if (result?.statement?.predicateType !== "https://slsa.dev/provenance/v1") {
    throw new Error("attestation is not SLSA provenance");
  }
  if (certificate?.sourceRepositoryURI !== "https://github.com/CampDenman/freeholder") {
    throw new Error("attestation was not produced by this repository");
  }
  if (certificate?.sourceRepositoryRef !== "refs/heads/main") {
    throw new Error("attestation was not produced from refs/heads/main");
  }
  if (certificate?.githubWorkflowTrigger !== "push") {
    throw new Error("attestation was not produced by a push to main");
  }
  if (certificate?.buildSignerURI !== SIGNER_WORKFLOW) {
    throw new Error("attestation was not signed by the main CI workflow");
  }
  const source = certificate?.sourceRepositoryDigest;
  if (typeof source !== "string" || !/^[a-f0-9]{40}$/.test(source)) {
    throw new Error("attestation did not name the source commit");
  }
  if (gitSha != null && source !== gitSha && !source.startsWith(gitSha)) {
    throw new Error("attestation commit does not match the requested revision");
  }
  return source;
}

export function assertHealthUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DEPLOY_HEALTH_URL must be https://<host>/api/health");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("DEPLOY_HEALTH_URL must be https://<host>/api/health");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new Error("DEPLOY_HEALTH_URL must use port 443");
  }
  if (url.pathname !== "/api/health") {
    throw new Error("DEPLOY_HEALTH_URL must be the public readiness path /api/health");
  }
  return url.toString();
}

export function deployTargetFromEnv(env = process.env) {
  const host = env.DEPLOY_HOST ?? "";
  const user = env.DEPLOY_USER || "root";
  const key = env.DEPLOY_SSH_KEY_PATH ?? "";
  const knownHosts = env.DEPLOY_KNOWN_HOSTS_FILE ?? "";
  const dir = env.DEPLOY_DIR || "/opt/freeholder";
  const hostname = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  if (!hostname.test(host) && !ipv4.test(host)) {
    throw new Error("DEPLOY_HOST is missing or not a hostname or IPv4 address");
  }
  if (ipv4.test(host) && host.split(".").some((octet) => Number(octet) > 255)) {
    throw new Error("DEPLOY_HOST is not an IPv4 address");
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) {
    throw new Error("DEPLOY_USER is not a safe account name");
  }
  for (const [label, path] of [["DEPLOY_SSH_KEY_PATH", key], ["DEPLOY_KNOWN_HOSTS_FILE", knownHosts]]) {
    if (!path.startsWith("/") || path.includes("..") || /\s/.test(path)) {
      throw new Error(`${label} must be an absolute path`);
    }
  }
  if (!/^\/[A-Za-z0-9._/-]+$/.test(dir) || dir.includes("..")) {
    throw new Error("DEPLOY_DIR is not a safe absolute path");
  }
  return {
    host,
    user,
    key,
    knownHosts,
    dir,
    healthUrl: assertHealthUrl(env.DEPLOY_HEALTH_URL ?? ""),
  };
}

export async function waitForHealth(url, {
  attempts = 90,
  pauseMs = 2000,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  assertHealthUrl(url);
  let last = "no response";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (response.ok && body?.ok === true) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "request failed";
    }
    if (attempt < attempts) await sleep(pauseMs);
  }
  throw new Error(
    `readiness did not pass (${last}). FREEHOLDER_IMAGE is already the new pin. Not rolling back automatically.`,
  );
}

export function remoteApplyScript() {
  return readFileSync(remoteScriptPath, "utf8");
}

function runRemote(target, pin) {
  if (!existsSync(target.key)) throw new Error("deploy key file is missing");
  if (!existsSync(target.knownHosts)) throw new Error("known_hosts file is missing");
  const child = spawn("ssh", [
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${target.knownHosts}`,
    "-o", "ConnectTimeout=20",
    "-i", target.key,
    `${target.user}@${target.host}`,
    "bash", "-s", "--", pin, target.dir, "90", "2",
  ], { stdio: ["pipe", "inherit", "inherit"] });
  child.stdin.end(remoteApplyScript());
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`remote deploy exited ${code}`));
    });
  });
}

async function verifyWithGh(pin, gitSha) {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("gh", attestationArguments(pin), {
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr ?? "")
      : "";
    throw new Error(`attestation verification failed${stderr ? `: ${stderr.trim()}` : ""}`);
  }
  return assertReleaseAttestation(JSON.parse(stdout), { pin, gitSha });
}

async function main() {
  const revisionIndex = process.argv.indexOf("--revision");
  const revision = revisionIndex === -1 ? "" : process.argv[revisionIndex + 1];
  if (!revision || revision.startsWith("--")) {
    console.error("usage: node scripts/deploy-droplet.mjs --revision <commit-or-pin> [--dry-run]");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const resolved = await resolvePublishedDigest(revision);
  const source = await verifyWithGh(resolved.pin, resolved.gitSha);
  console.log(`pinned ${resolved.pin}`);
  console.log(`built from ${source} on refs/heads/main`);
  if (dryRun) return;
  const target = deployTargetFromEnv();
  await runRemote(target, resolved.pin);
  await waitForHealth(target.healthUrl);
  console.log("readiness passed");
}

if (process.argv[1]?.endsWith("deploy-droplet.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "deploy failed");
    process.exit(1);
  });
}
