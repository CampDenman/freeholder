#!/usr/bin/env node
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// npx create-freeholder (C3.14, MASTER.md §22).
import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const TARGETS = [
  "local",
  "replit",
  "digitalocean-app",
  "digitalocean-droplet",
  "railway",
  "render",
  "docker-selfhost",
] as const;

export const PRESETS = ["creator", "service-business", "shop", "everything"] as const;
export const PAYMENT_CHOICES = ["stripe", "later"] as const;

export interface CountryDefault {
  code: string;
  currency: string;
  timezone: string;
  units: "metric" | "imperial";
  firstDayOfWeek: number;
  locales: readonly string[];
}

// Kept aligned with src/core/settings/defaults.ts by a contract test. The CLI
// is independently publishable, so it cannot import application source.
export const COUNTRY_DEFAULTS: readonly CountryDefault[] = [
  { code: "CA", currency: "CAD", timezone: "America/Toronto", units: "metric", firstDayOfWeek: 0, locales: ["en", "fr-CA"] },
  { code: "US", currency: "USD", timezone: "America/New_York", units: "imperial", firstDayOfWeek: 0, locales: ["en"] },
  { code: "GB", currency: "GBP", timezone: "Europe/London", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "IE", currency: "EUR", timezone: "Europe/Dublin", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "AU", currency: "AUD", timezone: "Australia/Sydney", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "NZ", currency: "NZD", timezone: "Pacific/Auckland", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "FR", currency: "EUR", timezone: "Europe/Paris", units: "metric", firstDayOfWeek: 1, locales: ["fr"] },
  { code: "DE", currency: "EUR", timezone: "Europe/Berlin", units: "metric", firstDayOfWeek: 1, locales: ["de"] },
  { code: "ES", currency: "EUR", timezone: "Europe/Madrid", units: "metric", firstDayOfWeek: 1, locales: ["es"] },
  { code: "IT", currency: "EUR", timezone: "Europe/Rome", units: "metric", firstDayOfWeek: 1, locales: ["it"] },
  { code: "NL", currency: "EUR", timezone: "Europe/Amsterdam", units: "metric", firstDayOfWeek: 1, locales: ["nl"] },
  { code: "PT", currency: "EUR", timezone: "Europe/Lisbon", units: "metric", firstDayOfWeek: 1, locales: ["pt"] },
  { code: "SE", currency: "SEK", timezone: "Europe/Stockholm", units: "metric", firstDayOfWeek: 1, locales: ["sv"] },
  { code: "NO", currency: "NOK", timezone: "Europe/Oslo", units: "metric", firstDayOfWeek: 1, locales: ["nb"] },
  { code: "DK", currency: "DKK", timezone: "Europe/Copenhagen", units: "metric", firstDayOfWeek: 1, locales: ["da"] },
  { code: "CH", currency: "CHF", timezone: "Europe/Zurich", units: "metric", firstDayOfWeek: 1, locales: ["de", "fr"] },
  { code: "MX", currency: "MXN", timezone: "America/Mexico_City", units: "metric", firstDayOfWeek: 0, locales: ["es"] },
  { code: "BR", currency: "BRL", timezone: "America/Sao_Paulo", units: "metric", firstDayOfWeek: 0, locales: ["pt"] },
  { code: "JP", currency: "JPY", timezone: "Asia/Tokyo", units: "metric", firstDayOfWeek: 0, locales: ["ja"] },
  { code: "SG", currency: "SGD", timezone: "Asia/Singapore", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "ZA", currency: "ZAR", timezone: "Africa/Johannesburg", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
];

export type CreateOptions = {
  name: string;
  target?: (typeof TARGETS)[number];
  demo?: boolean;
  preset?: (typeof PRESETS)[number];
  country?: string;
  payments?: (typeof PAYMENT_CHOICES)[number];
  templateRoot?: string;
};

interface TemplateManifest {
  schema: "freeholder-source-template/v1";
  platformVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
}

interface CliArguments {
  directory?: string;
  target?: CreateOptions["target"];
  preset?: CreateOptions["preset"];
  country?: string;
  payments?: CreateOptions["payments"];
  demo: boolean;
  nonInteractive: boolean;
  help: boolean;
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function missingEnv(
  keys: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return keys.filter((key) => !env[key]);
}

export function recoverFromMissing(keys: string[]): string[] {
  return keys.map((key) => {
    if (key === "DATABASE_URL") return "Set DATABASE_URL to a Postgres connection string, then run pnpm db:migrate.";
    if (key === "SESSION_SECRET") {
      return 'Set SESSION_SECRET to at least 32 random characters: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"';
    }
    if (key === "CREDENTIAL_KEY") return "Set CREDENTIAL_KEY to a 32-byte key so connected accounts can be encrypted.";
    if (key === "APP_URL") return "Set APP_URL to the public HTTPS address visitors will use.";
    return `Set ${key} in .env.`;
  });
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function filesBelow(
  root: string,
  current = root,
  include: (path: string) => boolean = () => true,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(current, entry.name);
      if (!include(path)) return [];
      if (entry.isSymbolicLink()) throw new Error(`Template contains a symbolic link: ${path}`);
      return entry.isDirectory()
        ? filesBelow(root, path, include)
        : [path.slice(root.length + 1).split(sep).join("/")];
    }),
  );
  return nested.flat();
}

