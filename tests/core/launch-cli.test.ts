// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` (C3.30) against fakes of every outside party —
// DigitalOcean's API, Spaces' S3, GitHub's registry, the new site, DNS and
// SSH. No real infrastructure is touched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseLaunchArgs } from "../../packages/cli/src/launch/args";
import { digitalOcean, digitalOceanToken } from "../../packages/cli/src/launch/digitalocean";
import { resolveEdgeImage } from "../../packages/cli/src/launch/image";
import { CRON_LINE, defaultName, runLaunch, sslipHost, type LaunchDeps } from "../../packages/cli/src/launch/launch";
import { createNamespaceOrigin, requireReturnedNamespaceOrigin, type NamespaceOriginReceipt, type SignedOrigin } from "../../packages/cli/src/launch/namespace-origin";
import { SpacesClient } from "../../packages/cli/src/launch/s3";
import { claimLink, Redactor } from "../../packages/cli/src/launch/secrets";
import { parseEnv } from "../../packages/cli/src/launch/state";
import type { LaunchOptions, LaunchState, Remote } from "../../packages/cli/src/launch/types";

const IP = "203.0.113.7";
const HOST = sslipHost(IP);
const DIGEST = `sha256:${"a".repeat(64)}`;

interface World {
  requests: { method: string; url: string; body: string }[];
  keys: Map<string, { name: string; grants: { bucket: string; permission: string }[] }>;
  deleted: string[];
  buckets: Set<string>;
  versioned: Set<string>;
  bucketObjects: Map<string, string[]>;
  droplet: { id: number; body: Record<string, unknown> } | null;
  siteStatus: number;
  failBucket: boolean;
  failKeyDelete: boolean;
  remote: { commands: string[]; files: { path: string; content: string; mode: string }[]; uploads: string[] };
  out: string[];
  err: string[];
}

function world(): World {
  return { requests: [], keys: new Map(), deleted: [], buckets: new Set(["example-com-media", "example-com-backups"]), versioned: new Set(), bucketObjects: new Map(), droplet: null, siteStatus: 200, failBucket: false, failKeyDelete: false, remote: { commands: [], files: [], uploads: [] }, out: [], err: [] };
}

