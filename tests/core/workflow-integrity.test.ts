// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  inspectWorkflowDocument,
  inspectWorkflowSource,
} from "../../scripts/workflow-integrity-gate.mjs";

describe("workflow supply-chain integrity", () => {
  it("accepts local actions and immutable external revisions", () => {
    expect(
      inspectWorkflowSource(`steps:
  - uses: ./\.github/actions/setup-project
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
`),
    ).toEqual([]);
  });

  it("rejects mutable action refs, latest tool downloads and privileged PR triggers", () => {
    const errors = inspectWorkflowSource(`on:
  pull_request_target:
steps:
  - uses: actions/checkout@v7
with:
  version: latest
`);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pull_request_target"),
        expect.stringContaining("40-character commit SHA"),
        expect.stringContaining("must not use latest"),
      ]),
    );
  });

  it("requires immutable digests for job and service containers", () => {
    const digest = "a".repeat(64);
    expect(inspectWorkflowDocument(`jobs:
  tests:
    container: node:22@sha256:${digest}
    services:
      postgres:
        image: postgres:16@sha256:${digest}
`)).toEqual([]);
    expect(inspectWorkflowDocument(`jobs:
  tests:
    services:
      postgres:
        image: postgres:16
`)).toEqual([
      expect.stringContaining("service tests.postgres image must use an immutable sha256 digest"),
    ]);
  });

  it("refuses to persist checkout credentials into repository code", () => {
    const checkout = "actions/checkout@" + "a".repeat(40);
    expect(inspectWorkflowDocument(`jobs:
  checks:
    steps:
      - uses: ${checkout}
`)).toEqual([expect.stringContaining("persist-credentials: false")]);
    expect(inspectWorkflowDocument(`jobs:
  checks:
    steps:
      - uses: ${checkout}
        with:
          persist-credentials: false
`)).toEqual([]);
  });

  it("requires explicit secret-scan ranges for every required event", () => {
    const trufflehog = "trufflesecurity/trufflehog@" + "a".repeat(40);
    const workflow = (
      base: string,
      head: string,
      args = "--results=verified,unknown --fail-on-scan-errors",
    ) => `on:
  pull_request:
  merge_group:
  push:
jobs:
  security:
    steps:
      - uses: ${trufflehog}
        with:
          base: \${{ ${base} }}
          head: \${{ ${head} }}
          extra_args: ${args}
`;
    const base = "github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before";
    const head = "github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha";
    expect(inspectWorkflowDocument(workflow(base, head))).toEqual([]);
    expect(
      inspectWorkflowDocument(workflow("github.event.before", "github.sha", "--results=verified")),
    ).toEqual(expect.arrayContaining([
      expect.stringContaining("bind pull_request"),
      expect.stringContaining("bind merge_group"),
      expect.stringContaining("verified/unknown findings and scan errors"),
    ]));
  });
});