interface ResolvedTemplate {
  root: string;
  manifest?: string;
  sourceTree?: boolean;
}

async function resolveTemplate(explicit?: string): Promise<ResolvedTemplate> {
  if (explicit) return { root: resolve(explicit), sourceTree: true };
  const moduleRoot = dirname(fileURLToPath(import.meta.url));
  const bundled = join(moduleRoot, "template");
  if (await exists(join(bundled, "package.json"))) {
    return { root: bundled, manifest: join(moduleRoot, "template-manifest.json") };
  }
  const developmentBundle = resolve(moduleRoot, "../dist/template");
  if (await exists(join(developmentBundle, "package.json"))) {
    return {
      root: developmentBundle,
      manifest: resolve(moduleRoot, "../dist/template-manifest.json"),
    };
  }
  const repository = resolve(moduleRoot, "../../..");
  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  if (manifest.name !== "freeholder") {
    throw new Error("The source template is missing. Reinstall create-freeholder and try again.");
  }
  return { root: repository, sourceTree: true };
}

const SOURCE_EXCLUDED_SEGMENTS = new Set([
  ".claude",
  ".codex",
  ".data",
  ".git",
  ".next",
  "dist",
  "node_modules",
  "test-results",
]);
const SOURCE_EXCLUDED_FILES = new Set([
  ".env",
  "HANDOFF.md",
  "next-env.d.ts",
  "RESTART_HANDOFF.md",
  "tsconfig.tsbuildinfo",
]);

function includeSourcePath(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  if (!pathFromRoot) return true;
  const parts = pathFromRoot.split(sep);
  return (
    !parts.some((part) => SOURCE_EXCLUDED_SEGMENTS.has(part)) &&
    !SOURCE_EXCLUDED_FILES.has(pathFromRoot)
  );
}

