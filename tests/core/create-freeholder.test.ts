// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFreeholder,
  missingEnv,
  recoverFromMissing,
} from "../../packages/create-freeholder/src/index";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("create-freeholder (C3.14)", () => {
  it("names missing environment and how to recover", () => {
    expect(missingEnv(["DATABASE_URL", "SESSION_SECRET"], {} as NodeJS.ProcessEnv)).toEqual([
      "DATABASE_URL",
      "SESSION_SECRET",
    ]);
    expect(recoverFromMissing(["DATABASE_URL"])[0]).toMatch(/Postgres/);
  });

  it("writes config, env example, setup URL and recipe pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-"));
    dirs.push(root);
    const lines = await createFreeholder(root, {
      name: "studio",
      target: "railway",
      demo: true,
      preset: "shop",
    });
    expect(lines.join("\n")).toMatch(/railway/);
    expect(await readFile(join(root, "README.md"), "utf8")).toMatch(/\/setup/);
    expect(await readFile(join(root, "freeholder.config.ts"), "utf8")).toMatch(/railway/);
    expect(await readFile(join(root, ".env.example"), "utf8")).toMatch(/FREEHOLDER_SEED_DEMO/);
  });
});
