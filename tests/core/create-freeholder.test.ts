// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COUNTRY_DEFAULTS as CLI_COUNTRY_DEFAULTS,
  createFreeholder,
  missingEnv,
  parseArguments,
  recoverFromMissing,
} from "../../packages/create-freeholder/src/index";
import { COUNTRY_DEFAULTS } from "@/core/settings/defaults";

const dirs: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  it("keeps independently published country defaults aligned with setup", () => {
    expect(CLI_COUNTRY_DEFAULTS).toEqual(COUNTRY_DEFAULTS);
  });

  it("parses explicit automation flags without positional ambiguity", () => {
    expect(
      parseArguments([
        "studio",
        "--non-interactive",
        "--target=railway",
        "--preset",
        "shop",
        "--country=GB",
        "--payments",
        "stripe",
        "--demo",
      ]),
    ).toEqual({
      directory: "studio",
      nonInteractive: true,
      help: false,
      demo: true,
      target: "railway",
      preset: "shop",
      country: "GB",
      payments: "stripe",
    });
  });

  it("writes a runnable source project, target config and walkthrough", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-"));
    dirs.push(root);
    const lines = await createFreeholder(root, {
      name: "studio",
      target: "digitalocean-app",
      demo: true,
      preset: "shop",
      country: "GB",
      payments: "stripe",
    });
    expect(lines.join("\n")).toMatch(/digitalocean-app/);
    expect(await readFile(join(root, "GETTING_STARTED.md"), "utf8")).toMatch(/\/setup/);
    expect(await readFile(join(root, "freeholder.config.ts"), "utf8")).toMatch(/GBP/);
    expect(await readFile(join(root, "freeholder.config.ts"), "utf8")).toMatch(/stripe/);
    expect(await readFile(join(root, ".env.example"), "utf8")).toMatch(/FREEHOLDER_SEED_DEMO=1/);
    expect(await readFile(join(root, ".env.example"), "utf8")).toMatch(/STRIPE_SECRET_KEY/);
    const manifest: unknown = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) {
      throw new Error("generated package.json must contain a scripts object");
    }
    expect(manifest.name).toBe("studio");
    expect(manifest.scripts.dev).toBe("next dev");
    expect(JSON.stringify(manifest.scripts)).not.toMatch(/\becho\b/i);
    await Promise.all([
      access(join(root, "app")),
      access(join(root, "db")),
      access(join(root, "src")),
      access(join(root, "infra", "app.yaml")),
      access(join(root, "instrumentation.node.ts")),
      access(join(root, ".gitignore")),
    ]);
    await expect(access(join(root, "next-env.d.ts"))).rejects.toThrow();
  });

  it("refuses a non-empty destination without modifying it", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-owned-"));
    dirs.push(root);
    const sentinel = join(root, "keep.txt");
    await writeFile(sentinel, "owner data\n");
    await expect(createFreeholder(root, { name: "studio" })).rejects.toThrow(/not empty/);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("owner data\n");
  });

  it("refuses symbolic links in an explicitly supplied source template", async () => {
    const parent = await mkdtemp(join(tmpdir(), "create-fh-link-"));
    dirs.push(parent);
    const template = join(parent, "template");
    await mkdir(template);
    await symlink(parent, join(template, "outside"), "junction");

    await expect(
      createFreeholder(join(parent, "project"), {
        name: "studio",
        templateRoot: template,
      }),
    ).rejects.toThrow(/symbolic link/);
    await expect(access(join(parent, "project"))).rejects.toThrow();
  });

  it("refuses to recursively scaffold a destination inside its template", async () => {
    const template = await mkdtemp(join(tmpdir(), "create-fh-recursive-"));
    dirs.push(template);
    await expect(
      createFreeholder(join(template, "project"), {
        name: "studio",
        templateRoot: template,
      }),
    ).rejects.toThrow(/cannot be inside/);
    expect(await readdir(template)).toEqual([]);
  });
});
