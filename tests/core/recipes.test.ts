// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Parse and inspect executable Tier-1 recipes; filenames and regex-only prose
// are not deployment evidence (C3.16, C3.17).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createRailwayContext, project as railwayProject } from "railway/iac";
import railwayProgram from "../../.railway/railway";
import { renderAppSpec } from "../../scripts/prepare-do-app-spec.mjs";
import { REQUIRED_RECIPE_FILES, RECIPE_OPERATIONS, TIER1_RECIPES } from "@/core/recipes";
import { MIGRATION_INVARIANTS, tier1Pairs } from "@/core/portability/archive";

const ROOT = process.cwd();
const DEPLOY = join(ROOT, "deploy");

type Recipe = {
  name: string;
  schema: string;
  tier: number;
  artifacts: string[];
  required_environment: string[];
  operations: Record<string, string>;
  update: { strategy: string; rollback: string };
};

function yaml(path: string): Record<string, unknown> {
  return parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function recipe(target: string): Recipe {
  return yaml(join(DEPLOY, target, "recipe.yaml")) as Recipe;
}

describe("Tier-1 recipe contracts (C3.16, C3.17)", () => {
  it.each(TIER1_RECIPES)("%s has parsed metadata, artifacts and executable operations", (target) => {
    for (const file of REQUIRED_RECIPE_FILES) {
      expect(existsSync(join(DEPLOY, target, file)), `${target}/${file}`).toBe(true);
    }
    const current = recipe(target);
    expect(current.name).toBe(target);
    expect(current.schema).toBe("freeholder-deploy-recipe/v1");
    expect(current.tier).toBe(1);
    expect(current.artifacts.length).toBeGreaterThan(0);
    for (const artifact of current.artifacts) {
      expect(existsSync(join(ROOT, artifact)), `${target} artifact ${artifact}`).toBe(true);
    }
    expect(current.required_environment).toEqual(expect.arrayContaining(["SESSION_SECRET", "CREDENTIAL_KEY"]));
    for (const operation of RECIPE_OPERATIONS) {
      const command = current.operations[operation];
      expect(typeof command, `${target}.${operation}`).toBe("string");
      expect(command!.trim().length, `${target}.${operation}`).toBeGreaterThan(10);
      expect(command, `${target}.${operation}`).not.toMatch(/todo|coming soon|example command/i);
    }
    expect(current.update.strategy).toBeTruthy();
    expect(current.update.rollback).toBeTruthy();
  });

  it("ships a runnable Replit workspace and Deployment contract", () => {
    const replit = readFileSync(join(ROOT, ".replit"), "utf8");
    const nix = readFileSync(join(ROOT, "replit.nix"), "utf8");
    expect(replit).toMatch(/\[deployment\]/);
    expect(replit).toMatch(/build\s*=/);
    expect(replit).toMatch(/run\s*=/);
    expect(nix).toContain("nodejs_22");
    expect(nix).toContain("postgresql_16");
  });

  it("ships a DigitalOcean app with managed Postgres, private DB binding, S3 and health checks", () => {
    const templatePath = join(DEPLOY, "digitalocean-app", "infra", "app.yaml");
    const spec = yaml(templatePath) as {
      services: Array<Record<string, unknown>>;
      databases: Array<Record<string, unknown>>;
    };
    const web = spec.services[0]!;
    const envs = web.envs as Array<{ key: string; value: string }>;
    expect(spec.databases[0]).toMatchObject({ engine: "PG", version: "16" });
    expect(web.health_check).toMatchObject({ http_path: "/api/health" });
    expect(web.liveness_health_check).toMatchObject({ http_path: "/api/health/live" });
    expect(envs).toContainEqual(expect.objectContaining({ key: "DATABASE_URL", value: "${freeholder-db.DATABASE_PRIVATE_URL}" }));
    expect(envs).toContainEqual(expect.objectContaining({ key: "FREEHOLDER_STORAGE", value: "s3" }));
    const rendered = renderAppSpec(readFileSync(templatePath, "utf8"), {
      SESSION_SECRET: "s".repeat(32),
      CREDENTIAL_KEY: "a".repeat(64),
      S3_BUCKET: "bucket",
      S3_ENDPOINT: "https://sfo3.digitaloceanspaces.com",
      S3_REGION: "sfo3",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(rendered).not.toContain("REPLACE_WITH_");
    expect(parse(rendered)).toMatchObject({ databases: [{ engine: "PG" }] });
    expect(() => renderAppSpec(readFileSync(templatePath, "utf8"), {
      SESSION_SECRET: "short",
      CREDENTIAL_KEY: "invalid",
      S3_BUCKET: "bucket",
      S3_ENDPOINT: "https://sfo3.digitaloceanspaces.com",
      S3_REGION: "sfo3",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
    })).toThrow(/SESSION_SECRET/);
  });

  it("ships healthy restartable Compose services and never loads the example env", () => {
    for (const target of ["docker-selfhost", "digitalocean-droplet"] as const) {
      const compose = yaml(join(DEPLOY, target, "infra", "compose.yml")) as {
        services: Record<string, Record<string, unknown>>;
      };
      expect(compose.services.app!.restart).toBe("unless-stopped");
      expect(compose.services.app!.env_file).not.toContain(".env.example");
      expect(compose.services.db!.healthcheck).toBeTruthy();
      const current = recipe(target);
      expect(current.required_environment).toContain("POSTGRES_PASSWORD");
      const databaseUrl = (compose.services.app!.environment as Record<string, string>).DATABASE_URL;
      expect(databaseUrl).toContain("${POSTGRES_PASSWORD:?");
      expect(databaseUrl).not.toContain("freeholder:freeholder");
    }
  });

  it("ships Railway IaC with Postgres, a bucket, image, secrets and health", async () => {
    const source = readFileSync(join(ROOT, ".railway", "railway.ts"), "utf8");
    for (const token of ["postgres(", "bucket(", "image(", "preserve()", 'healthcheck: "/api/health"']) {
      expect(source).toContain(token);
    }
    const definition = await railwayProgram(
      createRailwayContext({ environment: "production" }),
      railwayProject,
    );
    const resources = definition.resources as Array<{
      type: string;
      source?: { type: string; image?: string };
      deploy?: { healthcheckPath?: string };
    }>;
    expect(resources.map((resource) => resource.type)).toEqual([
      "database",
      "bucket",
      "service",
    ]);
    const web = resources.find((resource) => resource.type === "service");
    expect(web).toMatchObject({
      source: { type: "image", image: "ghcr.io/campdenman/freeholder:edge" },
      deploy: { healthcheckPath: "/api/health" },
    });
  });

  it("ships a Render Blueprint with image, private Postgres, S3 inputs and health", () => {
    const blueprint = yaml(join(ROOT, "render.yaml")) as {
      services: Array<Record<string, unknown>>;
      databases: Array<Record<string, unknown>>;
    };
    const web = blueprint.services[0]!;
    const envs = web.envVars as Array<{ key: string }>;
    expect(web).toMatchObject({ type: "web", runtime: "image", healthCheckPath: "/api/health" });
    expect(blueprint.databases[0]).toMatchObject({ postgresMajorVersion: "16", ipAllowList: [] });
    expect(envs.map(({ key }) => key)).toEqual(expect.arrayContaining(["DATABASE_URL", "FREEHOLDER_STORAGE", "S3_BUCKET", "S3_ENDPOINT"]));
  });

  it("documents every directed pair and every preservation invariant", () => {
    expect(tier1Pairs()).toHaveLength(30);
    const runbook = readFileSync(join(DEPLOY, "migration-runbook.md"), "utf8").toLowerCase();
    for (const invariant of MIGRATION_INVARIANTS) {
      expect(runbook).toContain(invariant);
    }
    for (const target of TIER1_RECIPES) {
      const migrate = readFileSync(join(DEPLOY, target, "migrate.md"), "utf8");
      expect(migrate).toContain("../migration-runbook.md");
      expect(migrate).toContain(`Target: \`${target}\``);
    }
  });

  it("runs the built image and canonical Doctor for every recipe in CI", () => {
    const matrix = readFileSync(join(ROOT, "scripts", "recipe-matrix.sh"), "utf8");
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    for (const target of TIER1_RECIPES) {
      expect(matrix).toContain(target);
    }
    expect(matrix).toContain("node scripts/doctor.mjs");
    expect(matrix).toContain("FREEHOLDER_STORAGE=s3");
    expect(workflow).toContain("bash scripts/recipe-matrix.sh");
    expect(workflow).toContain("minio/minio:");
  });
});
