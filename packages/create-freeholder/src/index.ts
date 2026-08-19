// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// npx create-freeholder (C3.14, MASTER.md §22).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TARGETS = [
  "local",
  "replit",
  "digitalocean-app",
  "digitalocean-droplet",
  "railway",
  "render",
  "docker-selfhost",
] as const;

const REQUIRED_ENV = ["DATABASE_URL", "SESSION_SECRET", "CREDENTIAL_KEY", "APP_URL"] as const;

export type CreateOptions = {
  name: string;
  target?: (typeof TARGETS)[number];
  demo?: boolean;
  preset?: "creator" | "service-business" | "shop" | "everything";
};

export function missingEnv(keys: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return keys.filter((key) => !env[key]);
}

export function recoverFromMissing(keys: string[]): string[] {
  return keys.map((key) => {
    if (key === "DATABASE_URL") return "Set DATABASE_URL to a Postgres connection string, then run npm run db:migrate.";
    if (key === "SESSION_SECRET") {
      return 'Set SESSION_SECRET to at least 32 random characters: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"';
    }
    if (key === "CREDENTIAL_KEY") return "Set CREDENTIAL_KEY to a 32-byte key so connected accounts can be encrypted.";
    if (key === "APP_URL") return "Set APP_URL to the public address visitors will use, including https://.";
    return `Set ${key} in .env.`;
  });
}

export async function createFreeholder(root: string, options: CreateOptions): Promise<string[]> {
  const target = options.target ?? "local";
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Choose one of ${TARGETS.join(", ")}.`);
  }
  await mkdir(root, { recursive: true });
  const preset = options.preset ?? "everything";
  const envExample = [
    "DATABASE_URL=",
    "SESSION_SECRET=",
    "CREDENTIAL_KEY=",
    "APP_URL=http://localhost:3000",
    options.demo ? "FREEHOLDER_SEED_DEMO=1" : "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(join(root, ".env.example"), `${envExample}\n`);
  await writeFile(
    join(root, "freeholder.config.ts"),
    `import { defineConfig } from "freeholder";\n\nexport default defineConfig({\n  target: ${JSON.stringify(target)},\n  preset: ${JSON.stringify(preset)},\n  locales: ["en"],\n  baseCurrency: "USD",\n  plugins: [],\n});\n`,
  );
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: options.name,
        private: true,
        scripts: {
          setup: "npm run db:migrate && echo Open /setup",
          "db:migrate": "echo Run migrations against DATABASE_URL",
          dev: "echo Start the Freeholder app",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "README.md"),
    `# ${options.name}\n\nTarget: ${target}\nPreset: ${preset}\nRecipe: deploy/${target}/\n\n1. Copy .env.example to .env and add Postgres plus SESSION_SECRET and CREDENTIAL_KEY.\n2. npm install && npm run db:migrate\n3. npm run dev and open /setup\n\nIf something is missing, run the recipe verify.md and doctor. Recovery steps are printed by create-freeholder when env is incomplete.\n`,
  );
  const missing = missingEnv(REQUIRED_ENV, process.env);
  return [
    `Created ${options.name} for ${target} (${preset}).`,
    "Add DATABASE_URL, SESSION_SECRET and CREDENTIAL_KEY to .env.",
    "Then migrate and open /setup.",
    options.demo ? "FREEHOLDER_SEED_DEMO=1 will load the demo business on first boot." : "",
    ...recoverFromMissing(missing),
  ].filter(Boolean);
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? "my-business";
  const target = (process.argv[3] as CreateOptions["target"]) ?? "local";
  const lines = await createFreeholder(name, {
    name,
    target,
    demo: process.argv.includes("--demo"),
  });
  for (const line of lines) console.log(line);
}

const invoked = process.argv[1]?.includes("create-freeholder");
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
