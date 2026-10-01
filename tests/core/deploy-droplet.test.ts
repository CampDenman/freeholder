// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The droplet deploy path must pin the attested linux/amd64 manifest and
// must not learn a host address from the repository.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertHealthUrl,
  assertReleaseAttestation,
  attestationArguments,
  deployTargetFromEnv,
  parseRevision,
  selectLinuxAmd64Digest,
  SIGNER_WORKFLOW,
  waitForHealth,
} from "../../scripts/deploy-droplet.mjs";

const AMD = "a".repeat(64);
const OTHER = "b".repeat(64);
const SOURCE = "c".repeat(40);
const PIN = `ghcr.io/campdenman/freeholder@sha256:${AMD}`;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function attestation(certificateOverrides: Record<string, string> = {}) {
  const certificate = {
    sourceRepositoryURI: "https://github.com/CampDenman/freeholder",
    sourceRepositoryRef: "refs/heads/main",
    sourceRepositoryDigest: SOURCE,
    githubWorkflowTrigger: "push",
    buildSignerURI: SIGNER_WORKFLOW,
    ...certificateOverrides,
  };
  return [{
    verificationResult: {
      statement: {
        predicateType: "https://slsa.dev/provenance/v1",
        subject: [{
          name: "ghcr.io/campdenman/freeholder",
          digest: { sha256: AMD },
        }],
      },
      signature: { certificate },
    },
  }];
}

describe("published image identity", () => {
  it("accepts a commit, a sha- tag, or a digest, and nothing movable", () => {
    expect(parseRevision(SOURCE)).toEqual({
      reference: `sha-${SOURCE.slice(0, 12)}`,
      gitSha: SOURCE,
    });
    expect(parseRevision(SOURCE.slice(0, 12)).reference).toBe(`sha-${SOURCE.slice(0, 12)}`);
    expect(parseRevision(`sha-${SOURCE.slice(0, 12)}`).gitSha).toBe(SOURCE.slice(0, 12));
    expect(parseRevision(PIN)).toEqual({ reference: `sha256:${AMD}`, gitSha: null });
    for (const rejected of ["edge", "latest", "sha-abc", "ghcr.io/example/app@sha256:" + AMD, ""]) {
      expect(() => parseRevision(rejected)).toThrow(/revision must be/);
    }
  });

  it("selects linux/amd64 from an index and ignores an attestation manifest", () => {
    expect(selectLinuxAmd64Digest({
      mediaType: "application/vnd.oci.image.index.v1+json",
      headerDigest: `sha256:${OTHER}`,
      body: {
        manifests: [
          {
            digest: `sha256:${"d".repeat(64)}`,
            platform: { os: "unknown", architecture: "unknown" },
          },
          {
            digest: `sha256:${AMD}`,
            platform: { architecture: "amd64", os: "linux" },
          },
        ],
      },
    })).toBe(`sha256:${AMD}`);
  });

  it("uses the registry header digest for a single-platform manifest", () => {
    expect(selectLinuxAmd64Digest({
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      headerDigest: `sha256:${AMD}`,
      body: {},
    })).toBe(`sha256:${AMD}`);
  });

  it("refuses an index without exactly one linux/amd64 manifest", () => {
    expect(() => selectLinuxAmd64Digest({
      mediaType: "application/vnd.oci.image.index.v1+json",
      body: { manifests: [] },
    })).toThrow(/exactly one linux\/amd64/);
  });

  it("requires main-push CI provenance for the same digest", () => {
    expect(assertReleaseAttestation(attestation(), { pin: PIN, gitSha: SOURCE })).toBe(SOURCE);
    expect(assertReleaseAttestation(attestation(), {
      pin: PIN,
      gitSha: SOURCE.slice(0, 12),
    })).toBe(SOURCE);
    expect(() => assertReleaseAttestation(attestation(), {
      pin: PIN,
      gitSha: "d".repeat(40),
    })).toThrow(/does not match/);
    expect(() => assertReleaseAttestation(
      attestation({ sourceRepositoryRef: "refs/pull/1/merge" }),
      { pin: PIN, gitSha: null },
    )).toThrow(/refs\/heads\/main/);
    expect(attestationArguments(PIN)).toContain(SIGNER_WORKFLOW);
  });
});

