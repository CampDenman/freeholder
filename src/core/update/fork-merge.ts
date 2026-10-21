// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The worktree half of the fork lane (MASTER.md §39.7, C10.09).
//
// §39.7 says "fetch upstream into a worktree, merge, report conflicts by file",
// and the word worktree is doing real work: the merge happens in a directory
// that is not the tree serving traffic, and it is aborted and removed whether
// it succeeded or not. Nothing here ever leaves a running instance in a
// half-merged state, because nothing here writes to the running instance at
// all. What survives is a report.
//
// Provider and process I/O never happens inside a service transaction, so the
// services that call this are orchestrated (§2, `defineOrchestratedService`).
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRelativePath } from "./seams";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

/**
 * Run git with no shell and no inherited stdin.
 *
 * `shell: false` is not decoration: an upstream ref is owner-supplied text, and
 * a ref named `; rm -rf /` must be a git error rather than a sentence the
 * platform hands to a shell.
 */
export const spawnGit: GitRunner = (args, cwd) =>
  new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** A ref this platform is willing to hand to git. */
export function isSafeRef(ref: string): boolean {
  return /^[A-Za-z0-9._\-/]{1,200}$/.test(ref) && !ref.includes("..") && !ref.startsWith("-");
}

export function isSafeRemote(remote: string): boolean {
  return /^https:\/\/[\w.-]+(?::\d+)?\/[\w./-]{1,200}$/.test(remote);
}

export function parseAheadBehind(output: string): { ahead: number; behind: number } | null {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

export function parseNameOnly(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => normalizeRelativePath(line)),
    ),
  ].sort();
}

export interface ForkMergeAttempt {
  /** False when this instance is not a git checkout, or git is unavailable. */
  available: boolean;
  reason: string | null;
  ahead: number;
  behind: number;
  /** Paths this fork changed relative to the merge base. Owner work. */
  divergedPaths: string[];
  /** Paths git could not merge. Empty means the merge is clean. */
  conflictPaths: string[];
}

const UNAVAILABLE = (reason: string): ForkMergeAttempt => ({
  available: false,
  reason,
  ahead: 0,
  behind: 0,
  divergedPaths: [],
  conflictPaths: [],
});

/**
 * Fetch upstream, merge it in a throwaway worktree, and report by file.
 *
 * The merge is `--no-commit --no-ff` and is always aborted: this function
 * answers "would this merge, and what would fight" and deliberately cannot
 * answer "please merge it". Landing the merge is the pull request's job, in
 * the owner's own fork, where their CI is the review.
 */
export async function attemptUpstreamMerge(input: {
  root: string;
  upstreamRemote: string;
  upstreamRef: string;
  git?: GitRunner;
}): Promise<ForkMergeAttempt> {
  const git = input.git ?? spawnGit;
  if (!isSafeRemote(input.upstreamRemote)) {
    return UNAVAILABLE("The upstream remote must be an https URL.");
  }
  if (!isSafeRef(input.upstreamRef)) {
    return UNAVAILABLE("The upstream ref is not a valid git ref name.");
  }
  const gitDir = await stat(join(input.root, ".git")).catch(() => null);
  if (!gitDir) {
    return UNAVAILABLE(
      "This instance is not a git checkout, so it is on the image lane rather than the fork lane.",
    );
  }

  const fetched = await git(
    ["fetch", "--no-tags", "--depth", "200", input.upstreamRemote, input.upstreamRef],
    input.root,
  );
  if (fetched.code !== 0) {
    return UNAVAILABLE(`Could not fetch upstream: ${fetched.stderr.trim() || "git fetch failed"}`);
  }

  const counts = await git(["rev-list", "--left-right", "--count", "HEAD...FETCH_HEAD"], input.root);
  const aheadBehind = counts.code === 0 ? parseAheadBehind(counts.stdout) : null;

  const base = await git(["merge-base", "HEAD", "FETCH_HEAD"], input.root);
  let divergedPaths: string[] = [];
  if (base.code === 0 && base.stdout.trim()) {
    const diverged = await git(
      ["diff", "--name-only", `${base.stdout.trim()}`, "HEAD"],
      input.root,
    );
    if (diverged.code === 0) divergedPaths = parseNameOnly(diverged.stdout);
  }

  let worktree: string | null = null;
  try {
    worktree = await mkdtemp(join(tmpdir(), "freeholder-fork-"));
    const added = await git(["worktree", "add", "--detach", worktree, "HEAD"], input.root);
    if (added.code !== 0) {
      return UNAVAILABLE(
        `Could not create a merge worktree: ${added.stderr.trim() || "git worktree add failed"}`,
      );
    }
    try {
      const merged = await git(["merge", "--no-commit", "--no-ff", "FETCH_HEAD"], worktree);
      let conflictPaths: string[] = [];
      if (merged.code !== 0) {
        const unmerged = await git(
          ["diff", "--name-only", "--diff-filter=U"],
          worktree,
        );
        conflictPaths = unmerged.code === 0 ? parseNameOnly(unmerged.stdout) : [];
        if (conflictPaths.length === 0) {
          return UNAVAILABLE(
            `The merge failed for a reason git did not report as a conflict: ${merged.stderr.trim() || "unknown"}`,
          );
        }
      }
      return {
        available: true,
        reason: null,
        ahead: aheadBehind?.ahead ?? 0,
        behind: aheadBehind?.behind ?? 0,
        divergedPaths,
        conflictPaths,
      };
    } finally {
      // Abort whether or not it conflicted: a clean --no-commit merge leaves a
      // staged tree behind, and this worktree is about to be deleted anyway.
      await git(["merge", "--abort"], worktree).catch(() => undefined);
    }
  } finally {
    if (worktree) {
      await git(["worktree", "remove", "--force", worktree], input.root).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