function containsPath(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`))
  );
}

async function verifyTemplate(
  root: string,
  manifestPath?: string,
  sourceTree = false,
): Promise<void> {
  if (!manifestPath) {
    await filesBelow(root, root, sourceTree ? (path) => includeSourcePath(root, path) : undefined);
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemplateManifest;
  if (manifest.schema !== "freeholder-source-template/v1") {
    throw new Error("The bundled source template uses an unsupported manifest schema.");
  }
  const actualFiles = (await filesBelow(root)).sort();
  const expectedFiles = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("The bundled source template does not match its integrity manifest.");
  }
  for (const entry of manifest.files) {
    if (isAbsolute(entry.path) || entry.path.includes("\\") || entry.path.split("/").includes("..")) {
      throw new Error(`Unsafe path in the source template manifest: ${entry.path}`);
    }
    const bytes = await readFile(join(root, ...entry.path.split("/")));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) {
      throw new Error(`Source template integrity check failed for ${entry.path}.`);
    }
  }
}

function countryDefault(code: string): CountryDefault {
  const normalized = code.trim().toUpperCase();
  const found = COUNTRY_DEFAULTS.find((entry) => entry.code === normalized);
  if (!found) {
    throw new Error(`Unsupported country "${code}". Choose one of ${COUNTRY_DEFAULTS.map((entry) => entry.code).join(", ")}.`);
  }
  return found;
}

async function assertDestinationAvailable(root: string): Promise<void> {
  if (!(await exists(root))) return;
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error(`Destination exists and is not a directory: ${root}`);
  if ((await readdir(root)).length > 0) throw new Error(`Destination is not empty: ${root}`);
}

function storageFor(target: CreateOptions["target"]): "local" | "replit" | "s3" {
  if (target === "local") return "local";
  if (target === "replit") return "replit";
  return "s3";
}

async function configureProject(
  root: string,
  options: Required<Omit<CreateOptions, "templateRoot">>,
): Promise<void> {
  const country = countryDefault(options.country);
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.name = options.name;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const packedGitignore = join(root, "gitignore.template");
  if (await exists(packedGitignore)) {
    await rename(packedGitignore, join(root, ".gitignore"));
  } else if (!(await exists(join(root, ".gitignore")))) {
    throw new Error("The source template is missing its .gitignore.");
  }

  const payment = options.payments === "stripe" ? "stripe" : "manual";
  await writeFile(
    join(root, "freeholder.config.ts"),
    `// Copyright (C) 2026 Tony Aly\n// SPDX-License-Identifier: Apache-2.0\n// Generated by create-freeholder. Secrets belong in .env, never here.\nimport { defineConfig } from "@/core/config";\n\nexport default defineConfig({\n  target: ${JSON.stringify(options.target)},\n  adapters: {\n    payments: ${JSON.stringify(payment)},\n    storage: ${JSON.stringify(storageFor(options.target))},\n  },\n  preset: ${JSON.stringify(options.preset)},\n  locales: ${JSON.stringify(country.locales)},\n  baseCurrency: ${JSON.stringify(country.currency)},\n});\n`,
  );

  const targetEnv = join(root, "deploy", options.target, ".env.example");
  const envTemplate = (await exists(targetEnv)) ? targetEnv : join(root, ".env.example");
  let env = await readFile(envTemplate, "utf8");
  if (options.payments === "stripe" && !env.includes("STRIPE_SECRET_KEY=")) {
    env += "\n# Stripe — create restricted production keys and a webhook endpoint before launch.\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\n";
  }
  if (options.demo && !env.includes("FREEHOLDER_SEED_DEMO=")) {
    env += "\nFREEHOLDER_SEED_DEMO=1\n";
  } else if (options.demo) {
    env = env.replace(/^FREEHOLDER_SEED_DEMO=.*$/m, "FREEHOLDER_SEED_DEMO=1");
  }
  await writeFile(join(root, ".env.example"), env.endsWith("\n") ? env : `${env}\n`);

  const targetInfra = join(root, "deploy", options.target, "infra");
  if (await exists(targetInfra)) {
    await cp(targetInfra, join(root, "infra"), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }

  await writeFile(
    join(root, "GETTING_STARTED.md"),
    `# ${options.name}\n\nGenerated for **${options.target}** using the **${options.preset}** preset.\n\nCountry defaults: ${country.code}; ${country.currency}; ${country.timezone}; ${country.locales.join(", ")}. You can change every business default during setup.\n\n## Local verification\n\n1. Install the exact Node release in \`.node-version\`, then enable the pinned package manager with \`corepack enable\`.\n2. Run \`pnpm install --frozen-lockfile\`.\n3. Copy \`.env.example\` to \`.env\` and fill every required blank. Never commit \`.env\`.\n4. Run \`pnpm db:migrate\`.\n5. Run \`pnpm dev\`, open \`/setup\`, and claim the owner account.\n6. Run \`pnpm doctor -- --url <url> --email <owner> --password <password>\` before deployment.\n\n## Deploy\n\nRead \`deploy/${options.target}/README.md\` and \`deploy/${options.target}/verify.md\`. Target infrastructure, when supplied by the recipe, is also copied to \`infra/\`.\n\nPayments: ${options.payments === "stripe" ? "Stripe is selected; configure and verify both API and webhook credentials." : "manual/offline; connect a provider later in configuration."}\n`,
  );
}

export async function createFreeholder(root: string, input: CreateOptions): Promise<string[]> {
  if (!PACKAGE_NAME.test(input.name)) throw new Error("Project name must be a lowercase npm package name.");
  const target = input.target ?? "local";
  const preset = input.preset ?? "everything";
  const payments = input.payments ?? "later";
  const country = countryDefault(input.country ?? "CA");
  if (!TARGETS.includes(target)) throw new Error(`Unknown target "${target}".`);
  if (!PRESETS.includes(preset)) throw new Error(`Unknown preset "${preset}".`);
  if (!PAYMENT_CHOICES.includes(payments)) throw new Error(`Unknown payment choice "${payments}".`);

  const destination = resolve(root);
  await assertDestinationAvailable(destination);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const template = await resolveTemplate(input.templateRoot);
  const templateInfo = await lstat(template.root);
  if (templateInfo.isSymbolicLink() || !templateInfo.isDirectory()) {
    throw new Error("The source template root must be a real directory, not a symbolic link.");
  }
  const [canonicalTemplate, canonicalParent] = await Promise.all([
    realpath(template.root),
    realpath(parent),
  ]);
  if (containsPath(canonicalTemplate, join(canonicalParent, basename(destination)))) {
    throw new Error("The destination cannot be inside its source template.");
  }
  const scratch = await mkdtemp(join(parent, `.${basename(destination)}-`));
  const staged = join(scratch, "project");
  try {
    await verifyTemplate(template.root, template.manifest, template.sourceTree);
    await cp(template.root, staged, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: template.sourceTree
        ? (path) => includeSourcePath(template.root, path)
        : undefined,
    });
    await configureProject(staged, {
      name: input.name,
      target,
      preset,
      country: country.code,
      payments,
      demo: input.demo ?? false,
    });
    if (await exists(destination)) await rmdir(destination);
    await rename(staged, destination);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  return [
    `Created ${input.name} for ${target}.`,
    `Preset: ${preset}. Country defaults: ${country.code}, ${country.currency}, ${country.timezone}.`,
    `Payments: ${payments === "stripe" ? "Stripe" : "later"}.`,
    "Next: read GETTING_STARTED.md, configure .env, migrate, then open /setup.",
  ];
}

