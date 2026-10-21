// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Getting a fork update out of the instance (MASTER.md §39.7, C10.09).
//
// §39.7: for a fork, `freeholder update` is "a merge rather than a swap …
// open a pull request **in their own fork** — the same lane §37's builder
// already uses for code changes." So this is that lane, pointed at upstream
// instead of at a generated plugin.
//
// The merge itself is done by GitHub, not here. That is deliberate: the local
// worktree in `fork-merge.ts` answers *whether* it merges and *what fights*,
// and the running instance never needs push credentials or a dirty tree to
// find that out. What lands on the branch is GitHub's own merge commit, which
// is the same object the owner would have got by merging it themselves.
import { github, githubJson, repositoryTarget } from "@/adapters/git/github";
import { ServiceError } from "@/core/service";
import { isSafeRef } from "./fork-merge";

export interface ForkPullRequest {
  url: string;
  branch: string;
  number: number;
  /** True when GitHub reported the merge as conflicting and no PR was opened. */
  conflicted: boolean;
}

const MERGE_CONFLICT = 409;
const NOTHING_TO_MERGE = 204;

/**
 * Branch from the fork's base, merge upstream into that branch, open a PR.
 *
 * Never the base branch itself. An update that could land on `main` without a
 * pull request is an update that can overwrite owner code while nobody is
 * looking, which is the one thing §39.7 exists to prevent.
 */
export async function openForkUpdatePullRequest(input: {
  upstreamRef: string;
  fromVersion: string;
  toVersion: string;
  summary: string;
  now?: Date;
}): Promise<ForkPullRequest> {
  const target = repositoryTarget();
  if (!target) {
    throw new ServiceError(
      "conflict",
      "No repository is connected, so there is nowhere to open a fork update. Connect one, or update by image instead.",
    );
  }
  if (!isSafeRef(input.upstreamRef)) {
    throw new ServiceError("validation", "The upstream ref is not a valid git ref name.");
  }

  const base = await githubJson<{ object: { sha: string } }>(
    `/repos/${target.repository}/git/ref/heads/${encodeURIComponent(target.baseBranch)}`,
    { method: "GET" },
  );

  // Named for the version and the moment, so two attempts at one release do
  // not collide and a stale branch is obvious.
  const stamp = (input.now ?? new Date()).getTime().toString(36);
  const branch = `freeholder-update/${input.toVersion}-${stamp}`;
  await githubJson(`/repos/${target.repository}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
  });

  const merge = await github<{ sha: string }>(`/repos/${target.repository}/merges`, {
    method: "POST",
    body: {
      base: branch,
      head: input.upstreamRef,
      commit_message: `Merge Freeholder ${input.toVersion} into ${target.baseBranch}`,
    },
    allow: [MERGE_CONFLICT, NOTHING_TO_MERGE],
  });

  if (merge.status === MERGE_CONFLICT) {
    // Leave the branch: it is the owner's starting point for resolving by hand,
    // and deleting it would throw away the only thing this attempt produced.
    return { url: "", branch, number: 0, conflicted: true };
  }

  const pull = await githubJson<{ html_url: string; number: number }>(
    `/repos/${target.repository}/pulls`,
    {
      method: "POST",
      body: {
        title: `Update Freeholder ${input.fromVersion} → ${input.toVersion}`,
        head: branch,
        base: target.baseBranch,
        body: input.summary,
        // Never auto-merged, whatever the owner's branch protection allows.
        // The fork lane proposes; the owner's CI and the owner dispose.
        draft: false,
        maintainer_can_modify: true,
      },
    },
  );
  return { url: pull.html_url, branch, number: pull.number, conflicted: false };
}
