// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Materialize an App Platform spec without committing its encrypted inputs.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

const SECRET_KEYS = [
  "SESSION_SECRET",
  "CREDENTIAL_KEY",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function renderAppSpec(template, environment) {
  const spec = parse(template);
  const web = spec?.services?.find((service) => service.name === "web");
  if (!web || !Array.isArray(web.envs)) throw new Error("The App Platform template has no web env list.");
  for (const key of SECRET_KEYS) {
    const value = environment[key];
    if (!value) throw new Error(`${key} is required to prepare the App Platform spec.`);
    const entry = web.envs.find((candidate) => candidate.key === key);
    if (!entry) throw new Error(`The App Platform template does not declare ${key}.`);
    entry.value = value;
  }
  if (environment.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  const credential = environment.CREDENTIAL_KEY.trim();
  const credentialBytes = /^[0-9a-fA-F]{64}$/.test(credential)
    ? Buffer.from(credential, "hex")
    : Buffer.from(credential, "base64url");
  if (credentialBytes.length !== 32) {
    throw new Error("CREDENTIAL_KEY must be 64 hex characters or base64url for exactly 32 bytes.");
  }
  if (environment.FREEHOLDER_IMAGE_TAG) {
    web.image.tag = environment.FREEHOLDER_IMAGE_TAG;
  }
  return stringify(spec, { lineWidth: 0 });
}

async function main() {
  const source = argument("template", "deploy/digitalocean-app/infra/app.yaml");
  const output = argument("output", ".freeholder-do-app.yaml");
  const rendered = renderAppSpec(await readFile(source, "utf8"), process.env);
  await writeFile(output, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(output, 0o600);
  console.log(`prepared secret-bearing App Platform spec at ${output}; delete it after doctl accepts the deployment`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