function fakeFetch(w: World): typeof fetch {
  let keyCount = 0;
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    w.requests.push({ method, url: url.toString(), body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.host === "api.digitalocean.com") {
      const path = url.pathname;
      if (path === "/v2/account") return json({ account: { status: "active" } });
      if (path === "/v2/account/keys") return json({ ssh_keys: [{ id: 11, fingerprint: "aa:bb", name: "tony" }] });
      if (path === "/v2/regions") return json({ regions: [{ slug: "nyc3", available: true, sizes: ["s-2vcpu-2gb"] }] });
      if (path === "/v2/sizes") return json({ sizes: [{ slug: "s-1vcpu-1gb", price_monthly: 6 }, { slug: "s-2vcpu-2gb", price_monthly: 18 }] });
      if (path === "/v2/droplets" && method === "GET") return json({ droplets: w.droplet ? [{ id: w.droplet.id, name: url.searchParams.get("name") }] : [] });
      if (path === "/v2/droplets" && method === "POST") {
        w.droplet = { id: 77, body: JSON.parse(body) as Record<string, unknown> };
        return json({ droplet: { id: 77 } }, 202);
      }
      if (path === "/v2/droplets/77" && method === "GET") return json({ droplet: { status: "active", networks: { v4: [{ ip_address: "10.0.0.2", type: "private" }, { ip_address: IP, type: "public" }] } } });
      if (path === "/v2/droplets/77" && method === "DELETE") { w.droplet = null; return new Response(null, { status: 204 }); }
      if (path === "/v2/spaces/keys" && method === "POST") {
        const parsed = JSON.parse(body) as { name: string; grants: { bucket: string; permission: string }[] };
        const access = `DOKEY${++keyCount}`;
        w.keys.set(access, parsed);
        return json({ key: { access_key: access, secret_key: `secret-of-${access}-xxxxxxxx` } }, 201);
      }
      if (path.startsWith("/v2/spaces/keys/") && method === "DELETE") {
        if (w.failKeyDelete) return json({ message: "temporarily unavailable" }, 503);
        const access = decodeURIComponent(path.split("/").pop()!);
        w.keys.delete(access);
        w.deleted.push(access);
        return new Response(null, { status: 204 });
      }
    }
    if (url.host === "nyc3.digitaloceanspaces.com") {
      expect(new Headers(init.headers).get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=DOKEY\d+\//);
      const bucket = url.pathname.split("/")[1]!;
      if (method === "GET" && url.pathname === "/") return new Response(`<ListAllMyBucketsResult><Buckets>${[...w.buckets].sort().map((name) => `<Bucket><Name>${name}</Name><CreationDate>2026-11-14T12:00:00.000Z</CreationDate></Bucket>`).join("")}</Buckets></ListAllMyBucketsResult>`, { status: 200 });
      if (method === "PUT" && url.search === "?versioning") { w.versioned.add(bucket); return new Response("", { status: 200 }); }
      if (method === "PUT") {
        if (w.failBucket) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
        if (w.buckets.has(bucket)) return new Response("<Error><Code>BucketAlreadyOwnedByYou</Code></Error>", { status: 409 });
        w.buckets.add(bucket);
        return new Response("", { status: 200, headers: { date: "Sat, 14 Nov 2026 12:00:00 GMT", "x-amz-request-id": "fictional-actual-create-request" } });
      }
      if (method === "GET") return new Response(`<ListBucketResult>${(w.bucketObjects.get(bucket) ?? []).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`, { status: 200 });
      if (method === "DELETE") {
        if ((w.bucketObjects.get(bucket) ?? []).length) return new Response("<Error><Code>BucketNotEmpty</Code></Error>", { status: 409 });
        w.buckets.delete(bucket);
        w.versioned.delete(bucket);
        return new Response(null, { status: 204 });
      }
    }
    if (url.host === "ghcr.io" && url.pathname === "/token") return json({ token: "anon" });
    if (url.host === "ghcr.io") return json({ manifests: [{ digest: `sha256:${"b".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } }, { digest: DIGEST, platform: { os: "linux", architecture: "amd64" } }] });
    if (url.host === HOST || url.host === "example.com") return new Response("", { status: url.pathname === "/setup" ? w.siteStatus : 200 });
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;
}

function fakeRemote(w: World): Remote {
  return {
    async run(command) {
      w.remote.commands.push(command);
      if (command === "cloud-init status") return { code: 0, stdout: "status: done\n", stderr: "" };
      if (command.includes("grep -c 'schema is up to date'")) return { code: 0, stdout: "1\n", stderr: "" };
      if (command.includes("./backup.sh")) {
        w.bucketObjects.set("example-com-backups", ["db/freeholder-2026-10-16T09-00-00Z.dump", "db/freeholder-2026-10-16T09-00-00Z.dump.sha256"]);
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    async upload(files) { w.remote.uploads.push(...files.map((f) => f.remote)); },
    async writeFile(path, content, mode) { w.remote.files.push({ path, content, mode }); },
  };
}

function setup(w: World, root: string): LaunchDeps {
  const fetcher = fakeFetch(w);
  const legacy = digitalOcean("do-token", fetcher, async () => undefined);
  // This generic orchestration fixture owns an EXISTING fictional bucket
  // cohort. It exercises actual production legacy cleanup/restart/destroy,
  // not genuine NEW DigitalOcean origin/image/claim acceptance. No verifier,
  // receipt, profile or attestation is injected to authorize a new origin.
  const retained = (options: LaunchOptions, state: LaunchState | null): LaunchState => {
    if (state?.namespaceOrigin) throw new Error("The legacy component fixture cannot represent a new origin");
    const buckets = { media: "example-com-media", backups: "example-com-backups" };
    if (!w.buckets.has(buckets.media) || !w.buckets.has(buckets.backups)) throw new Error("The actual retained fictional provider cohort is missing");
    return { ...(state ?? { version: 1, name: options.name, provider: options.provider, domain: options.domain, region: options.region, size: options.size, done: [] }), buckets };
  };
  return {
    provider: {
      ...legacy,
      preflight: (options, state) => legacy.preflight(options, retained(options, state)),
      async storage(options, state, save) { const existing = retained(options, state); await save({ buckets: existing.buckets }); await legacy.storage(options, existing, save); },
    },
    remote: () => fakeRemote(w),
    fetcher,
    sleep: async () => undefined,
    resolve4: async () => [],
    configRoot: root,
    out: { log: (l) => w.out.push(l), error: (l) => w.err.push(l) },
  };
}

function originSetup(w: World, root: string): LaunchDeps {
  const deps = setup(w, root);
  const provider = digitalOcean("do-token", deps.fetcher, async () => undefined);
  const endpoint = "https://nyc3.digitaloceanspaces.com", region = "nyc3", accountId = "00000000-0000-4000-8000-000000000101";
  return {
    ...deps,
    provider: {
      ...provider,
      preflight: async () => ({ sshKeyId: 11, notes: [] }),
      async storage(options, state, save, originDirectory) {
        if (!originDirectory) throw new Error("The origin test needs its private directory");
        if (state.namespaceOrigin) {
          await requireReturnedNamespaceOrigin(originDirectory, state.namespaceOrigin.bucket, { accountId, endpoint, region });
          return;
        }
        const origin = await createNamespaceOrigin(originDirectory, { siteName: options.name, accountId, endpoint, region });
        const buckets = { media: origin.bucket, backups: `${options.name}-backups` };
        await save({ buckets, namespaceOrigin: { version: 1, bucket: origin.bucket } });
        const spaces = new SpacesClient(endpoint, region, { accessKeyId: "DOKEY1", secretAccessKey: "fictional-secret" }, deps.fetcher);
        await origin.create(spaces);
        await spaces.createBucket(buckets.backups);
        await spaces.enableVersioning(buckets.backups);
        await save({}, {
          FREEHOLDER_STORAGE: "s3", S3_BUCKET: buckets.media, S3_ENDPOINT: endpoint, S3_REGION: region, S3_ADDRESSING_STYLE: "path",
          S3_ACCESS_KEY_ID: "DOKEY1", S3_SECRET_ACCESS_KEY: "fictional-secret", BACKUP_BUCKET: buckets.backups,
        });
      },
    },
  };
}

const args = (...extra: string[]) => parseLaunchArgs(["launch", "--domain", "example.com", "--no-open", ...extra], {});

describe("generic launch orchestration over retained fictional legacy storage (C3.30 component)", () => {
  let root: string;
  let w: World;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "freeholder-launch-"));
    w = world();
  });

  it("plans without creating anything", async () => {
    expect(await runLaunch(args("--dry-run"), setup(w, root))).toBe(0);
    expect(w.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(w.out.join("\n")).toMatch(/create droplet example-com \(s-2vcpu-2gb, nyc3/);
    expect(existsSync(join(root, "example-com", "state.json"))).toBe(false);
  });

  it("states the monthly cost in the plan, from DigitalOcean's own list price", async () => {
    expect(await runLaunch(args("--dry-run"), setup(w, root))).toBe(0);
    expect(w.out.join("\n")).toContain("$18/month for the s-2vcpu-2gb droplet plus Spaces' $5/month minimum for both buckets, about $23/month in all");
    w.out = [];
    expect(await runLaunch(args("--dry-run", "--json"), setup(w, root))).toBe(0);
    const plan = JSON.parse(w.out.join("\n")) as { dryRun: boolean; monthlyCostUsd: { server: number | null; storage: number }; cost: string };
    expect(plan).toMatchObject({ dryRun: true, monthlyCostUsd: { server: 18, storage: 5 } });
    expect(plan.cost).toMatch(/about \$23\/month in all/);
    expect(w.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("says where to look when DigitalOcean does not list the size's price", async () => {
    const fetcher = fakeFetch(w);
    const withoutPrice = (async (input: string | URL, init?: RequestInit) =>
      new URL(String(input)).pathname === "/v2/sizes" ? new Response(JSON.stringify({ sizes: [] }), { status: 200 }) : fetcher(input, init)) as typeof fetch;
    expect(await runLaunch(args("--dry-run"), { ...setup(w, root), provider: digitalOcean("do-token", withoutPrice, async () => undefined) })).toBe(0);
    expect(w.out.join("\n")).toMatch(/the s-2vcpu-2gb droplet \(see DigitalOcean's pricing page\) plus Spaces' \$5\/month minimum/);
  });

  it("launches end to end and prints the claim link once, with no other secret anywhere", async () => {
    expect(await runLaunch(args(), setup(w, root))).toBe(0);
    const dir = join(root, "example-com");
    const env = parseEnv(readFileSync(join(dir, "freeholder.env"), "utf8"));
    for (const name of ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD"]) expect(env[name]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([env.BOOTSTRAP_SECRET, env.SESSION_SECRET, env.CREDENTIAL_KEY, env.POSTGRES_PASSWORD]).size).toBe(4);
    expect(env).toMatchObject({ APP_URL: `https://${HOST}`, FREEHOLDER_DOMAIN: HOST, FREEHOLDER_PRIMARY_DOMAIN: HOST, FREEHOLDER_IMAGE: `ghcr.io/campdenman/freeholder@${DIGEST}`, FREEHOLDER_STORAGE: "spaces", S3_BUCKET: "example-com-media", BACKUP_BUCKET: "example-com-backups", S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com" });
    expect(statSync(join(dir, "freeholder.env")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);

    // Spaces: two private buckets, backups versioned; the temporary key is gone and the kept one reaches only those two.
    expect([...w.buckets].sort()).toEqual(["example-com-backups", "example-com-media"]);
    expect([...w.versioned]).toEqual(["example-com-backups"]);
    expect([...w.keys.values()]).toEqual([{ name: "example-com-rw", grants: [{ bucket: "example-com-media", permission: "readwrite" }, { bucket: "example-com-backups", permission: "readwrite" }] }]);
    expect(w.deleted).toEqual(["DOKEY1"]);

    // The droplet: Ubuntu 24.04, the recipe's ASCII cloud-init, monitoring and tags.
    expect(w.droplet!.body).toMatchObject({ name: "example-com", region: "nyc3", size: "s-2vcpu-2gb", image: "ubuntu-24-04-x64", ssh_keys: [11], monitoring: true, tags: ["freeholder", "freeholder-example-com"] });
    expect(w.droplet!.body.user_data).toBe(readFileSync("deploy/digitalocean-droplet/infra/cloud-init.yml", "utf8"));

    // The server: files, a 0600 .env, the stack started, a cron line that exports, and a first backup.
    expect(w.remote.uploads).toEqual(["/opt/freeholder/compose.yml", "/opt/freeholder/Caddyfile", "/opt/freeholder/backup.sh"]);
    expect(w.remote.files.find((f) => f.path === "/opt/freeholder/.env")?.mode).toBe("600");
    expect(w.remote.files.find((f) => f.path === "/etc/cron.d/freeholder-backup")?.content).toBe(`${CRON_LINE}\n`);
    expect(CRON_LINE).toContain("set -a; . /opt/freeholder/.env; set +a;");
    expect(w.remote.commands.some((c) => c.includes("docker compose pull") && c.includes("docker compose up -d"))).toBe(true);

    const printed = [...w.out, ...w.err].join("\n");
    const link = `https://${HOST}/setup#claim=${env.BOOTSTRAP_SECRET}`;
    expect(printed.split(link)).toHaveLength(2);
    for (const name of ["SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD", "S3_SECRET_ACCESS_KEY"]) expect(printed).not.toContain(env[name]!);
    expect(printed.replace(link, "")).not.toContain(env.BOOTSTRAP_SECRET!);
    expect(printed).toContain(`A  www.example.com  ${IP}`);
    expect(printed).toContain("freeholder launch --cutover --name example-com --domain example.com");
  });

  it("names the next commands the way it was run, so an npx launch prints runnable ones", async () => {
    expect(await runLaunch(args(), { ...setup(w, root), invocation: "npx @freeholder/cli@next" })).toBe(0);
    const printed = w.out.join("\n");
    expect(printed).toContain("npx @freeholder/cli@next launch --cutover --name example-com --domain example.com");
    expect(printed).toContain(`npx @freeholder/cli@next update --check --url https://${HOST}`);
  });

  it("emits JSON with the claim link and no other secret", async () => {
    expect(await runLaunch(args("--json"), setup(w, root))).toBe(0);
    const summary = JSON.parse(w.out.join("\n")) as { claimLink: string; site: string; envFile: string; dnsRecords: unknown[]; next: string[] };
    const env = parseEnv(readFileSync(join(root, "example-com", "freeholder.env"), "utf8"));
    expect(summary.claimLink).toBe(claimLink(HOST, env.BOOTSTRAP_SECRET!));
    expect(summary).toMatchObject({ site: `https://${HOST}`, dnsRecords: [{ type: "A", name: "example.com", value: IP }, { type: "A", name: "www.example.com", value: IP }] });
    const text = JSON.stringify(summary);
    for (const name of ["SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID"]) expect(text).not.toContain(env[name]!);
  });

  it("resumes after a failure without creating anything twice, and keeps its secrets", async () => {
    w.siteStatus = 500;
    expect(await runLaunch(args(), setup(w, root))).toBe(2);
    expect(w.err.join("\n")).toMatch(/did not come up \(HTTP 500\)/);
    const first = parseEnv(readFileSync(join(root, "example-com", "freeholder.env"), "utf8"));
    const posts = () => w.requests.filter((r) => r.method === "POST").length;
    const before = posts();
    w.siteStatus = 200;
    expect(await runLaunch(args(), setup(w, root))).toBe(0);
    expect(posts()).toBe(before);
    expect(parseEnv(readFileSync(join(root, "example-com", "freeholder.env"), "utf8")).BOOTSTRAP_SECRET).toBe(first.BOOTSTRAP_SECRET);
  });

  it("always deletes the temporary Spaces key, and cleans up one it could not delete", async () => {
    w.failBucket = true;
    expect(await runLaunch(args(), setup(w, root))).toBe(2);
    expect(w.deleted).toEqual(["DOKEY1"]);
    expect(w.keys.size).toBe(0);

    w = world();
    root = mkdtempSync(join(tmpdir(), "freeholder-launch-"));
    w.failBucket = true;
    w.failKeyDelete = true;
    expect(await runLaunch(args(), setup(w, root))).toBe(2);
    const state = JSON.parse(readFileSync(join(root, "example-com", "state.json"), "utf8")) as { orphanTemporaryKeyId?: string };
    expect(state.orphanTemporaryKeyId).toBe("DOKEY1");
    w.failBucket = false;
    w.failKeyDelete = false;
    expect(await runLaunch(args(), setup(w, root))).toBe(0);
    expect(w.deleted[0]).toBe("DOKEY1");
    expect([...w.keys.values()].map((k) => k.name)).toEqual(["example-com-rw"]);
  });

  it("refuses an unpinned image and a name another droplet already uses", async () => {
    expect(await runLaunch(args("--image", "ghcr.io/campdenman/freeholder:edge"), setup(w, root))).toBe(2);
    expect(w.err.join("\n")).toMatch(/not pinned to a digest/);
    const other = mkdtempSync(join(tmpdir(), "freeholder-launch-"));
    const w2 = world();
    w2.droplet = { id: 99, body: {} };
    expect(await runLaunch(args(), setup(w2, other))).toBe(2);
    expect(w2.err.join("\n")).toMatch(/already exists \(99\) and this launch did not create it/);
  });

  it("cuts over to the real domain only once DNS points at the server", async () => {
    await runLaunch(args(), setup(w, root));
    const deps = setup(w, root);
    expect(await runLaunch(args("--cutover"), deps)).toBe(2);
    expect(w.err.join("\n")).toMatch(/does not point at this server yet/);
    expect(await runLaunch(args("--cutover"), { ...deps, resolve4: async () => [IP] })).toBe(0);
    const env = parseEnv(readFileSync(join(root, "example-com", "freeholder.env"), "utf8"));
    expect(env).toMatchObject({ APP_URL: "https://example.com", FREEHOLDER_DOMAIN: "example.com", FREEHOLDER_PRIMARY_DOMAIN: "example.com" });
    expect(w.remote.commands.at(-1)).toContain("--force-recreate app caddy");
  });

  it("destroys only after confirmation, and keeps a bucket that still holds files", async () => {
    await runLaunch(args(), setup(w, root));
    expect(await runLaunch(parseLaunchArgs(["launch", "--destroy", "--name", "example-com", "--non-interactive"], {}), setup(w, root))).toBe(2);
    expect(w.droplet).not.toBeNull();
    const errors = w.err.length;
    expect(await runLaunch(parseLaunchArgs(["launch", "--destroy", "--name", "example-com", "--confirm", "example-com"], {}), setup(w, root))).toBe(0);
    expect(w.err.slice(errors)).toEqual([]);
    expect(w.droplet).toBeNull();
    expect(w.keys.size).toBe(0);
    const said = w.out.join("\n");
    expect(said).toMatch(/Deleted the empty bucket example-com-media/);
    expect(said).toMatch(/Kept example-com-backups: it still holds files/);
    expect(existsSync(join(root, "example-com.destroyed", "state.json"))).toBe(true);
    expect(existsSync(join(root, "example-com.destroyed", "freeholder.env"))).toBe(true);
    expect(existsSync(join(root, "example-com"))).toBe(false);
    expect(said).toMatch(/Deleted the site's Spaces key/);
    expect(said).toMatch(/bills Spaces as a subscription/);
  });

  it("says so when the site's Spaces key could not be deleted on destroy", async () => {
    await runLaunch(args(), setup(w, root));
    w.failKeyDelete = true;
    const before = w.out.length;
    expect(await runLaunch(parseLaunchArgs(["launch", "--destroy", "--name", "example-com", "--confirm", "example-com"], {}), setup(w, root))).toBe(0);
    const said = w.out.slice(before).join("\n");
    expect(said).toMatch(/Could not delete the site's Spaces key DOKEY\d+; delete it in the DigitalOcean console/);
    expect(said).not.toMatch(/Deleted the site's Spaces key/);
  });

  it("names sites and reads --domain in linear time, whatever the input", () => {
    expect(defaultName("")).toBe("");
    expect(defaultName("---")).toBe("");
    expect(defaultName("--Ex__ample..COM--")).toBe("ex-ample-com");
    expect(defaultName(`${"a".repeat(54)}.-b.com`)).toBe("a".repeat(54));
    expect(defaultName("a".repeat(80))).toBe("a".repeat(55));
    const domainOf = (input: string) => parseLaunchArgs(["launch", "--domain", input], {}).domain;
    expect(domainOf("HTTPS://Example.com///")).toBe("example.com");
    expect(domainOf("http://example.com/")).toBe("example.com");
    expect(domainOf("ftp://example.com")).toBe("ftp://example.com");
    expect(domainOf("example.com")).toBe("example.com");
    // Inputs that made the old `/-+$/` and `/\/+$/` patterns backtrack quadratically.
    const started = performance.now();
    expect(defaultName(`${"-".repeat(100_000)}x`)).toBe("x");
    expect(defaultName(`a${"-".repeat(100_000)}.`)).toBe("a");
    expect(domainOf(`x${"/".repeat(100_000)}`)).toBe("x");
    expect(domainOf(`a${"/".repeat(100_000)}b`)).toBe(`a${"/".repeat(100_000)}b`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("formats the claim link, redacts secrets, names sites and pins edge to linux/amd64", async () => {
    expect(claimLink("1-2-3-4.sslip.io", "a/b+c")).toBe("https://1-2-3-4.sslip.io/setup#claim=a%2Fb%2Bc");
    const redactor = new Redactor();
    redactor.add("0123456789abcdef");
    expect(redactor.clean("token 0123456789abcdef leaked")).toBe("token [redacted] leaked");
    expect(defaultName("Tony-Aly.com")).toBe("tony-aly-com");
    expect(sslipHost("203.0.113.7")).toBe("203-0-113-7.sslip.io");
    expect(await resolveEdgeImage(fakeFetch(world()))).toBe(`ghcr.io/campdenman/freeholder@${DIGEST}`);
  });

  it("reads the token from DIGITALOCEAN_TOKEN or the doctl context", async () => {
    expect(await digitalOceanToken(undefined, { DIGITALOCEAN_TOKEN: "env-token" }, "/nonexistent")).toBe("env-token");
    const home = mkdtempSync(join(tmpdir(), "doctl-"));
    mkdirSync(join(home, ".config", "doctl"), { recursive: true });
    writeFileSync(join(home, ".config", "doctl", "config.yaml"), "access-token: default-token\nauth-contexts:\n  work: work-token\ncontext: work\n");
    expect(await digitalOceanToken(undefined, {}, home)).toBe("work-token");
    expect(await digitalOceanToken("default", {}, home)).toBe("default-token");
  });

  it("ships exactly the repository's recipe files", () => {
    execFileSync("node", ["packages/cli/scripts/copy-recipe.mjs"]);
    for (const file of ["compose.yml", "Caddyfile", "backup.sh", "cloud-init.yml"]) {
      expect(readFileSync(join("packages/cli/recipes/digitalocean-droplet", file), "utf8")).toBe(readFileSync(join("deploy/digitalocean-droplet/infra", file), "utf8"));
    }
  });
});

describe("destroy and same-name rebirth with one-shot namespace origins", () => {
  let root: string;
  let w: World;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "freeholder-rebirth-"));
    w = world();
  });

  const launch = () => runLaunch(args("--image", `ghcr.io/campdenman/freeholder@${DIGEST}`), originSetup(w, root));
  const destroy = () => runLaunch(parseLaunchArgs(["launch", "--destroy", "--name", "example-com", "--confirm", "example-com"], {}), originSetup(w, root));

  it("archives the complete destroyed generation and starts a fresh origin without overwriting prior evidence", async () => {
    expect(await launch()).toBe(0);
    const dir = join(root, "example-com"), firstArchive = `${dir}.destroyed`;
    const firstState = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LaunchState;
    const firstAdmission = readFileSync(join(dir, "namespace-origin", "admission.json"), "utf8");
    const firstReceipt = readFileSync(join(dir, "namespace-origin", "receipt.json"), "utf8");

    expect(await destroy()).toBe(0);
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(firstArchive, "namespace-origin", "admission.json"), "utf8")).toBe(firstAdmission);
    expect(readFileSync(join(firstArchive, "namespace-origin", "receipt.json"), "utf8")).toBe(firstReceipt);
    expect(existsSync(join(firstArchive, "freeholder.env"))).toBe(true);

    expect(await launch()).toBe(0);
    const secondState = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LaunchState;
    expect(secondState.namespaceOrigin?.bucket).toMatch(/^example-com-media-[a-f0-9]{32}$/);
    expect(secondState.namespaceOrigin?.bucket).not.toBe(firstState.namespaceOrigin?.bucket);
    expect(readFileSync(join(dir, "namespace-origin", "receipt.json"), "utf8")).not.toBe(firstReceipt);
    expect(readFileSync(join(firstArchive, "namespace-origin", "admission.json"), "utf8")).toBe(firstAdmission);

    expect(await destroy()).toBe(0);
    expect(existsSync(join(root, "example-com.destroyed-2", "namespace-origin", "receipt.json"))).toBe(true);
    expect(readFileSync(join(firstArchive, "namespace-origin", "admission.json"), "utf8")).toBe(firstAdmission);
    expect(readFileSync(join(firstArchive, "namespace-origin", "receipt.json"), "utf8")).toBe(firstReceipt);
  });

  it("recovers the old partial archive layout only after dry-run leaves it untouched", async () => {
    expect(await launch()).toBe(0);
    const dir = join(root, "example-com");
    const firstState = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LaunchState;
    const admission = readFileSync(join(dir, "namespace-origin", "admission.json"), "utf8");
    await originSetup(w, root).provider.destroy(firstState, () => undefined);
    renameSync(join(dir, "state.json"), join(dir, "state.destroyed.json"));

    expect(await runLaunch(args("--dry-run", "--image", `ghcr.io/campdenman/freeholder@${DIGEST}`), originSetup(w, root))).toBe(0);
    expect(existsSync(join(dir, "namespace-origin", "admission.json"))).toBe(true);
    expect(existsSync(join(dir, "namespace-origin.destroyed"))).toBe(false);

    expect(await launch()).toBe(0);
    expect(readFileSync(join(dir, "namespace-origin.destroyed", "admission.json"), "utf8")).toBe(admission);
    const reborn = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LaunchState;
    expect(reborn.namespaceOrigin?.bucket).not.toBe(firstState.namespaceOrigin?.bucket);
  });

  it("refuses legacy rebirth when the origin's admission is missing instead of replacing its evidence", async () => {
    expect(await launch()).toBe(0);
    const dir = join(root, "example-com");
    const firstState = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LaunchState;
    await originSetup(w, root).provider.destroy(firstState, () => undefined);
    renameSync(join(dir, "state.json"), join(dir, "state.destroyed.json"));
    renameSync(join(dir, "namespace-origin", "admission.json"), join(dir, "namespace-origin", "admission.missing.json"));
    const writes = w.requests.filter((request) => request.method === "PUT").length;

    expect(await launch()).toBe(2);
    expect(w.err.join("\n")).toMatch(/storage origin could not be read/);
    expect(existsSync(join(dir, "namespace-origin", "admission.missing.json"))).toBe(true);
    expect(existsSync(join(dir, "namespace-origin", "admission.json"))).toBe(false);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
    expect(w.requests.filter((request) => request.method === "PUT")).toHaveLength(writes);
  });

  it("retains an unconfirmed provider creation as unknown evidence across confirmed destroy and rebirth", async () => {
    w.failBucket = true;
    expect(await launch()).toBe(2);
    const dir = join(root, "example-com");
    const admission = readFileSync(join(dir, "namespace-origin", "admission.json"), "utf8");
    const receipt = readFileSync(join(dir, "namespace-origin", "receipt.json"), "utf8");
    const original = JSON.parse(receipt) as SignedOrigin<NamespaceOriginReceipt>;
    expect(original.body.disposition).toBe("unknown");
    expect(original.body.response?.status).toBe(500);

    expect(await destroy()).toBe(0);
    const archive = `${dir}.destroyed`;
    expect(readFileSync(join(archive, "namespace-origin", "admission.json"), "utf8")).toBe(admission);
    expect(readFileSync(join(archive, "namespace-origin", "receipt.json"), "utf8")).toBe(receipt);
    expect((JSON.parse(readFileSync(join(archive, "namespace-origin", "receipt.json"), "utf8")) as SignedOrigin<NamespaceOriginReceipt>).body.disposition).toBe("unknown");

    w.failBucket = false;
    expect(await launch()).toBe(0);
    expect(readFileSync(join(archive, "namespace-origin", "receipt.json"), "utf8")).toBe(receipt);
  });
});
