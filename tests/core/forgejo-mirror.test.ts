// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(".forgejo/mirror/sync-main.sh");
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LC_ALL: "C" };
const directories: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(cwd: string, message: string) {
  git(cwd, "-c", "user.name=Mirror test", "-c", "user.email=mirror@example.test",
    "commit", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function repositories() {
  const source = mkdtempSync(join(tmpdir(), "freeholder-mirror-test-"));
  directories.push(source);
  git(source, "init", "--initial-branch=main");
  const common = commit(source, "common");
  const mirror = join(source, "mirror.git");
  const cache = join(source, "cache.git");
  git(source, "init", "--bare", mirror);
  git(source, "init", "--bare", cache);
  git(source, "push", mirror, "main");

  const run = (mode: "--apply" | "--check", runEnv = env) =>
    spawnSync("bash", [script, mode, cache, source, mirror], { env: runEnv, encoding: "utf8" });
  const mirrored = () => git(mirror, "rev-parse", "refs/heads/main");
  return { source, mirror, cache, common, run, mirrored };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe.skipIf(process.platform !== "linux")("private mirror sync", () => {
  it("reports a stale mirror and fast-forwards only main on explicit apply", () => {
    const { source, mirror, common, run, mirrored } = repositories();
    const upstream = commit(source, "reviewed upstream change");
    git(source, "tag", "upstream-only-tag");
    git(source, "branch", "upstream-only-branch");

    const check = run("--check");
    expect(check.status).toBe(1);
    expect(check.stdout).toContain(`upstream=${upstream} mirror=${common} behind=1 ahead=0`);
    expect(mirrored()).toBe(common);

    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(mirrored()).toBe(upstream);
    expect(git(mirror, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(run("--check").stdout).toContain("Mirror main is current.");
    expect(run("--apply").status).toBe(0);
  });

  it.each([false, true])("preserves mirror-only commits with upstream advancement %s", (advanceUpstream) => {
    const { source, mirror, run, mirrored } = repositories();
    git(source, "switch", "-c", "private");
    const privateCommit = commit(source, "private deploy work");
    git(source, "push", mirror, "private:main");
    git(source, "switch", "main");
    if (advanceUpstream) commit(source, "separate reviewed upstream change");

    const result = run("--apply");
    expect(result.status).toBe(2);
    expect(result.stdout).toContain(`behind=${advanceUpstream ? 1 : 0} ahead=1`);
    expect(mirrored()).toBe(privateCommit);
  });

  it("refuses a concurrent fast-forward even if the push could advance it again", () => {
    const { source, mirror, common, run, mirrored } = repositories();
    const intermediate = commit(source, "concurrent fast-forward");
    commit(source, "latest upstream change");
    git(mirror, "fetch", source, intermediate);
    // Change the tip after the script fetches both refs and before the real
    // push contacts the server. Without an exact lease this push would pass.
    const bin = join(source, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh
export PATH="$ORIGINAL_PATH"
if [ "$4" = push ]; then
  git -C "$TEST_MIRROR" update-ref refs/heads/main ${intermediate} ${common} || exit 1
fi
exec git "$@"
`, { mode: 0o755 });

    const result = run("--apply", { ...env, PATH: `${bin}:${process.env.PATH}`, ORIGINAL_PATH: process.env.PATH, TEST_MIRROR: mirror });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stale info");
    expect(mirrored()).toBe(intermediate);
  });

  it("fails closed if the mirror ref disappears after a successful comparison", () => {
    const { source, mirror, run } = repositories();
    expect(run("--check").status).toBe(0);
    commit(source, "new upstream change");
    git(mirror, "update-ref", "-d", "refs/heads/main");

    const result = run("--apply");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("couldn't find remote ref refs/heads/main");
    expect(git(mirror, "for-each-ref", "--format=%(refname)")).toBe("");
  });
});
