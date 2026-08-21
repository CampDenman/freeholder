// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The builder's code lane (C4.20, MASTER.md §37).
//
// §37: "the instance does not compile code on the box that serves traffic, and
// a droplet is not a build server." So the thing under test is not a sandbox.
// It is a set of gates written in trusted code, standing between a model's
// output and an owner's repository, and a delivery path that runs nothing.
import { describe, expect, it } from "vitest";
import { describeProposal, runCodeGates } from "@/modules/builder/code-gates";
import { toPatch } from "@/modules/builder/code-delivery";

const HEADER = `// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
`;

/** A plugin that passes everything, as the baseline each case deviates from. */
function goodPlugin(name = "tide-times") {
  return [
    {
      path: `plugins/${name}/manifest.ts`,
      contents: `${HEADER}import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  kind: "plugin",
  name: "${name}",
  version: "0.1.0",
  freeholder: "^1.0.0",
  license: "Apache-2.0",
  permissions: ["cms:view"],
  migrations: [],
  capabilities: { blocks: true },
});
`,
    },
    {
      path: `plugins/${name}/block.tsx`,
      contents: `${HEADER}export function TideTimes() {
  return null;
}
`,
    },
  ];
}

describe("code-lane gates", () => {
  it("passes a plugin that stays inside its own directory", () => {
    const report = runCodeGates(goodPlugin(), "tide-times");
    expect(report.passed).toBe(true);
    expect(report.results.every((gate) => gate.passed)).toBe(true);
  });

  it("refuses anything written outside the plugin's own directory", () => {
    // The isolation that matters: whatever the model was asked to do, and
    // whatever ended up in its context, it cannot reach core.
    for (const stray of [
      "src/core/service.ts",
      "plugins/tide-times/../../src/core/db.ts",
      "/etc/passwd",
      ".github/workflows/deploy.yml",
      "package.json",
    ]) {
      const report = runCodeGates(
        [...goodPlugin(), { path: stray, contents: `${HEADER}export const x = 1;\n` }],
        "tide-times",
      );
      expect(report.passed).toBe(false);
      expect(report.refusal).toContain("must live under");
    }
  });

  it("refuses a plugin the platform could not load", () => {
    const noManifest = runCodeGates(
      [{ path: "plugins/tide-times/block.tsx", contents: `${HEADER}export const a = 1;\n` }],
      "tide-times",
    );
    expect(noManifest.passed).toBe(false);
    expect(noManifest.refusal).toContain("manifest.ts");

    const files = goodPlugin();
    files[0]!.contents = files[0]!.contents.replace('freeholder: "^1.0.0",', "");
    const noRange = runCodeGates(files, "tide-times");
    expect(noRange.passed).toBe(false);
    // An update should be able to refuse an incompatible plugin rather than
    // breaking on boot.
    expect(noRange.refusal).toContain("which Freeholder versions");
  });

  it("refuses a permission Freeholder cannot grant", () => {
    const files = goodPlugin();
    files[0]!.contents = files[0]!.contents.replace(
      'permissions: ["cms:view"]',
      'permissions: ["cms:view", "everything:always"]',
    );
    const report = runCodeGates(files, "tide-times");
    expect(report.passed).toBe(false);
    expect(report.refusal).toContain("everything:always");
  });

  it("refuses a credential without repeating it", () => {
    const files = [
      ...goodPlugin(),
      {
        path: "plugins/tide-times/client.ts",
        contents: `${HEADER}const key = "sk-abcdefghijklmnopqrstuvwxyz012345";\n`,
      },
    ];
    const report = runCodeGates(files, "tide-times");
    expect(report.passed).toBe(false);
    expect(report.refusal).toContain("client.ts");
    // Says where and what kind; never the value.
    expect(report.refusal).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });

  it("refuses a plugin that reaches outside the contract", () => {
    for (const line of [
      `import { exec } from "node:child_process";`,
      `import fs from "node:fs";`,
      `const run = eval("1 + 1");`,
      `const f = new Function("return 1");`,
    ]) {
      const report = runCodeGates(
        [...goodPlugin(), { path: "plugins/tide-times/run.ts", contents: `${HEADER}${line}\n` }],
        "tide-times",
      );
      expect(report.passed).toBe(false);
      expect(report.refusal).toContain("runs inside Freeholder");
    }
  });

  it("refuses a migration that cannot be undone in one step", () => {
    const report = runCodeGates(
      [
        ...goodPlugin(),
        {
          path: "plugins/tide-times/migrations/0001_init.sql",
          contents: "DROP TABLE contacts;\n",
        },
      ],
      "tide-times",
    );
    expect(report.passed).toBe(false);
    // §37: "If a change cannot be undone in one step, the builder refuses it
    // and says why — destructive migrations included."
    expect(report.refusal).toContain("forward-only");
  });

  it("refuses a source file with no licence header", () => {
    const report = runCodeGates(
      [...goodPlugin(), { path: "plugins/tide-times/util.ts", contents: "export const a = 1;\n" }],
      "tide-times",
    );
    expect(report.passed).toBe(false);
    expect(report.refusal).toContain("SPDX");
  });

  it("refuses a proposal too large for anybody to read before merging", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      path: `plugins/tide-times/file-${index}.ts`,
      contents: `${HEADER}export const a = ${index};\n`,
    }));
    const report = runCodeGates([...goodPlugin(), ...many], "tide-times");
    expect(report.passed).toBe(false);
    expect(report.refusal).toContain("reviewable");
  });

  it("reports every gate rather than stopping at the first", () => {
    const report = runCodeGates(
      [{ path: "src/core/boom.ts", contents: "export const a = 1;\n" }],
      "Tide Times",
    );
    // An owner who fixes one refusal and immediately meets another learns the
    // process is adversarial; the whole list at once is what makes it a review.
    const failed = report.results.filter((gate) => !gate.passed).map((gate) => gate.gate);
    expect(failed).toEqual(expect.arrayContaining(["name", "paths", "manifest", "licence"]));
  });

  it("describes a proposal by shape and by what it asks to be allowed", () => {
    const described = describeProposal(goodPlugin(), "tide-times");
    expect(described.files.map((file) => file.path)).toEqual([
      "plugins/tide-times/manifest.ts",
      "plugins/tide-times/block.tsx",
    ]);
    // The permissions are the part an owner most needs before merging.
    expect(described.permissions).toEqual(["cms:view"]);
    expect(described.totalAddedLines).toBeGreaterThan(0);
  });
});

describe("handing a proposal over", () => {
  it("writes a patch that reads as pure additions", () => {
    const patch = toPatch([
      { path: "plugins/tide-times/a.ts", contents: "one\ntwo\n" },
    ]);
    expect(patch).toContain("diff --git a/plugins/tide-times/a.ts b/plugins/tide-times/a.ts");
    expect(patch).toContain("new file mode 100644");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("@@ -0,0 +1,2 @@");
    expect(patch).toContain("+one");
    expect(patch).toContain("+two");
  });

  it("says so when a file has no trailing newline", () => {
    // The difference between a patch that applies and one that complains.
    const patch = toPatch([{ path: "plugins/x/a.ts", contents: "one" }]);
    expect(patch).toContain("\\ No newline at end of file");
  });

  it("carries every file in one patch", () => {
    const patch = toPatch(goodPlugin());
    expect(patch.match(/diff --git/g)).toHaveLength(2);
  });
});