describe("deploy target", () => {
  const base = {
    DEPLOY_HOST: "droplet.example",
    DEPLOY_SSH_KEY_PATH: "/keys/deploy",
    DEPLOY_KNOWN_HOSTS_FILE: "/keys/known_hosts",
    DEPLOY_HEALTH_URL: "https://app.example/api/health",
  };

  it("reads the host from the environment and defaults the recipe's account and directory", () => {
    expect(deployTargetFromEnv(base)).toMatchObject({
      host: "droplet.example",
      user: "root",
      dir: "/opt/freeholder",
      healthUrl: "https://app.example/api/health",
    });
  });

  it("rejects a missing host, a shell metacharacter, and a non-readiness URL", () => {
    expect(() => deployTargetFromEnv({ ...base, DEPLOY_HOST: "" })).toThrow(/DEPLOY_HOST/);
    expect(() => deployTargetFromEnv({ ...base, DEPLOY_HOST: "-oProxyCommand=x" })).toThrow(/DEPLOY_HOST/);
    expect(() => deployTargetFromEnv({ ...base, DEPLOY_HOST: "10.1.2.999" })).toThrow(/IPv4/);
    expect(() => assertHealthUrl("http://app.example/api/health")).toThrow(/https/);
    expect(() => assertHealthUrl("https://app.example/")).toThrow(/\/api\/health/);
    expect(() => assertHealthUrl("https://user:pw@app.example/api/health")).toThrow(/https/);
  });

  it("treats only an ok readiness body as healthy", async () => {
    const fetches: string[] = [];
    await expect(waitForHealth("https://app.example/api/health", {
      attempts: 2,
      pauseMs: 0,
      sleep: async () => {},
      fetchImpl: async (url) => {
        fetches.push(String(url));
        if (fetches.length === 1) return { ok: false, status: 503, json: async () => ({ ok: false }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, modules: 1 }) };
      },
    })).resolves.toBeUndefined();
    await expect(waitForHealth("https://app.example/api/health", {
      attempts: 1,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
    })).rejects.toThrow(/Not rolling back/);
  });
});

