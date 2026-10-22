// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Getting a code proposal out of the instance (MASTER.md §37, C4.20).
//
// §37: "Vocabulary changes arrive as a **plugin PR against the owner's own
// fork**, built by their CI, deployed by pinning a new image digest — the
// instance does not compile code on the box that serves traffic, and a droplet
// is not a build server."
//
// So there are exactly two ways out, and neither of them runs anything here:
//
//   - **A pull request**, when the owner has connected a repository. The
//     branch is the isolated worktree: the files exist there and nowhere near
//     the running tree, and the owner's CI is the preview environment.
//   - **A patch**, when they have not. A proposal must not be trapped inside
//     an instance because a token is missing, and an owner who applies it by
//     hand has the same review the PR would have given them.
//
// Both paths hand over the same bytes. Neither writes to this filesystem.
import { github as rawGithub, githubJson, repositoryTarget } from "@/adapters/git/github";
import { ServiceError } from "@/core/service";
import type { ProposedFile } from "./code-gates";

export type { RepositoryTarget as DeliveryTarget } from "@/adapters/git/github";

/** Where a proposal would go, or why it cannot go anywhere yet. */
export const deliveryTarget = repositoryTarget;

const github = githubJson;

/**
 * A patch an owner can read, and apply with `git apply`.
 *
 * Every file is new, so every hunk is a pure addition. Writing it by hand
 * rather than shelling out to `git` keeps the promise this module makes: no
 * process is started and no file is written on the machine serving traffic.
 */
export function toPatch(files: readonly ProposedFile[]): string {
  const parts: string[] = [];
  for (const file of files) {
    const lines = file.contents.split("\n");
    // A trailing newline is the difference between a patch that applies and
    // one that complains, so it is stated explicitly either way.
    const endsWithNewline = file.contents.endsWith("\n");
    const body = endsWithNewline ? lines.slice(0, -1) : lines;
    parts.push(
      `diff --git a/${file.path} b/${file.path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${file.path}`,
      `@@ -0,0 +1,${body.length} @@`,
      ...body.map((line) => `+${line}`),
      ...(endsWithNewline ? [] : ["\\ No newline at end of file"]),
    );
  }
  return `${parts.join("\n")}\n`;
}

export interface OpenedPullRequest {
  url: string;
  branch: string;
  number: number;
}

/**
 * Put the proposal on a branch in the owner's repository and open a PR.
 *
 * The branch is created from the base rather than from anything this instance
 * holds, so a proposal cannot carry along whatever else happens to be in a
 * working copy — there is no working copy. Files are written through the
 * contents API one at a time, which is slower than a tree commit and much
 * easier to read in the resulting PR.
 *
 * Retry-safe for one delivery: the caller names the branch (one per
 * proposal), an existing pull request from it is returned rather than opened
 * again, an existing branch is reused and an existing file is updated in
 * place. A delivery whose result could not be recorded therefore resumes
 * instead of opening a second pull request.
 */
export async function openPullRequest(input: {
  files: readonly ProposedFile[];
  pluginName: string;
  title: string;
  body: string;
  /** Deterministic per delivery; defaults to a fresh timestamped name. */
  branch?: string;
}): Promise<OpenedPullRequest> {
  const target = deliveryTarget();
  if (!target) {
    throw new ServiceError(
      "conflict",
      "No repository is connected. Export the proposal as a patch instead.",
    );
  }
  const branch = input.branch ?? `builder/${input.pluginName}-${Date.now().toString(36)}`;
  const owner = target.repository.split("/")[0]!;

  const opened = await github<Array<{ html_url: string; number: number }>>(
    `/repos/${target.repository}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    { method: "GET" },
  );
  if (opened[0]) return { url: opened[0].html_url, branch, number: opened[0].number };

  const base = await github<{ object: { sha: string } }>(
    `/repos/${target.repository}/git/ref/heads/${target.baseBranch}`,
    { method: "GET" },
  );
  // 422: the branch is already there from an attempt that stopped short.
  await rawGithub(`/repos/${target.repository}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
    allow: [422],
  });

  for (const file of input.files) {
    const path = `/repos/${target.repository}/contents/${encodeURI(file.path)}`;
    const existing = await rawGithub<{ sha?: string }>(
      `${path}?ref=${encodeURIComponent(branch)}`,
      { method: "GET", allow: [404] },
    );
    await github(path, {
      method: "PUT",
      body: {
        message: `builder: add ${file.path}`,
        content: Buffer.from(file.contents, "utf8").toString("base64"),
        branch,
        ...(existing.body?.sha ? { sha: existing.body.sha } : {}),
      },
    });
  }

  const pull = await github<{ html_url: string; number: number }>(
    `/repos/${target.repository}/pulls`,
    {
      method: "POST",
      body: {
        title: input.title,
        head: branch,
        base: target.baseBranch,
        body: input.body,
        // Never auto-merged, whatever the owner's branch protection allows.
        // §37: the builder proposes; the owner disposes.
        draft: false,
        maintainer_can_modify: true,
      },
    },
  );
  return { url: pull.html_url, branch, number: pull.number };
}