function optionValue(args: string[], index: number, name: string): { value: string; consumed: number } {
  const current = args[index]!;
  const inline = current.match(new RegExp(`^--${name}=(.+)$`));
  if (inline) return { value: inline[1]!, consumed: 0 };
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return { value, consumed: 1 };
}

export function parseArguments(args: string[]): CliArguments {
  const parsed: CliArguments = { demo: false, nonInteractive: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--demo") parsed.demo = true;
    else if (argument === "--non-interactive") parsed.nonInteractive = true;
    else if (argument.startsWith("--target")) {
      const result = optionValue(args, index, "target");
      parsed.target = result.value as CliArguments["target"];
      index += result.consumed;
    } else if (argument.startsWith("--preset")) {
      const result = optionValue(args, index, "preset");
      parsed.preset = result.value as CliArguments["preset"];
      index += result.consumed;
    } else if (argument.startsWith("--country")) {
      const result = optionValue(args, index, "country");
      parsed.country = result.value;
      index += result.consumed;
    } else if (argument.startsWith("--payments")) {
      const result = optionValue(args, index, "payments");
      parsed.payments = result.value as CliArguments["payments"];
      index += result.consumed;
    } else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else if (!parsed.directory) parsed.directory = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  return parsed;
}

async function choose<T extends string>(
  question: string,
  values: readonly T[],
  fallback: T,
): Promise<T> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\n${question}\n`);
    values.forEach((value, index) => process.stdout.write(`  ${index + 1}. ${value}\n`));
    const answer = (await reader.question(`Choose [${values.indexOf(fallback) + 1}]: `)).trim();
    if (!answer) return fallback;
    const index = Number(answer) - 1;
    const byNumber = values[index];
    const byValue = values.find((value) => value.toLowerCase() === answer.toLowerCase());
    if (byNumber) return byNumber;
    if (byValue) return byValue;
    throw new Error(`Choose one of: ${values.join(", ")}.`);
  } finally {
    reader.close();
  }
}

function help(): string {
  return `Usage: create-freeholder <directory> [options]\n\nOptions:\n  --target <target>       ${TARGETS.join(" | ")}\n  --preset <preset>       ${PRESETS.join(" | ")}\n  --country <ISO code>    ${COUNTRY_DEFAULTS.map((entry) => entry.code).join(" | ")}\n  --payments <choice>     stripe | later\n  --demo                  Seed the deterministic demo business\n  --non-interactive       Require every choice as a flag\n  --help                  Show this help\n`;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(help());
    return;
  }
  const directory = args.directory;
  if (!directory) throw new Error("Give the new project a directory name. Run with --help for usage.");
  const name = basename(resolve(directory));
  if (args.nonInteractive) {
    const missing = ["target", "preset", "country", "payments"].filter(
      (key) => !args[key as keyof CliArguments],
    );
    if (missing.length > 0) {
      throw new Error(`--non-interactive requires: ${missing.map((key) => `--${key}`).join(", ")}.`);
    }
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive input needs a terminal. Pass --non-interactive with every required choice.");
  }

  const target = args.target ?? (await choose("Where will this run?", TARGETS, "local"));
  const preset = args.preset ?? (await choose("Business preset?", PRESETS, "everything"));
  const country = args.country ?? (await choose("Country?", COUNTRY_DEFAULTS.map((entry) => entry.code), "CA"));
  const payments = args.payments ?? (await choose("Payments now or later?", PAYMENT_CHOICES, "later"));
  const lines = await createFreeholder(directory, {
    name,
    target,
    preset,
    country,
    payments,
    demo: args.demo,
  });
  for (const line of lines) console.log(line);
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;
  const [invoked, current] = await Promise.all([
    realpath(resolve(process.argv[1])),
    realpath(fileURLToPath(import.meta.url)),
  ]);
  return invoked === current;
}

if (await isMainModule()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
