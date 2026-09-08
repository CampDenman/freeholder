// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  classifyDivergence,
  compareVersions,
  missingReleases,
  missingSecurityReleases,
  planForkMerge,
  summarizeDrift,
} from "@/core/update/fork";
import {
  attemptUpstreamMerge,
  isSafeRef,
  isSafeRemote,
  parseAheadBehind,
  parseNameOnly,
  type GitResult,
  type GitRunner,
} from "@/core/update/fork-merge";
import type { VerifiedRelease } from "@/core/update/feed";

function release(overrides: Partial<VerifiedRelease>): VerifiedRelease {
  return {
    version: "0.2.0",
    channel: "stable",
    minFromVersion: "0.1.0",
    schemaRisk: "compatible",
    cvss: null,
    severity: "none",
    manualSteps: [],
    pluginApi: "0.1.0",
    digest: `sha256:${"a".repeat(64)}`,
    image: "ghcr.io/campdenman/freeholder",
    notesUrl: "https://example.test/notes",
    publishedAt: "2026-09-01T00:00:00.000Z",
    provenance: { repository: "CampDenman/freeholder", workflow: "publish-image.yml" },
    ...overrides,
  };
}

describe("fork lane (C10.09)", () => {
  describe("drift and missing security", () => {
    it("counts only releases the fork's channel would have been offered", () => {
      const releases = [
        release({ version: "0.2.0", channel: "stable" }),
        release({ version: "0.3.0", channel: "edge" }),
        release({ version: "0.1.1", channel: "security", cvss: 8.1, severity: "high" }),
      ];
      const stable = missingReleases({ currentVersion: "0.1.0", channel: "stable", releases });
      expect(stable.map((r) => r.version)).toEqual(["0.1.1", "0.2.0"]);

      // A security-channel instance is not "behind" because a feature exists.
      const security = missingReleases({ currentVersion: "0.1.0", channel: "security", releases });
      expect(security.map((r) => r.version)).toEqual(["0.1.1"]);
    });

    it("never reports a release the fork already has", () => {
      const releases = [release({ version: "0.1.0" }), release({ version: "0.0.9" })];
      expect(missingReleases({ currentVersion: "0.1.0", channel: "stable", releases })).toEqual([]);
    });

    it("treats an unscored release as news, not as exposure", () => {
      const missing = missingReleases({
        currentVersion: "0.1.0",
        channel: "stable",
        releases: [release({ version: "0.2.0", cvss: null, severity: "none" })],
      });
      expect(missingSecurityReleases(missing)).toEqual([]);
    });

    it("says the sentence the admin line needs, in security terms", () => {
      const drift = summarizeDrift({
        ahead: 3,
        behind: 14,
        divergedPaths: ["src/core/update/fork.ts", "plugins/mine/index.ts", ".env"],
        currentVersion: "0.1.0",
        channel: "stable",
        releases: [
          release({ version: "0.1.1", channel: "security", cvss: 8.1, severity: "high" }),
          release({ version: "0.1.2", channel: "security", cvss: 5.4, severity: "medium" }),
        ],
      });
      expect(drift.status).toBe("behind-security");
      expect(drift.sentence).toBe(
        "2 security releases behind — CVSS 8.1; this fork carries 3 commits of its own",
      );
      expect(drift.worstCvss).toBe(8.1);
      // Owner-owned paths are reported apart from replaceable core.
      expect(drift.diverged.seam).toEqual([".env", "plugins/mine/index.ts"]);
      expect(drift.diverged.core).toEqual(["src/core/update/fork.ts"]);
    });

    it("only says up to date when that is true of security too", () => {
      const drift = summarizeDrift({
        ahead: 0,
        behind: 0,
        divergedPaths: [],
        currentVersion: "0.9.0",
        channel: "stable",
        releases: [release({ version: "0.1.1", channel: "security", cvss: 8.1, severity: "high" })],
      });
      expect(drift.status).toBe("current");
      expect(drift.sentence).toBe("Up to date with upstream");
    });

    it("orders versions numerically rather than as strings", () => {
      expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
      expect(compareVersions("nonsense", "0.1.0")).toBeNull();
    });

    it("classifies every diverging path as owner or core", () => {
      const buckets = classifyDivergence([
        "src/core/db.ts",
        "freeholder.config.ts",
        "plugins/a/x.ts",
        "README.md",
      ]);
      expect(buckets.core).toEqual(["src/core/db.ts"]);
      expect(buckets.seam).toEqual(["freeholder.config.ts", "plugins/a/x.ts"]);
      expect(buckets.ignored).toEqual(["README.md"]);
    });
  });

  describe("planning a merge without overwriting owner code", () => {
    it("opens the lane when nothing conflicts", () => {
      const plan = planForkMerge([]);
      expect(plan.merges).toBe(true);
      expect(plan.refusal).toBeNull();
    });

    it("refuses outright when upstream fights a customization seam", () => {
      const plan = planForkMerge(["plugins/mine/index.ts", "src/core/update/apply.ts"]);
      expect(plan.merges).toBe(false);
      expect(plan.ownerConflicts.map((c) => c.path)).toEqual(["plugins/mine/index.ts"]);
      expect(plan.refusal).toContain("customization seam");
      expect(plan.refusal).toContain("your copy is the one that is meant to win");
    });

    it("sends core conflicts to the pull request rather than resolving them", () => {
      const plan = planForkMerge(["src/core/update/apply.ts", "app/page.tsx"]);
      expect(plan.merges).toBe(false);
      expect(plan.ownerConflicts).toEqual([]);
      expect(plan.refusal).toContain("2 core files conflict");
    });
  });

  describe("the worktree, which is never the running tree", () => {
    const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

    function recordingGit(responses: Record<string, GitResult>) {
      const calls: { args: string[]; cwd: string }[] = [];
      const git: GitRunner = async (args, cwd) => {
        calls.push({ args: [...args], cwd });
        for (const [key, result] of Object.entries(responses)) {
          if (args.join(" ").startsWith(key)) return result;
        }
        return ok();
      };
      return { git, calls };
    }

    it("refuses a remote or ref it will not hand to git", () => {
      expect(isSafeRemote("https://github.com/CampDenman/freeholder.git")).toBe(true);
      expect(isSafeRemote("git@github.com:CampDenman/freeholder.git")).toBe(false);
      expect(isSafeRef("main")).toBe(true);
      expect(isSafeRef("--upload-pack=evil")).toBe(false);
      expect(isSafeRef("a/../b")).toBe(false);
      expect(isSafeRef("; rm -rf /")).toBe(false);
    });

    it("reports a non-checkout as the image lane rather than failing", async () => {
      const { git } = recordingGit({});
      const attempt = await attemptUpstreamMerge({
        root: "/definitely/not/a/repo",
        upstreamRemote: "https://github.com/CampDenman/freeholder.git",
        upstreamRef: "main",
        git,
      });
      expect(attempt.available).toBe(false);
      expect(attempt.reason).toContain("not a git checkout");
    });

    it("rejects an unsafe ref before spawning anything", async () => {
      const { git, calls } = recordingGit({});
      const attempt = await attemptUpstreamMerge({
        root: process.cwd(),
        upstreamRemote: "https://github.com/CampDenman/freeholder.git",
        upstreamRef: "--upload-pack=evil",
        git,
      });
      expect(attempt.available).toBe(false);
      expect(calls).toEqual([]);
    });

    it("aborts and removes the worktree even when the merge conflicts", async () => {
      const { git, calls } = recordingGit({
        "rev-list": ok("3\t14\n"),
        "merge-base": ok("abc123\n"),
        "diff --name-only abc123": ok("src/core/update/apply.ts\n"),
        "merge --no-commit": { code: 1, stdout: "", stderr: "CONFLICT" },
        "diff --name-only --diff-filter=U": ok("src/core/update/apply.ts\n"),
      });
      const attempt = await attemptUpstreamMerge({
        root: process.cwd(),
        upstreamRemote: "https://github.com/CampDenman/freeholder.git",
        upstreamRef: "main",
        git,
      });
      expect(attempt.available).toBe(true);
      expect(attempt.ahead).toBe(3);
      expect(attempt.behind).toBe(14);
      expect(attempt.conflictPaths).toEqual(["src/core/update/apply.ts"]);

      const joined = calls.map((call) => call.args.join(" "));
      expect(joined.some((args) => args.startsWith("merge --abort"))).toBe(true);
      expect(joined.some((args) => args.startsWith("worktree remove --force"))).toBe(true);
      // The merge ran in the worktree, never in the root that serves traffic.
      const merge = calls.find((call) => call.args[0] === "merge" && call.args[1] === "--no-commit");
      expect(merge?.cwd).not.toBe(process.cwd());
      // Nothing was ever committed or pushed from here.
      expect(joined.some((args) => args.startsWith("commit") || args.startsWith("push"))).toBe(false);
    });

    it("parses git's own counting and name-only output", () => {
      expect(parseAheadBehind("3\t14\n")).toEqual({ ahead: 3, behind: 14 });
      expect(parseAheadBehind("garbage")).toBeNull();
      expect(parseNameOnly("b.ts\na.ts\na.ts\n")).toEqual(["a.ts", "b.ts"]);
    });
  });
});
