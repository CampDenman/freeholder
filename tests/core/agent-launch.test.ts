// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { prepareLaunch } from "../../scripts/launch-prepare.mjs";
import { connectionScopes } from "@/core/apikeys/profiles";
import { z } from "zod";
import { blockTreeSchema } from "@/modules/cms/blocks/registry";
const directories: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), "freeholder-launch-test-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("private launch preparation", () => {
  it("generates independent private credentials, reports missing infrastructure and never exposes credentials", async () => {
    const dir = await directory();
    const result = await prepareLaunch({ directory: dir, url: "https://business.replit.app", environment: {} });
    const values = parseEnv(await readFile(join(dir, ".env"), "utf8"));
    expect(new Set([values.BOOTSTRAP_SECRET, values.SESSION_SECRET, values.CREDENTIAL_KEY]).size).toBe(3);
    for (const name of ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY"]) { expect(values[name]).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result)).not.toContain(values[name]); }
    expect(result.configurationReady).toBe(false); expect(result.missing).toEqual(["DATABASE_URL", "REPLIT_BUCKET_ID"]);
    const claim = new URL((await readFile(result.privateClaimLinkFile, "utf8")).trim());
    expect(claim.search).toBe(""); expect(new URLSearchParams(claim.hash.slice(1)).get("claim")).toBe(values.BOOTSTRAP_SECRET);
    expect((await stat(result.privateEnvironmentFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, ".freeholder-launch"))).mode & 0o777).toBe(0o700);
    expect((await stat(result.privateClaimLinkFile)).mode & 0o777).toBe(0o600);
  });
  it("preserves credentials and unrelated settings on rerun; injected provider secrets win without being rotated", async () => {
    const dir = await directory();
    await writeFile(join(dir, ".env"), "# Keep this comment\nCUSTOM_SETTING=keep\n", { mode: 0o600 });
    const first = await prepareLaunch({ directory: dir, url: "https://business.replit.app", environment: {} });
    const initial = parseEnv(await readFile(first.privateEnvironmentFile, "utf8"));
    const result = await prepareLaunch({ directory: dir, url: "https://published.replit.app", environment: { DATABASE_URL: "postgresql://test:test@localhost/test", REPLIT_BUCKET_ID: "private-test-bucket", SESSION_SECRET: "existing-provider-session-secret-32+" } });
    const text = await readFile(result.privateEnvironmentFile, "utf8"); const values = parseEnv(text);
    expect(values.BOOTSTRAP_SECRET).toBe(initial.BOOTSTRAP_SECRET); expect(values.CREDENTIAL_KEY).toBe(initial.CREDENTIAL_KEY);
    expect(values.SESSION_SECRET).toBe("existing-provider-session-secret-32+"); expect(values.CUSTOM_SETTING).toBe("keep"); expect(text).toContain("# Keep this comment");
    expect(result.configurationReady).toBe(true); expect(result.setupUrl).toBe("https://published.replit.app/setup");
  });
  it("refuses insecure remote URLs, embedded credentials, weak existing secrets and symlinked secret files", async () => {
    const dir = await directory();
    for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com/?secret=value"]) await expect(prepareLaunch({ directory: dir, url, environment: {} })).rejects.toThrow(/HTTPS/);
    await writeFile(join(dir, ".env"), "SESSION_SECRET=weak\n");
    await expect(prepareLaunch({ directory: dir, environment: {} })).rejects.toThrow(/SESSION_SECRET/);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("SESSION_SECRET=weak\n");
    await rm(join(dir, ".env")); await writeFile(join(dir, "untouched"), "original"); await symlink(join(dir, "untouched"), join(dir, ".env"));
    await expect(prepareLaunch({ directory: dir, environment: {} })).rejects.toThrow(/regular/);
    expect(await readFile(join(dir, "untouched"), "utf8")).toBe("original");
  });
});

