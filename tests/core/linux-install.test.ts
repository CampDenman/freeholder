// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.44: the no-Docker Linux install. These files are shell and systemd, not
// imported by anything, so the properties an owner relies on are pinned here.
// The installer itself runs end to end in .github/workflows/release-tarballs.yml.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { releaseArch, releaseName } from "../../scripts/build-release.mjs";

const LINUX = join("deploy", "linux");
const read = (path: string) => readFileSync(path, "utf8");
const version = (JSON.parse(read("package.json")) as { version: string }).version;

describe("the release version is the one every manual install names", () => {
  // Release preparation bumps package.json; this makes it bump the documented
  // install too, so a downloaded install.sh installs its own release and the
  // Docker recipe defaults to it rather than to `edge`.
  it("install.sh, the Compose defaults and the copyable blocks agree with package.json", () => {
    expect(read(join(LINUX, "install.sh"))).toContain(`FREEHOLDER_VERSION_DEFAULT="${version}"`);
    for (const file of ["compose.yml", "compose.https.yml"]) {
      expect(read(join("deploy/docker-selfhost/infra", file))).toContain(`ghcr.io/campdenman/freeholder:${version}}`);
    }
    const download = `https://github.com/CampDenman/freeholder/releases/download/v${version}/install.sh`;
    expect(read("GETTING_STARTED.md")).toContain(download);
    expect(read(join(LINUX, "README.md"))).toContain(download);
    expect(read("deploy/docker-selfhost/README.md")).toContain(`--branch v${version} `);
  });
});

describe("install.sh", () => {
  const script = read(join(LINUX, "install.sh"));

  it("is POSIX sh that dash parses, and stops at the first error", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toMatch(/^set -eu$/m);
    execFileSync("sh", ["-n", join(LINUX, "install.sh")]);
    execFileSync("sh", ["-n", join(LINUX, "freeholder")]);
  });

  it("verifies the tarball's SHA-256 before unpacking anything", () => {
    const verify = script.indexOf('[ "$expected" = "$actual" ]');
    expect(verify).toBeGreaterThan(0);
    expect(script.indexOf("tar -xzf")).toBeGreaterThan(verify);
    expect(script).toContain("checksum mismatch");
  });

  it("installs PostgreSQL 15+ and Caddy from distribution or official repositories only", () => {
    expect(script).toContain("/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh");
    expect(script).toContain("https://dl.cloudsmith.io/public/caddy/stable/gpg.key");
    expect(script).not.toMatch(/curl[^\n]*\|\s*(sh|bash)\b/);
  });

  it("unpacks into a versioned, root-owned release with a current symlink", () => {
    expect(script).toContain('release="/opt/freeholder/releases/${version}"');
    expect(script).toContain('chown -R root:root "$release.partial"');
    expect(script).toContain("mv -T /opt/freeholder/current.new /opt/freeholder/current");
  });
});

