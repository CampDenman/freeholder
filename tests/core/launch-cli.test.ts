// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` (C3.30) against fakes of every outside party —
// DigitalOcean's API, Spaces' S3, GitHub's registry, the new site, DNS and
// SSH. No real infrastructure is touched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseLaunchArgs } from "../../packages/cli/src/launch/args";
import { digitalOcean, digitalOceanToken } from "../../packages/cli/src/launch/digitalocean";
import { resolveEdgeImage } from "../../packages/cli/src/launch/image";
import { CRON_LINE, defaultName, runLaunch, sslipHost, type LaunchDeps } from "../../packages/cli/src/launch/launch";
import { claimLink, Redactor } from "../../packages/cli/src/launch/secrets";
import { parseEnv } from "../../packages/cli/src/launch/state";
import type { Remote } from "../../packages/cli/src/launch/types";

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
  return { requests: [], keys: new Map(), deleted: [], buckets: new Set(), versioned: new Set(), bucketObjects: new Map(), droplet: null, siteStatus: 200, failBucket: false, failKeyDelete: false, remote: { commands: [], files: [], uploads: [] }, out: [], err: [] };
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
      if (method === "PUT" && url.search === "?versioning") { w.versioned.add(bucket); return new Response("", { status: 200 }); }
      if (method === "PUT") {
        if (w.failBucket) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
        if (w.buckets.has(bucket)) return new Response("<Error><Code>BucketAlreadyOwnedByYou</Code></Error>", { status: 409 });
        w.buckets.add(bucket);
        return new Response("", { status: 200 });
      }
      if (method === "GET") return new Response(`<ListBucketResult>${(w.bucketObjects.get(bucket) ?? []).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`, { status: 200 });
      if (method === "DELETE") return (w.bucketObjects.get(bucket) ?? []).length ? new Response("<Error><Code>BucketNotEmpty</Code></Error>", { status: 409 }) : new Response(null, { status: 204 });
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
  return {
    provider: digitalOcean("do-token", fetcher, async () => undefined),
    remote: () => fakeRemote(w),
    fetcher,
    sleep: async () => undefined,
    resolve4: async () => [],
    configRoot: root,
    out: { log: (l) => w.out.push(l), error: (l) => w.err.push(l) },
  };
}

const args = (...extra: string[]) => parseLaunchArgs(["launch", "--domain", "example.com", "--no-open", ...extra], {});

describe("freeholder launch (C3.30)", () => {
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

  it("launches end to end and prints the claim link once, with no other secret anywhere", async () => {
    expect(await runLaunch(args(), setup(w, root))).toBe(0);
    const dir = join(root, "example-com");
    const env = parseEnv(readFileSync(join(dir, "freeholder.env"), "utf8"));
    for (const name of ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD"]) expect(env[name]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([env.BOOTSTRAP_SECRET, env.SESSION_SECRET, env.CREDENTIAL_KEY, env.POSTGRES_PASSWORD]).size).toBe(4);
    expect(env).toMatchObject({ APP_URL: `https://${HOST}`, FREEHOLDER_DOMAIN: HOST, FREEHOLDER_PRIMARY_DOMAIN: HOST, FREEHOLDER_IMAGE: `ghcr.io/campdenman/freeholder@${DIGEST}`, S3_BUCKET: "example-com-media", BACKUP_BUCKET: "example-com-backups", S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com" });
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
    expect(existsSync(join(root, "example-com", "state.destroyed.json"))).toBe(true);
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
