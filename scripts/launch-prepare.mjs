// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.39: prepare private configuration; provider accounts remain with the owner.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

function publicOrigin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new Error("Use an HTTPS site origin, or HTTP localhost, without credentials, a path, query or fragment.");
  return url.origin;
}
async function regularFile(path) {
  const stat = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Launch configuration must be a regular private file.");
  return stat;
}
function envLine(name, value) { return `${name}=${JSON.stringify(value)}`; }

export async function prepareLaunch({ directory = process.cwd(), target = "replit", url, environment = process.env } = {}) {
  if (!["replit", "docker-selfhost"].includes(target)) throw new Error("Choose --target replit or docker-selfhost.");
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Use a real project directory.");
  const envPath = join(root, ".env");
  const existing = await regularFile(envPath);
  const original = existing ? await readFile(envPath, "utf8") : "";
  const stored = parseEnv(original);
  const values = { ...stored };
  const managed = ["DATABASE_URL", "APP_URL", "BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "FREEHOLDER_STORAGE", "REPLIT_BUCKET_ID", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "FREEHOLDER_SEED_DEMO"];
  for (const name of managed) if (environment[name]) values[name] = environment[name];
  const additions = {};
  for (const name of ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY"]) {
    if (!values[name]) { values[name] = randomBytes(32).toString("hex"); additions[name] = values[name]; }
    if (name !== "CREDENTIAL_KEY" && values[name].length < 32) throw new Error(`${name} must contain at least 32 characters; the existing value was preserved.`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(values.CREDENTIAL_KEY) && !/^[A-Za-z0-9_-]{43}$/.test(values.CREDENTIAL_KEY)) throw new Error("CREDENTIAL_KEY must be canonical 32-byte hex or base64url; the existing value was preserved.");
  const credentialBytes = /^[a-fA-F0-9]{64}$/.test(values.CREDENTIAL_KEY) ? Buffer.from(values.CREDENTIAL_KEY, "hex") : Buffer.from(values.CREDENTIAL_KEY, "base64url");
  if (credentialBytes.length !== 32) throw new Error("CREDENTIAL_KEY must encode 32 bytes; the existing value was preserved.");
  if (values.BOOTSTRAP_SECRET === values.SESSION_SECRET || values.BOOTSTRAP_SECRET === values.CREDENTIAL_KEY || values.SESSION_SECRET === values.CREDENTIAL_KEY) throw new Error("Deployment secrets must be independent; existing values were preserved.");
  const inferred = target === "replit" && environment.REPLIT_DOMAINS ? `https://${environment.REPLIT_DOMAINS.split(",")[0]}` : undefined;
  const siteOrigin = publicOrigin(url ?? values.APP_URL ?? inferred ?? "http://localhost:3000");
  values.APP_URL = siteOrigin;
  values.FREEHOLDER_STORAGE = target === "replit" ? "replit" : "s3";
  values.FREEHOLDER_SEED_DEMO ??= "0";
  // Preserve unrelated settings and comments; append overrides only when required.
  for (const name of managed) if (values[name] !== undefined && values[name] !== stored[name]) additions[name] = values[name];
  const added = Object.entries(additions).map(([name, value]) => envLine(name, value)).join("\n");
  if (!existing) await writeFile(envPath, added + "\n", { mode: 0o600, flag: "wx" });
  else if (added) await writeFile(envPath, original + (original.endsWith("\n") ? "" : "\n") + added + "\n", { mode: 0o600 });
  await chmod(envPath, 0o600);
  const privateDirectory = join(root, ".freeholder-launch");
  const dirStat = await lstat(privateDirectory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (dirStat && (!dirStat.isDirectory() || dirStat.isSymbolicLink())) throw new Error("Private launch state must be a real directory.");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await chmod(privateDirectory, 0o700);
  const claimPath = join(privateDirectory, "claim-link.txt"); await regularFile(claimPath);
  await writeFile(claimPath, `${siteOrigin}/setup#claim=${encodeURIComponent(values.BOOTSTRAP_SECRET)}\n`, { mode: 0o600 }); await chmod(claimPath, 0o600);
  const required = target === "replit" ? ["DATABASE_URL", "REPLIT_BUCKET_ID"] : ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  const missing = required.filter(name => !values[name]);
  if (target === "replit" && new URL(siteOrigin).protocol !== "https:") missing.push("APP_URL (HTTPS deployment URL)");
  const report = {
    target, configurationReady: missing.length === 0, missing, privateEnvironmentFile: envPath, privateClaimLinkFile: claimPath,
    setupUrl: `${siteOrigin}/setup`, mcpUrl: `${siteOrigin}/api/mcp`,
    next: target === "replit" ? ["Provision Replit PostgreSQL and Object Storage using Replit Agent.", "Import the private .env into Replit Secrets; preserve these same secrets in the Deployment.", "Set APP_URL to the published HTTPS URL and rerun preparation with --url.", "Run pnpm start:replit for development; publish using the checked-in Deployment configuration.", "Open the private claim link yourself, create a passkey, and connect your assistant in /admin/connect."] : ["Configure the database and private S3 bucket, then use deploy/docker-selfhost/README.md.", "Open the private claim link yourself, create a passkey, and connect your assistant in /admin/connect."],
    note: "Configuration preparation is not provider provisioning or a successful deployment. Private credentials and the claim link are never printed.",
  };
  const reportPath = join(privateDirectory, "report.json");
  await regularFile(reportPath);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await chmod(reportPath, 0o600);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const allowed = new Set(["--target", "--url", "--directory", "--json"]);
    const options = {};
    for (let index = 0; index < args.length; index++) {
      const name = args[index]; if (!allowed.has(name)) throw new Error("Use --target, --url, --directory and optional --json.");
      if (name === "--json") continue;
      const value = args[++index]; if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
      options[name.slice(2)] = value;
    }
    const report = await prepareLaunch(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.configurationReady) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Launch preparation failed."); process.exitCode = 1;
  }
}