describe("the freeholder operator command", () => {
  const command = read(join(LINUX, "freeholder"));

  it("generates secrets with openssl and keeps them private", () => {
    expect(command).toContain("openssl rand -hex 32");
    for (const name of ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD"]) {
      expect(command).toContain(`ensure_secret ${name}`);
    }
    expect(command).toContain('chown root:freeholder "$tmp"');
    expect(command).toContain('chmod 640 "$tmp"');
    // The database password goes to psql on stdin, never on a command line.
    expect(command).toMatch(/psql -v ON_ERROR_STOP=1 -qtA postgres\) <<SQL/);
  });

  it("defaults to local media in the data directory, outside the replaceable release", () => {
    expect(command).toContain("env_set FREEHOLDER_STORAGE local");
    expect(command).toContain('env_set LOCAL_STORAGE_ROOT "$MEDIA"');
    expect(command).toContain("MEDIA=$DATA/media");
    expect(command).toContain("DATA=/var/lib/freeholder");
  });

  it("backs up a custom-format dump and the media with checksums, and restores into a scratch database", () => {
    expect(command).toContain("pg_dump --format=custom --no-owner --no-privileges freeholder");
    expect(command).toContain("media.tar.gz");
    expect(command).toContain("sha256sum ./* > SHA256SUMS");
    expect(command).toContain("sha256sum --quiet -c SHA256SUMS");
    expect(command).toMatch(/pg_restore [^\n]*-d freeholder_restore/);
    expect(command).not.toMatch(/^\s*[^#\n]*--clean/m);
    // A restore takes a safety backup before it changes anything.
    const restore = command.slice(command.indexOf("cmd_restore() {"));
    expect(restore.indexOf('cmd_backup --reason "before-restore"')).toBeLessThan(restore.indexOf("restore_database"));
  });

  it("updates only to a verified release, backs up first, and rolls back the release and database on failure", () => {
    const update = command.slice(command.indexOf("cmd_update() {"), command.indexOf("rollback_to() {"));
    expect(command).toContain('[ -n "$expected" ] && [ "$expected" = "$actual" ]');
    expect(update.indexOf("fetch_release")).toBeLessThan(update.indexOf("cmd_backup"));
    expect(update.indexOf("cmd_backup")).toBeLessThan(update.indexOf("switch_to"));
    expect(update).toContain('rollback_to "$from" "$backup"');
    const rollback = command.slice(command.indexOf("rollback_to() {"));
    expect(rollback).toContain('restore_database "$BACKUPS/$2/database.dump"');
  });

  it("prints the claim link only to the operator's terminal", () => {
    expect(command).toContain("printf '%s/setup#claim=%s\\n'");
    expect(command).toMatch(/cmd_claim_link\(\) \{\n  need_root claim-link/);
  });

  it("starts on an sslip.io address when DNS is not ready, the same naming as the CLI", () => {
    expect(command).toContain("sslip_host()");
    expect(command).toContain("tr . -");
  });
});

describe("systemd and Caddy", () => {
  it("runs as the freeholder user with a read-only release and only the data directory writable", () => {
    const unit = read(join(LINUX, "share/systemd/freeholder.service"));
    expect(unit).toMatch(/^User=freeholder$/m);
    expect(unit).toMatch(/^ProtectSystem=strict$/m);
    expect(unit).toMatch(/^ReadWritePaths=\/var\/lib\/freeholder$/m);
    expect(unit).toMatch(/HOSTNAME=127\.0\.0\.1/);
    expect(unit).toMatch(/^ExecStart=\/opt\/freeholder\/current\/runtime\/node\/bin\/node server\.js$/m);
  });

  it("backs up nightly, catching up after downtime", () => {
    const timer = read(join(LINUX, "share/systemd/freeholder-backup.timer"));
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* 03:15:00$/m);
    expect(timer).toMatch(/^Persistent=true$/m);
    expect(read(join(LINUX, "share/systemd/freeholder-backup.service"))).toContain("freeholder backup --scheduled");
  });

  it("the Caddyfile overwrites the trusted client header and refuses the image optimizer", () => {
    const caddy = read(join(LINUX, "share/Caddyfile.template"));
    expect(caddy).toContain("reverse_proxy 127.0.0.1:3000");
    expect(caddy).toMatch(/header_up X-Freeholder-Client-Ip \{client_ip\}/);
    expect(caddy).toMatch(/@nextImage path \/_next\/image \/_next\/image\/\*\n\s*respond @nextImage 404/);
    expect(read(join(LINUX, "freeholder"))).toContain("env_set TRUSTED_CLIENT_IP_HEADER x-freeholder-client-ip");
  });
});

describe("the recipe", () => {
  it("is a complete recipe whose artifacts exist", () => {
    const recipe = parse(read(join(LINUX, "recipe.yaml"))) as { name: string; artifacts: string[]; operations: Record<string, string> };
    expect(recipe.name).toBe("linux");
    for (const artifact of recipe.artifacts) expect(() => read(artifact)).not.toThrow();
    for (const operation of ["install", "verify", "backup", "restore", "update", "rollback"]) {
      expect(recipe.operations[operation]).toBeTruthy();
    }
  });
});

describe("release tarball naming", () => {
  it("names one tarball per version and architecture", () => {
    expect(releaseName("0.2.0-beta.5", "x64")).toBe("freeholder-0.2.0-beta.5-linux-x64");
    expect(releaseName("1.0.0", "arm64")).toBe("freeholder-1.0.0-linux-arm64");
    expect(() => releaseArch("ia32")).toThrow(/x64 and arm64/);
    expect(() => releaseName("latest", "x64")).toThrow(/release version/);
  });

  it("is built and installed for both architectures before a release gets it", () => {
    const workflow = read(".github/workflows/release-tarballs.yml");
    expect(workflow).toContain("runner: ubuntu-24.04-arm");
    expect(workflow).toContain("sudo sh dist/release/install.sh --tarball");
    expect(workflow).toContain("sudo freeholder restore latest");
    expect(workflow).toContain("actions/attest-build-provenance@");
  });
});