describe("remote image swap", () => {
  function apply(options: {
    env: string;
    pin?: string;
    backup?: string;
    log?: string;
    attempts?: string;
    pause?: string;
    dockerFails?: boolean;
  }) {
    const root = join(tmpdir(), `freeholder-deploy-${process.pid}-${Math.random().toString(16).slice(2)}`);
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const dir = join(root, "opt");
    mkdirSync(dir);
    writeFileSync(join(dir, "compose.yml"), "name: freeholder\n");
    writeFileSync(join(dir, ".env"), options.env);
    writeFileSync(join(dir, "backup.sh"), options.backup ?? [
      "#!/bin/sh",
      "echo \"backup: uploaded freeholder-2026-10-01T00-00-00Z.dump and checksum (2048 bytes)\"",
    ].join("\n"));
    chmodSync(join(dir, "backup.sh"), 0o755);
    const log = join(root, "app.log");
    writeFileSync(join(bin, "docker"), [
      "#!/bin/sh",
      "if [ \"$1\" != compose ]; then echo unexpected >&2; exit 1; fi",
      "case \"$2\" in",
      "  pull) exit 0 ;;",
      `  up) printf '%s\\n' '${options.log ?? "[freeholder] schema is up to date"}' > '${log}' ;;`,
      `  logs) cat '${log}' ;;`,
      "  *) echo unexpected compose >&2; exit 1 ;;",
      "esac",
    ].join("\n"));
    chmodSync(join(bin, "docker"), 0o755);
    if (options.dockerFails) writeFileSync(join(bin, "docker"), "#!/bin/sh\necho docker-called >&2\nexit 1\n");
    const result = spawnSync("bash", [
      "-s", "--",
      options.pin ?? PIN,
      dir,
      options.attempts ?? "2",
      options.pause ?? "0",
    ], {
      input: readFileSync("scripts/deploy-droplet-remote.sh"),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      envFile: readFileSync(join(dir, ".env"), "utf8"),
    };
  }

  const baseEnv = `POSTGRES_PASSWORD=secret-value\nFREEHOLDER_DOMAIN=app.example\nOTHER=keep\n`;

  it("backs up, pins the digest, and keeps an existing moving tag out of the rollback pin", () => {
    const applied = apply({ env: `${baseEnv}FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:edge\n` });
    expect(applied.status).toBe(0);
    expect(applied.output).toContain("backup: database archive uploaded");
    expect(applied.output).toContain("schema is up to date");
    expect(applied.output).not.toContain("secret-value");
    expect(applied.envFile).toContain(`FREEHOLDER_IMAGE=${PIN}`);
    expect(applied.envFile).not.toContain("PREVIOUS_FREEHOLDER_IMAGE");
    expect(applied.envFile).toContain("OTHER=keep");
    expect(applied.envFile).toContain("secret-value");
  });

  it("records the previous digest pin and does not print the backup's extra output", () => {
    const previous = `ghcr.io/campdenman/freeholder@sha256:${OTHER}`;
    const applied = apply({
      env: `${baseEnv}FREEHOLDER_IMAGE=${previous}\n`,
      backup: [
        "#!/bin/sh",
        "echo secret-value",
        "echo \"backup: uploaded freeholder-2026-10-01T00-00-00Z.dump and checksum (2048 bytes)\"",
      ].join("\n"),
    });
    expect(applied.status).toBe(0);
    expect(applied.output).not.toContain("secret-value");
    expect(applied.envFile).toContain(`PREVIOUS_FREEHOLDER_IMAGE=${previous}`);
    expect(applied.envFile).toContain(`FREEHOLDER_IMAGE=${PIN}`);
  });

  it("leaves .env untouched when the backup fails or the pin is not a digest", () => {
    const original = `${baseEnv}FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:edge\n`;
    const failed = apply({ env: original, backup: "#!/bin/sh\necho secret-value\nexit 1\n" });
    expect(failed.status).toBe(1);
    expect(failed.output).toContain("image pin was not changed");
    expect(failed.output).not.toContain("secret-value");
    expect(failed.envFile).toBe(original);

    const rejected = apply({ env: original, pin: "ghcr.io/campdenman/freeholder:edge" });
    expect(rejected.status).toBe(2);
    expect(rejected.envFile).toBe(original);
  });

  it("does not recreate the stack when the pin is already in place", () => {
    const applied = apply({
      env: `${baseEnv}FREEHOLDER_IMAGE=${PIN}\n`,
      dockerFails: true,
      backup: "#!/bin/sh\nexit 1\n",
    });
    expect(applied.status).toBe(0);
    expect(applied.output).toContain("already pinned");
  });

  it("stops when the new process skipped migrations and does not claim a rollback", () => {
    const applied = apply({
      env: baseEnv,
      log: "[freeholder] migrations skipped: no DATABASE_URL",
    });
    expect(applied.status).toBe(1);
    expect(applied.output).toContain("not rolling back");
    expect(applied.envFile).toContain(`FREEHOLDER_IMAGE=${PIN}`);
  });
});

describe("the pipeline stays out of the public deploy surface", () => {
  const sources = [
    "scripts/deploy-droplet.mjs",
    "scripts/deploy-droplet-remote.sh",
    ".forgejo/workflows/deploy-production.yml",
    "deploy/digitalocean-droplet/deploy.md",
  ].map((path) => readFileSync(path, "utf8")).join("\n");

  it("contains no host address", () => {
    expect(sources).not.toMatch(IPV4);
  });

  it("runs only as a confirmed Forgejo job, pinned to immutable actions", () => {
    const workflow = readFileSync(".forgejo/workflows/deploy-production.yml", "utf8");
    expect(workflow).toContain('test "$CONFIRMATION" = "DEPLOY PRODUCTION"');
    expect(workflow).toContain("runs-on: freeholder-release");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("github.event");
    const uses = [...workflow.matchAll(/^ {8}uses: (\S+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses) {
      expect(reference).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(workflow).toContain("persist-credentials: false");
    expect(() => readFileSync(".github/workflows/deploy-production.yml")).toThrow();
  });
});
