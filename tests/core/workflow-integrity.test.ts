// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  inspectProtectedFanIn,
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

describe("protected fan-in check", () => {
  const fanIn = (body: string) => `jobs:
  application:
    name: Application gates
  tests:
    name: Tests
  release-gate:
${body}
`;

  it("rejects a checks job that skips when a dependency fails", () => {
    expect(
      inspectProtectedFanIn(fanIn(`    name: checks
    needs: [application, tests]
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`), ".github/workflows/ci.yml"),
    ).toEqual(expect.arrayContaining([
      expect.stringContaining("if: always()"),
      expect.stringContaining("fail unless every needed job result is success"),
    ]));
  });

  it("accepts a fail-closed checks fan-in", () => {
    expect(
      inspectProtectedFanIn(fanIn(`    name: checks
    if: \${{ always() }}
    needs: [application, tests]
    runs-on: ubuntu-latest
    steps:
      - env:
          NEEDS: \${{ toJSON(needs) }}
        run: |
          echo "$NEEDS" | jq -e 'all(.[]; .result == "success")'
`), ".github/workflows/ci.yml"),
    ).toEqual([]);
  });
});

describe("browser runtime and diagnostic artifact boundaries", () => {
  type Step = { run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    jobs: {
      application: { steps: Step[] };
      browser: { needs: string; "timeout-minutes": number; strategy: { matrix: { shard: string[] } }; steps: Step[] };
    };
  };
  const application = workflow.jobs.application;
  const browser = workflow.jobs.browser;

  it("runs every shard against this run's checked build within the existing deadline", () => {
    expect(browser.needs).toBe("application");
    expect(browser["timeout-minutes"]).toBe(30);
    expect(browser.strategy.matrix.shard).toEqual(["1/3", "2/3", "3/3"]);
    expect(browser.steps.some((step: { run?: string }) => step.run?.includes("pnpm build"))).toBe(false);
    const upload = application.steps.find(step => step.with?.name === "browser-runtime");
    const download = browser.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/download-artifact@"));
    expect(upload?.with?.name).toBe("browser-runtime");
    expect(download?.with?.name).toBe(upload?.with?.name);
    expect(download?.with).not.toHaveProperty("run-id");
    expect(download?.with).not.toHaveProperty("repository");
    expect(application.steps.some((step: { run?: string }) => step.run === "pnpm artifact:check")).toBe(true);
    expect(browser.steps.some((step: { run?: string }) => step.run?.includes("sha256sum -c browser-runtime.tar.sha256") && step.run.includes("node scripts/standalone-artifact-gate.mjs"))).toBe(true);
    const pack = application.steps.find((step: { run?: string }) => step.run?.includes("tar -cf"));
    expect(pack?.run?.split("\n")[0]).toBe('tar -cf "$RUNNER_TEMP/browser-runtime.tar" .next/standalone .next/static .next/BUILD_ID');
    expect(browser.steps.some((step: { run?: string }) => step.run === "pnpm test:browser --shard=${{ matrix.shard }}")).toBe(true);
  });

  it("uploads only the explicit sanitized failure report, including failed attempts before a successful retry", () => {
    const uploads = browser.steps.filter((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.if).toBe("${{ always() }}");
    expect(uploads[0]?.with?.path).toBe("test-results/browser/**/group-message-allowlisted.json");
    expect(uploads[0]?.with?.["if-no-files-found"]).toBe("ignore");
  });
});
