// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The DCO contract, enforced from commit objects rather than a capped API.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM gate script, no type declarations
import { evaluateSignOffs } from "../../scripts/dco-check.mjs";

const OWNER = { authorName: "Tony Aly", authorEmail: "tony@example.test" };
const APPLIER = { committerName: "Tony Aly", committerEmail: "tony@example.test" };

function commit(over: Record<string, unknown> = {}) {
  return {
    sha: "a".repeat(40), parents: ["b".repeat(40)], subject: "do a thing",
    ...OWNER, ...APPLIER,
    message: "do a thing\n\nSigned-off-by: Tony Aly <tony@example.test>\n",
    ...over,
  };
}

describe("DCO sign-off evaluation", () => {
  it("accepts a signed commit", () => {
    expect(evaluateSignOffs([commit()])).toEqual([]);
  });

  it("rejects a commit with no trailer at all", () => {
    const failures = evaluateSignOffs([commit({ message: "do a thing\n" })]);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("no Signed-off-by");
  });

  it("accepts a sign-off matching the committer when the author differs", () => {
    // A cherry-pick keeps the original author; the person applying it attests.
    expect(evaluateSignOffs([commit({ authorEmail: "someone@example.test" })])).toEqual([]);
  });

  it("rejects a sign-off that matches neither author nor committer", () => {
    const failures = evaluateSignOffs([commit({
      message: "x\n\nSigned-off-by: Someone Else <nobody@example.test>\n",
    })]);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("matches neither author");
  });

  it("is case-insensitive about the identity, as git addresses are", () => {
    expect(evaluateSignOffs([commit({
      message: "x\n\nSigned-off-by: Tony Aly <TONY@Example.Test>\n",
    })])).toEqual([]);
  });

  it("exempts merge commits, which assert no authorship of their own", () => {
    expect(evaluateSignOffs([commit({
      parents: ["b".repeat(40), "c".repeat(40)], message: "Merge branch 'x'\n",
    })])).toEqual([]);
  });

  it("honours an individual remediation commit when the config allows it", () => {
    const unsigned = commit({ message: "wip\n" });
    const failures = evaluateSignOffs([unsigned], {
      allowRemediation: true,
      remediations: [{ sha: unsigned.sha, name: "Tony Aly", email: "tony@example.test" }],
    });
    expect(failures).toEqual([]);
  });

  it("ignores remediation entirely when the config does not allow it", () => {
    const unsigned = commit({ message: "wip\n" });
    const failures = evaluateSignOffs([unsigned], {
      allowRemediation: false,
      remediations: [{ sha: unsigned.sha, name: "Tony Aly", email: "tony@example.test" }],
    });
    expect(failures).toHaveLength(1);
  });

  it("refuses third-party remediation even when remediation is allowed", () => {
    // The DCO is an attestation about authorship. Nobody can make it for
    // somebody else, so a claimant who is not the author is not a remediation.
    const unsigned = commit({ message: "wip\n", authorEmail: "someone@example.test" });
    const failures = evaluateSignOffs([unsigned], {
      allowRemediation: true,
      remediations: [{ sha: unsigned.sha, name: "Tony Aly", email: "tony@example.test" }],
    });
    expect(failures).toHaveLength(1);
  });

  it("ignores a remediation naming a commit outside the range", () => {
    const unsigned = commit({ message: "wip\n" });
    const failures = evaluateSignOffs([unsigned], {
      allowRemediation: true,
      remediations: [{ sha: "f".repeat(40), name: "Tony Aly", email: "tony@example.test" }],
    });
    expect(failures).toHaveLength(1);
  });

  it("reports every unsigned commit, not just the first", () => {
    const failures = evaluateSignOffs([
      commit({ sha: "1".repeat(40), message: "a\n" }),
      commit({ sha: "2".repeat(40) }),
      commit({ sha: "3".repeat(40), message: "c\n" }),
    ]);
    expect(failures.map((f: { sha: string }) => f.sha)).toEqual(["1".repeat(40), "3".repeat(40)]);
  });
});
