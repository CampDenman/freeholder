// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which hosts a contributed code link may name (C1.33).
import { describe, expect, it } from "vitest";
import { codeLinkHosts, isAcceptedCodeLink } from "@/core/contribute/service";

const UPSTREAM = codeLinkHosts("");

describe("accepted code-link hosts (C1.33)", () => {
  it("accepts the upstream merge path with no configuration at all", () => {
    expect(isAcceptedCodeLink("https://github.com/CampDenman/freeholder/pull/1", UPSTREAM)).toBe(true);
    expect(isAcceptedCodeLink("https://www.github.com/CampDenman/freeholder/pull/1", UPSTREAM)).toBe(true);
    expect(isAcceptedCodeLink("https://GitHub.com/CampDenman/freeholder", UPSTREAM)).toBe(true);
  });

  it("refuses everything that is not on an accepted host", () => {
    expect(isAcceptedCodeLink("https://evil.test/CampDenman/freeholder", UPSTREAM)).toBe(false);
    // A look-alike suffix is a different host, however it reads.
    expect(isAcceptedCodeLink("https://github.com.evil.test/x", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("https://notgithub.com/x", UPSTREAM)).toBe(false);
    // Userinfo puts the real host after the @, which is the whole trick.
    expect(isAcceptedCodeLink("https://github.com@evil.test/x", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("https://user:pw@evil.test/x", UPSTREAM)).toBe(false);
    // Plaintext and non-http schemes stay refused.
    expect(isAcceptedCodeLink("http://github.com/x", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("javascript:alert(1)", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("data:text/html,x", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("not a url", UPSTREAM)).toBe(false);
    expect(isAcceptedCodeLink("", UPSTREAM)).toBe(false);
  });

  it("lets an instance cite the forge its code actually lives on", () => {
    const hosts = codeLinkHosts("forge.example.test");
    expect(isAcceptedCodeLink("https://forge.example.test/tony/freeholder/pulls/8", hosts)).toBe(true);
    // Adding a forge never removes the upstream path.
    expect(isAcceptedCodeLink("https://github.com/CampDenman/freeholder", hosts)).toBe(true);
    // And never widens past what was named.
    expect(isAcceptedCodeLink("https://other.example.test/x", hosts)).toBe(false);
    expect(isAcceptedCodeLink("https://sub.forge.example.test/x", hosts)).toBe(false);
  });

  it("reads a list the way an operator would write one", () => {
    const hosts = codeLinkHosts(" forge.example.test , Git.Example.Test ,, ");
    expect(hosts).toContain("forge.example.test");
    expect(hosts).toContain("git.example.test");
    expect(hosts).not.toContain("");
    expect(isAcceptedCodeLink("https://git.example.test/x", hosts)).toBe(true);
  });
});
