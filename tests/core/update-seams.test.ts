// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashCoreTree, inspectCoreFiles, parseGitPorcelain } from "@/core/update/integrity";
import { classifyPath, CUSTOMIZATION_SEAMS, isUnsupportedCoreEdit } from "@/core/update/seams";
import { inspectSeams } from "@/core/update/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("customization seams (C10.01)", () => {
  it("names the four owner seams and treats live core edits as unsupported", () => {
    expect(CUSTOMIZATION_SEAMS.map((seam) => seam.id)).toEqual([
      "database",
      "plugins",
      "configuration",
      "uploads",
    ]);
    expect(classifyPath("src/core/service.ts")).toBe("core");
    expect(classifyPath("app/(admin)/admin/layout.tsx")).toBe("core");
    expect(classifyPath("plugins/gift-registry/service.ts")).toBe("seam");
    expect(classifyPath("freeholder.config.ts")).toBe("seam");
    expect(classifyPath(".env")).toBe("seam");
    expect(classifyPath(".data/media/photo.jpg")).toBe("ignored");
    expect(classifyPath("node_modules/next/index.js")).toBe("ignored");
    expect(isUnsupportedCoreEdit("src/core/env.ts")).toBe(true);
    expect(isUnsupportedCoreEdit("plugins/mine/index.ts")).toBe(false);
  });

  it("hashes only core files and detects a live edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-seams-"));
    await mkdir(join(root, "src", "core"), { recursive: true });
    await mkdir(join(root, "plugins", "mine"), { recursive: true });
    await writeFile(join(root, "src", "core", "service.ts"), "export {}\n");
    await writeFile(join(root, "freeholder.config.ts"), "export default {}\n");
    await writeFile(join(root, "plugins", "mine", "index.ts"), "export {}\n");
    const digest = await hashCoreTree(root);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const again = await hashCoreTree(root);
    expect(again).toBe(digest);
    await writeFile(join(root, "plugins", "mine", "index.ts"), "export const n = 1\n");
    expect(await hashCoreTree(root)).toBe(digest);
    await writeFile(join(root, "src", "core", "service.ts"), "export const edited = true\n");
    expect(await hashCoreTree(root)).not.toBe(digest);
    const inspection = await inspectCoreFiles({
      root,
      expectedDigest: digest,
      modified: ["src/core/service.ts", "plugins/mine/index.ts"],
    });
    expect(inspection.matches).toBe(false);
    expect(inspection.supported).toBe(false);
    expect(inspection.modified).toEqual(["src/core/service.ts"]);
  });

  it("reads git porcelain only for core paths", () => {
    expect(
      parseGitPorcelain(" M src/core/env.ts\n M plugins/mine/index.ts\n?? .env\n"),
    ).toEqual(["src/core/env.ts"]);
  });
});

describe.runIf(hasDatabase)("platform.inspectSeams (C10.01)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("reports the four seams and refuses anonymous callers", async () => {
    const report = await inspectSeams.call({}, OWNER);
    expect(report.seams.map((seam) => seam.id)).toEqual([
      "database",
      "plugins",
      "configuration",
      "uploads",
    ]);
    expect(report.seams.every((seam) => seam.status === "ok" || seam.status === "warn")).toBe(true);
    expect(report.core.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const denied = await failure(inspectSeams.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
  });
});
