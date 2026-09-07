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
  inspectProjectEnv,
  missingEnv,
  parseArguments,
  parseEnvFile,
  prepareGeneratedProject,
  recoverFromMissing,
  setupUrlFromEnv,
  type CommandSpec,
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
        "--install",
        "--migrate",
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
      install: true,
      migrate: true,
    });
  });

  it("parses environment file values and names the setup URL", () => {
    const env = parseEnvFile(
      '# comment\nexport DATABASE_URL="postgres://postgres:postgres@localhost:5432/freeholder_dev"\nSESSION_SECRET=\nAPP_URL=https://studio.example/\n',
    );
    expect(env.DATABASE_URL).toMatch(/^postgres:/);
    expect(env.SESSION_SECRET).toBe("");
    expect(setupUrlFromEnv(env)).toBe("https://studio.example/setup");
    expect(setupUrlFromEnv({ APP_URL: "https://studio.example///" })).toBe(
      "https://studio.example/setup",
    );
    expect(setupUrlFromEnv({})).toBe("http://localhost:3000/setup");
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

  it("names missing environment, recovery, and the setup URL after scaffolding", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-env-"));
    dirs.push(root);
    const inspection = await inspectProjectEnv(root, "local");
    expect(inspection.envPath).toBeNull();
    expect(inspection.complete).toBe(false);
    expect(inspection.readyToMigrate).toBe(false);
    expect(inspection.missing).toEqual(["DATABASE_URL", "SESSION_SECRET", "CREDENTIAL_KEY", "APP_URL"]);
    expect(inspection.recovery[0]).toMatch(/Copy \.env\.example/);
    expect(inspection.setupUrl).toBe("http://localhost:3000/setup");
  });

  it("treats a short session secret as missing and requires storage keys on s3 targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-short-"));
    dirs.push(root);
    await writeFile(
      join(root, ".env"),
      [
        "DATABASE_URL=postgres://postgres:postgres@localhost:5432/freeholder_dev",
        "SESSION_SECRET=tooshort",
        "CREDENTIAL_KEY=0123456789abcdef0123456789abcdef",
        "APP_URL=http://localhost:3000",
      ].join("\n"),
    );
    const local = await inspectProjectEnv(root, "local");
    expect(local.missing).toEqual(["SESSION_SECRET"]);
    expect(local.readyToMigrate).toBe(true);
    const railway = await inspectProjectEnv(root, "railway");
    expect(railway.missing).toEqual(expect.arrayContaining(["SESSION_SECRET", "S3_BUCKET"]));
    expect(recoverFromMissing(["S3_BUCKET"])[0]).toMatch(/object storage/);
  });

  it("installs, migrates, and reports a reachable setup URL when the environment is ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-prepare-"));
    dirs.push(root);
    await writeFile(
      join(root, ".env"),
      [
        "DATABASE_URL=postgres://postgres:postgres@localhost:5432/freeholder_dev",
        "SESSION_SECRET=deterministic-session-secret-key-32+",
        "CREDENTIAL_KEY=0123456789abcdef0123456789abcdef",
        "APP_URL=https://studio.example",
      ].join("\n"),
    );
    const calls: CommandSpec[] = [];
    const lines = await prepareGeneratedProject(root, {
      install: true,
      migrate: true,
      target: "local",
      runner: async (spec) => {
        calls.push(spec);
      },
      probeSetup: async (url) => {
        expect(url).toBe("https://studio.example/setup");
        return { ok: true };
      },
    });
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["install", "--frozen-lockfile"]));
    expect(calls[1]?.args).toEqual(expect.arrayContaining(["db:migrate"]));
    expect(calls[0]?.cwd).toBe(root);
    expect(calls[1]?.env.DATABASE_URL).toMatch(/^postgres:/);
    expect(lines.join("\n")).toMatch(/Environment looks complete/);
    expect(lines.join("\n")).toMatch(/Dependencies installed/);
    expect(lines.join("\n")).toMatch(/Migrations applied/);
    expect(lines.join("\n")).toMatch(/Setup is reachable at https:\/\/studio\.example\/setup/);
  });

  it("refuses migrate without DATABASE_URL and tells the operator how to recover", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-fh-nomigrate-"));
    dirs.push(root);
    await expect(
      prepareGeneratedProject(root, {
        migrate: true,
        probe: false,
        runner: async () => {
          throw new Error("runner must not run when migrate is refused");
        },
      }),
    ).rejects.toThrow(/Cannot migrate until DATABASE_URL is set/);
    const lines = await prepareGeneratedProject(root, {
      install: false,
      migrate: false,
      probeSetup: async () => ({ ok: false }),
    });
    expect(lines.join("\n")).toMatch(/No \.env yet/);
    expect(lines.join("\n")).toMatch(/Skipped dependency install/);
    expect(lines.join("\n")).toMatch(/Skipped migrations/);
    expect(lines.join("\n")).toMatch(/Could not reach http:\/\/localhost:3000\/setup yet/);
    expect(lines.join("\n")).toMatch(/pnpm dev/);
  });
});
