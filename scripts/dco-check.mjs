// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Developer Certificate of Origin, checked with git instead of an API.
//
// The Probot DCO app cannot evaluate a pull request of more than 250 commits:
// GitHub's REST API caps the commit list there, and the app's GraphQL fallback
// does not complete, so it reports `failure` with "the complete pull request
// commit list could not be retrieved". That failure is indistinguishable from
// a genuinely missing sign-off while being the opposite of it, and it cannot
// be fixed from this repository.
//
// git has no such limit. This enforces the same contract, from the commit
// objects themselves:
//
//   - every non-merge commit in the range carries a `Signed-off-by:` trailer;
//   - that trailer's email matches the commit's author OR committer, because a
//     cherry-pick legitimately preserves an author while the person applying
//     it is the one attesting;
//   - merge commits are exempt, as they are under the app: a merge asserts no
//     authorship of its own.
//
// Individual remediation is honoured when .github/dco.yml allows it, which is
// the app's own mechanism for a commit that cannot be rebased — here, one
// whose sha is pinned as provenance in a deploy record, so rewriting it would
// invalidate the record the pin exists to protect.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIGN_OFF = /^Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;
const REMEDIATION =
  /^I,\s*(.+?)\s*<([^>]+)>\s*,\s*hereby add my Signed-off-by to this commit:\s*([0-9a-f]{40})\s*$/gim;

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim() ?? "unknown"}`);
  }
  return result.stdout;
}

function allowsIndividualRemediation(path = ".github/dco.yml") {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  // Deliberately not a YAML dependency: this gate must not grow a parser it
  // does not need. The only shape it honours is the documented one.
  const block = /allowRemediationCommits:\s*\n(?:\s*#.*\n)*\s*individual:\s*true\b/i;
  return block.test(text.replace(/\r\n/g, "\n"));
}

/** Pure, so the gate can be proved to fail as well as to pass. */
export function evaluateSignOffs(commits, { remediations = [], allowRemediation = false } = {}) {
  const remediated = new Set(
    allowRemediation
      ? remediations.flatMap(({ sha, name, email }) => {
          const target = commits.find((commit) => commit.sha === sha);
          if (!target) return [];
          // Individual remediation only: the attestation has to come from the
          // identity being remediated. Nobody can attest to another person's
          // authorship.
          const claimant = `${name}|${email}`.toLowerCase();
          const author = `${target.authorName}|${target.authorEmail}`.toLowerCase();
          return claimant === author ? [sha] : [];
        })
      : [],
  );
  const failures = [];
  for (const commit of commits) {
    if (commit.parents.length > 1) continue;
    if (remediated.has(commit.sha)) continue;
    const identities = [commit.authorEmail, commit.committerEmail]
      .filter(Boolean)
      .map((email) => email.toLowerCase());
    const signers = [...commit.message.matchAll(SIGN_OFF)].map((match) => match[2].trim().toLowerCase());
    if (signers.length === 0) {
      failures.push({ sha: commit.sha, reason: "no Signed-off-by trailer", subject: commit.subject });
      continue;
    }
    if (!signers.some((signer) => identities.includes(signer))) {
      failures.push({
        sha: commit.sha,
        reason: `Signed-off-by (${signers.join(", ")}) matches neither author (${commit.authorEmail}) nor committer (${commit.committerEmail})`,
        subject: commit.subject,
      });
    }
  }
  return failures;
}

// Record and unit separators, written as git's own %x escapes so the argv
// string stays plain ASCII — Node refuses an argument containing a raw NUL.
// They cannot occur in a commit message, so a body with blank lines, colons
// or a stray "Signed-off-by" inside a quoted block still parses.
const SEPARATOR = "\u001e";
const FIELD = "\u001f";

export function readCommits(range) {
  const format = ["%H", "%P", "%an", "%ae", "%cn", "%ce", "%s", "%B"].join("%x1f");
  const raw = git(["log", "--no-color", `--format=%x1e${format}`, range]);
  return raw
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, parents, authorName, authorEmail, committerName, committerEmail, subject, message] =
        chunk.split(FIELD);
      return {
        sha, parents: parents.trim() ? parents.trim().split(/\s+/) : [],
        authorName, authorEmail, committerName, committerEmail, subject,
        message: message ?? "",
      };
    });
}

function main() {
  const base = process.env.DCO_BASE_SHA;
  const head = process.env.DCO_HEAD_SHA ?? "HEAD";
  if (!base) {
    console.error("DCO_BASE_SHA is required; refusing to guess the range.");
    process.exit(1);
  }
  const mergeBase = git(["merge-base", base, head]).trim();
  const commits = readCommits(`${mergeBase}..${head}`);
  const allowRemediation = allowsIndividualRemediation();
  const remediations = commits.flatMap((commit) =>
    [...commit.message.matchAll(REMEDIATION)].map((match) => ({
      name: match[1].trim(), email: match[2].trim(), sha: match[3],
    })),
  );
  const failures = evaluateSignOffs(commits, { remediations, allowRemediation });
  const merges = commits.filter((commit) => commit.parents.length > 1).length;
  if (failures.length > 0) {
    console.error(`DCO: ${failures.length} of ${commits.length} commit(s) are not signed off.\n`);
    for (const failure of failures) {
      console.error(`  ${failure.sha}  ${failure.subject}`);
      console.error(`      ${failure.reason}`);
    }
    console.error(
      "\nSign off a commit with `git commit -s`, or rebase to add the trailer.\n" +
      "If a commit cannot be rebased — because its sha is pinned as provenance —\n" +
      "add a later commit, authored by the same identity, containing:\n" +
      "  I, <Name> <email>, hereby add my Signed-off-by to this commit: <40-char sha>\n" +
      (allowRemediation
        ? ""
        : "NOTE: remediation is currently disabled; .github/dco.yml must allow it.\n"),
    );
    process.exit(1);
  }
  console.log(
    `DCO: ${commits.length} commit(s) checked, ${merges} merge(s) exempt, all signed off ` +
    `(range ${mergeBase.slice(0, 12)}..${head.slice(0, 12)}).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