describe("Docker Compose launch preparation", () => {
  async function checkout() {
    const dir = await directory();
    await mkdir(join(dir, "deploy", "docker-selfhost"), { recursive: true });
    return dir;
  }

  it("writes the .env Compose reads, with a database password, and needs no DATABASE_URL", async () => {
    const dir = await checkout();
    const result = await prepareLaunch({ directory: dir, target: "docker-selfhost", url: "https://shop.example.com", environment: {} });
    expect(result.privateEnvironmentFile).toBe(join(dir, "deploy", "docker-selfhost", ".env"));
    await expect(stat(join(dir, ".env"))).rejects.toThrow(/ENOENT/);
    const values = parseEnv(await readFile(result.privateEnvironmentFile, "utf8"));
    const secrets = ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD"];
    for (const name of secrets) { expect(values[name]).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result)).not.toContain(values[name]); }
    expect(new Set(secrets.map((name) => values[name])).size).toBe(4);
    // C3.44: media defaults to the recipe's volume, so nothing is missing.
    expect(values).toMatchObject({ APP_URL: "https://shop.example.com", FREEHOLDER_DOMAIN: "shop.example.com", FREEHOLDER_STORAGE: "local" });
    expect(values.DATABASE_URL).toBeUndefined();
    expect(result.missing).toEqual([]);
    expect(result.configurationReady).toBe(true);
    expect(result.composeFile).toBe("deploy/docker-selfhost/infra/compose.https.yml");
    expect(result.startCommand).toBe("docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.https.yml up -d");
    expect((await stat(result.privateEnvironmentFile)).mode & 0o777).toBe(0o600);
    expect(result.privateClaimLinkFile).toBe(join(dir, ".freeholder-launch", "claim-link.txt"));
    expect((await readFile(result.privateClaimLinkFile, "utf8")).trim()).toBe(`https://shop.example.com/setup#claim=${values.BOOTSTRAP_SECRET}`);

    const s3 = await prepareLaunch({ directory: dir, target: "docker-selfhost", url: "https://shop.example.com", environment: { FREEHOLDER_STORAGE: "s3" } });
    expect(s3.missing).toEqual(["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
    const ready = await prepareLaunch({ directory: dir, target: "docker-selfhost", url: "https://shop.example.com", environment: { S3_ENDPOINT: "https://s3.example.test", S3_REGION: "r", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s" } });
    expect(ready.configurationReady).toBe(true);
    const again = parseEnv(await readFile(ready.privateEnvironmentFile, "utf8"));
    expect(again.FREEHOLDER_STORAGE).toBe("s3");
    for (const name of secrets) expect(again[name]).toBe(values[name]);
  });

  it("uses plain HTTP Compose on localhost, and keeps an existing database password", async () => {
    const dir = await checkout();
    await writeFile(join(dir, "deploy", "docker-selfhost", ".env"), "POSTGRES_PASSWORD=existing-db-password\n", { mode: 0o600 });
    const result = await prepareLaunch({ directory: dir, target: "docker-selfhost", url: "http://localhost:3000", environment: {} });
    const values = parseEnv(await readFile(result.privateEnvironmentFile, "utf8"));
    expect(values.POSTGRES_PASSWORD).toBe("existing-db-password");
    expect(values.FREEHOLDER_DOMAIN).toBeUndefined();
    expect(result.composeFile).toBe("deploy/docker-selfhost/infra/compose.yml");
    expect(result.next.join(" ")).toMatch(/passkeys need HTTPS/);
  });

  it("refuses a database password Compose cannot put in DATABASE_URL, and preserves it", async () => {
    const dir = await checkout();
    const envPath = join(dir, "deploy", "docker-selfhost", ".env");
    await writeFile(envPath, "POSTGRES_PASSWORD=p@ss/word\n", { mode: 0o600 });
    await expect(prepareLaunch({ directory: dir, target: "docker-selfhost", environment: {} })).rejects.toThrow(/POSTGRES_PASSWORD/);
    expect(await readFile(envPath, "utf8")).toBe("POSTGRES_PASSWORD=p@ss/word\n");
  });

  it("still writes beside --directory when it names the recipe folder itself", async () => {
    const dir = await directory();
    const result = await prepareLaunch({ directory: dir, target: "docker-selfhost", environment: {} });
    expect(result.privateEnvironmentFile).toBe(join(dir, ".env"));
    expect(result.startCommand).toBeUndefined();
  });
});

describe("assistant permission presets", () => {
  const services: { name: string; kind: "query" | "mutation" }[] = [
    { name: "cms.listPages", kind: "query" }, { name: "cms.createPage", kind: "mutation" }, { name: "cms.publishPage", kind: "mutation" },
    { name: "cms.deleteDraftPage", kind: "mutation" }, { name: "apikeys.create", kind: "mutation" },
    { name: "contacts.list", kind: "query" }, { name: "invoicing.refund", kind: "mutation" },
    { name: "platform.doctor", kind: "query" }, { name: "platform.applyUpdate", kind: "mutation" },
  ];
  it("grants exact available services; website keys cannot touch customers, money, credentials, deletion or updates", () => {
    expect(connectionScopes("read", services)).toEqual(["cms.listPages"]);
    expect(connectionScopes("website", services)).toEqual(["cms.createPage", "cms.listPages", "cms.publishPage"]);
    expect(connectionScopes("health", services)).toEqual(["platform.doctor"]);
    expect(connectionScopes("website", [])).toEqual([]);
  });
});

it("describes the validated block-node structure in machine-readable tool schemas", () => {
  const schema = z.toJSONSchema(blockTreeSchema("page"), { io: "input" });
  expect(schema.description).toContain("inside props");
  const example = [{ id: "intro", type: "heading", props: { text: "Welcome", level: 1 } }];
  expect(blockTreeSchema("page").parse(example)).toMatchObject(example);
  expect(() => blockTreeSchema("page").parse([{ type: "heading", text: "Incorrect shape" }])).toThrow();
});
