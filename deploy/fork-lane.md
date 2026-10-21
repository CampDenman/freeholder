<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The fork lane

*MASTER.md §39.7, checklist item C10.09.*

Most instances update by swapping an image. An owner who has modified core
cannot: an image swap would throw their changes away. For them an update is a
**merge**, and this is how it works.

You are on the fork lane if this instance is a git checkout of your own
repository. You are on the image lane otherwise, and nothing here applies —
`freeholder doctor` says which one you are on under `update.fork`.

## What it does

1. **Fetches upstream** into a throwaway worktree in the system temp
   directory. Not the tree serving traffic. Never the tree serving traffic.
2. **Merges** with `--no-commit --no-ff`, then **aborts** — whether it
   succeeded or not. The question being asked is "would this merge, and what
   would fight", not "please merge it".
3. **Classifies every conflict** through the customization seams (§39.1):
   - a conflict in **core** goes to the pull request, where you resolve it;
   - a conflict in a **seam** — `plugins/`, `freeholder.config.ts`, `.env` —
     stops the lane. Upstream has reached into a file the contract says is
     yours, and resolving it automatically is exactly the overwrite this lane
     exists to prevent.
4. **Opens a pull request in your own fork**, if the merge is clean. GitHub
   performs the merge onto a fresh branch; your CI is the review. Nothing is
   ever pushed to your base branch, whatever your branch protection allows.

The running instance never holds push credentials for your code and never
writes a file outside the temp worktree. If step 4 cannot run — no repository
connected — steps 1 to 3 still tell you the truth.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FREEHOLDER_UPSTREAM_REMOTE` | `https://github.com/CampDenman/freeholder.git` | Upstream to merge from. Must be `https`. |
| `FREEHOLDER_UPSTREAM_REF` | `main` | The upstream branch. |
| `BUILDER_CODE_REPOSITORY` | — | `owner/repo`: where the pull request is opened. Shared with §37's builder lane. |
| `BUILDER_CODE_TOKEN` | — | A token that may open a pull request and needs no other authority. |
| `BUILDER_CODE_BASE_BRANCH` | `main` | Your fork's base branch. |

A ref is validated before it reaches git. `--upload-pack=…`, `a/../b` and
anything with a shell metacharacter are refused rather than passed along, and
git is spawned with `shell: false` and no terminal prompt.

## Drift, stated honestly

`platform.forkStatus` answers in security terms, not commit counts. "Fourteen
commits behind" tells you nothing about whether you are exposed:

```
2 security releases behind — CVSS 8.1; this fork carries 3 commits of its own
```

Channel filtering happens before the count, so an instance on the `security`
channel is not reported as behind because a feature release exists. A release
with no CVSS score is news, not exposure, and is never counted as a security
release. "Up to date with upstream" is only ever said when it is true of
security too — silence must not be indistinguishable from safety.

The same call reports which of your diverging files are **yours**
(`ownedByYou`) and which are **replaceable core** (`replaceableCore`), because
the second list is what will conflict on the next merge and the first list
never should.

## Services

| Service | Does |
|---|---|
| `platform.forkStatus` | Drift, missing releases, missing security releases, and which diverging files are yours. Read-only. |
| `platform.openForkUpdate` | Runs the worktree merge, then opens the pull request. Refuses rather than resolving a seam conflict. |

Both are orchestrated services: they cross a process and provider boundary, so
they hold no database transaction while doing it (§2).

## Honest limits

- **A clean local merge is not a passing build.** The worktree proves the
  trees combine; it does not run your tests. That is what the pull request and
  your CI are for.
- **A conflicted merge leaves the branch behind.** It is your starting point
  for resolving by hand, and deleting it would throw away the only thing the
  attempt produced.
- **Drift is only as fresh as the feed.** If update checks are off, or the
  feed cannot be verified, the lane still reports commit drift but will not
  claim you are up to date on security.
