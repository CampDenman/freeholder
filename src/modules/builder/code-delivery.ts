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
import { requestWithTimeout, providerJson } from "@/adapters/mail/http";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";
import type { ProposedFile } from "./code-gates";

export interface DeliveryTarget {
  /** `owner/repo`, the owner's own fork. */
  repository: string;
  baseBranch: string;
}

/** Where a proposal would go, or why it cannot go anywhere yet. */
export function deliveryTarget(): DeliveryTarget | null {
  const repository = env().BUILDER_CODE_REPOSITORY;
  const token = env().BUILDER_CODE_TOKEN;
  if (!repository || !token) return null;
  return { repository, baseBranch: env().BUILDER_CODE_BASE_BRANCH ?? "main" };
}

async function github<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const token = env().BUILDER_CODE_TOKEN;
  if (!token) {
    throw new ServiceError("conflict", "No repository is connected for code proposals.");
  }
  const response = await requestWithTimeout(
    globalThis.fetch,
    `https://api.github.com${path}`,
    {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  );
  return providerJson<T>(response, "GitHub");
}

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
 */
export async function openPullRequest(input: {
  files: readonly ProposedFile[];
  pluginName: string;
  title: string;
  body: string;
}): Promise<OpenedPullRequest> {
  const target = deliveryTarget();
  if (!target) {
    throw new ServiceError(
      "conflict",
      "No repository is connected. Export the proposal as a patch instead.",
    );
  }

  const base = await github<{ object: { sha: string } }>(
    `/repos/${target.repository}/git/ref/heads/${target.baseBranch}`,
    { method: "GET" },
  );
  // Named for the plugin and the moment, so two proposals for one plugin do
  // not collide and a stale branch is obvious.
  const branch = `builder/${input.pluginName}-${Date.now().toString(36)}`;
  await github(`/repos/${target.repository}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
  });

  for (const file of input.files) {
    await github(
      `/repos/${target.repository}/contents/${encodeURI(file.path)}`,
      {
        method: "PUT",
        body: {
          message: `builder: add ${file.path}`,
          content: Buffer.from(file.contents, "utf8").toString("base64"),
          branch,
        },
      },
    );
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
