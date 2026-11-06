// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Guards on the deploy recipes (MASTER.md §18). These files are not imported by
// anything, so nothing else would notice them breaking — and the way they break
// is silent.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DEPLOY = "deploy";

function recipes(): string[] {
  return readdirSync(DEPLOY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("cloud-init files are ASCII only", () => {
  // The bug this exists for: an em dash in a comment made cloud-init reject the
  // entire document with "unacceptable character #x0080". User-data reaches the
  // parser without a UTF-8 decode, so one byte above 0x7F discards every
  // directive. Worse, it fails silently — `cloud-init status` still says
  // "done", and the failure surfaces as no Docker on a machine that claims to
  // have finished bootstrapping.
  for (const recipe of recipes()) {
    const path = join(DEPLOY, recipe, "infra", "cloud-init.yml");
    let contents: string | undefined;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      contents = undefined;
    }

    it.runIf(contents !== undefined)(`${recipe}: no byte above 0x7F`, () => {
      const offenders = [...contents!]
        .map((char, index) => ({ char, index, code: char.codePointAt(0)! }))
        .filter(({ code }) => code > 0x7f);

      expect(
        offenders.map((o) => `${JSON.stringify(o.char)} at offset ${o.index}`),
      ).toEqual([]);
    });
  }
});

describe("every recipe carries the files §18 requires", () => {
  for (const recipe of recipes()) {
    it(`${recipe} is complete`, () => {
      const required = ["recipe.yaml", "README.md", ".env.example", "verify.md"];
      const present = readdirSync(join(DEPLOY, recipe));
      for (const file of required) {
        expect(present, `${recipe}/${file}`).toContain(file);
      }
    });
  }
});

describe("the compose stack does not contradict the storage mandate", () => {
  for (const recipe of recipes()) {
    const path = join(DEPLOY, recipe, "infra", "compose.yml");
    let compose: string | undefined;
    try {
      compose = readFileSync(path, "utf8");
    } catch {
      compose = undefined;
    }

    it.runIf(compose !== undefined)(`${recipe}: media is never inside the replaceable app`, () => {
      // §18: media must not live where a rebuild throws it away. A mount
      // under /app would mix uploads into the release; the only supported
      // local-disk location is the docker-selfhost volume at
      // /var/lib/freeholder/media (C3.44), declared with LOCAL_STORAGE_ROOT.
      expect(compose!).not.toMatch(/media.*:\s*\/app\/(public\/)?media/i);
      expect(compose!).not.toMatch(/uploads:/i);
      if (recipe !== "docker-selfhost") {
        expect(compose!).not.toMatch(/LOCAL_STORAGE_ROOT|\/var\/lib\/freeholder\/media/);
      }
    });

    it.runIf(compose !== undefined)(
      `${recipe}: the proxy is given every variable its config interpolates`,
      () => {
        // The bug this exists for: the Caddyfile reads {$FREEHOLDER_DOMAIN},
        // which is Caddy's own substitution against the *container's*
        // environment — not compose's substitution against .env. The service
        // had neither `environment:` nor `env_file:`, so the variable was
        // empty, the site address vanished, and Caddy read the leftover `{` as
        // a global options block and refused to start. Nothing looked wrong:
        // app and db were up, and only the public surface was missing.
        const proxyPath = join(DEPLOY, recipe, "infra", "Caddyfile");
        let proxyConfig: string | undefined;
        try {
          proxyConfig = readFileSync(proxyPath, "utf8");
        } catch {
          return; // recipe does not use Caddy
        }

        const interpolated = [
          ...proxyConfig.matchAll(/\{\$([A-Z0-9_]+)\}/g),
        ].map((m) => m[1]!);
        expect(interpolated.length).toBeGreaterThan(0);

        const caddySection = compose!.slice(
          compose!.indexOf("  caddy:"),
          compose!.indexOf("  app:"),
        );
        for (const variable of interpolated) {
          expect(
            caddySection,
            `Caddyfile interpolates ${variable}, but the caddy service never receives it — ` +
              `it will read as empty and the config will not parse.`,
          ).toMatch(new RegExp(`${variable}\\s*:`));
        }
      },
    );

    it.runIf(compose !== undefined)(`${recipe}: database is not published`, () => {
      // `ports:` on the database would expose Postgres to the internet; the
      // app reaches it over the compose network with `expose:` instead.
      const dbSection = compose!.slice(compose!.indexOf("  db:"));
      expect(dbSection).not.toMatch(/^\s{4}ports:/m);
    });
  }
});

describe("a trusted client address only where a proxy overwrites it (C11.10)", () => {
  const recipesWithCaddy = [
    { caddy: "digitalocean-droplet/infra/Caddyfile", compose: "digitalocean-droplet/infra/compose.yml" },
    { caddy: "docker-selfhost/docker-updater/Caddyfile", compose: "docker-selfhost/docker-updater/compose.yml" },
    { caddy: "docker-selfhost/playground/demo.freeholder.ai.caddy", compose: "docker-selfhost/playground/compose.yml" },
    { caddy: "docker-selfhost/infra/Caddyfile.https", compose: "docker-selfhost/infra/compose.https.yml" },
  ];

  for (const recipe of recipesWithCaddy) {
    it(`${recipe.compose}: Caddy sets the header the app trusts, and the app is not published`, () => {
      const caddy = readFileSync(join(DEPLOY, recipe.caddy), "utf8");
      const compose = readFileSync(join(DEPLOY, recipe.compose), "utf8");
      expect(caddy).toMatch(/header_up X-Freeholder-Client-Ip \{client_ip\}/);
      expect(compose).toMatch(/TRUSTED_CLIENT_IP_HEADER:\s*x-freeholder-client-ip/);
      // A published app port would let a client reach the app directly and
      // write the trusted header itself.
      const app = compose.slice(compose.indexOf("  app:"));
      const appSection = app.slice(0, app.search(/\n  [a-z]+:\n/) === -1 ? undefined : app.search(/\n  [a-z]+:\n/));
      expect(appSection).not.toMatch(/^\s{4}ports:/m);
    });

    it(`${recipe.caddy}: the proxied site block refuses Next's image optimizer`, () => {
      // next.config.ts sets images.unoptimized; the edge refuses the endpoint
      // as well, so neither layer alone exposes it (GHSA-2464-fhr4-w9xw).
      // Caddy orders `respond` ahead of `reverse_proxy` itself, so what must
      // hold is that both live, uncommented, in the same top-level site block.
      const lines = readFileSync(join(DEPLOY, recipe.caddy), "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line));
      const blocks: string[][] = [];
      for (const line of lines) {
        if (/^\S.*\{\s*$/.test(line)) blocks.push([]);
        blocks.at(-1)?.push(line.trim());
      }
      const proxied = blocks.filter((block) => block.some((line) => line.startsWith("reverse_proxy ")));
      expect(proxied).toHaveLength(1);
      expect(proxied[0]).toContain("@nextImage path /_next/image /_next/image/*");
      expect(proxied[0]).toContain("respond @nextImage 404");
    });
  }

  it("documented proxy snippets overwrite the trusted header too", () => {
    // Following a README must not produce a proxy that passes a client's own
    // X-Freeholder-Client-Ip through to an app that trusts it.
    const readme = readFileSync(join(DEPLOY, "docker-selfhost/playground/README.md"), "utf8");
    const proxies = [...readme.matchAll(/reverse_proxy [^\n]*\n[^\n]*/g)].map((m) => m[0]);
    expect(proxies.length).toBeGreaterThan(0);
    for (const proxy of proxies) expect(proxy).toMatch(/header_up X-Freeholder-Client-Ip \{client_ip\}/);
    expect(readme).toMatch(/@nextImage path \/_next\/image \/_next\/image\/\*\n\s*respond @nextImage 404\n\s*reverse_proxy /);
  });

  it("the HTTPS compose file gives Caddy its hostname and keeps the plain file's project and database", () => {
    // Passkeys need HTTPS on a public host; compose.yml alone serves HTTP:3000.
    type Service = { ports?: string[]; volumes?: string[]; environment?: Record<string, string>; env_file?: string };
    const https = parse(readFileSync(join(DEPLOY, "docker-selfhost/infra/compose.https.yml"), "utf8")) as { services: Record<string, Service>; volumes: Record<string, unknown> };
    const plain = parse(readFileSync(join(DEPLOY, "docker-selfhost/infra/compose.yml"), "utf8")) as { services: Record<string, Service> };
    expect(https.services.caddy!.ports).toEqual(["80:80", "443:443"]);
    expect(https.services.caddy!.volumes).toContain("./Caddyfile.https:/etc/caddy/Caddyfile:ro");
    expect(https.services.caddy!.environment!.FREEHOLDER_DOMAIN).toMatch(/^\$\{FREEHOLDER_DOMAIN:\?/);
    expect(https.services.db!.ports).toBeUndefined();
    // Same directory and no `name:`, so one project; same volume, so switching keeps the data.
    expect(https.services.db!.volumes).toEqual(plain.services.db!.volumes);
    expect(https.services.app!.env_file).toBe(plain.services.app!.env_file);
    expect(https.services.app!.environment!.DATABASE_URL).toBe(plain.services.app!.environment!.DATABASE_URL);
    const recipe = parse(readFileSync(join(DEPLOY, "docker-selfhost/recipe.yaml"), "utf8")) as { operations: Record<string, string> };
    expect(recipe.operations["install-https"]).toBe(recipe.operations.install!.replace("compose.yml", "compose.https.yml"));
  });

  it("the plain compose recipe, which publishes the app, trusts no header", () => {
    const compose = readFileSync(join(DEPLOY, "docker-selfhost/infra/compose.yml"), "utf8");
    expect(compose).not.toMatch(/TRUSTED_CLIENT_IP_HEADER/);
  });

  it("managed platforms trust the header their documentation names, and only those", () => {
    // DigitalOcean App Platform documents do-connecting-ip; its X-Forwarded-For
    // carries the ingress address, so trusting that would group every visitor.
    const appSpec = readFileSync(join(DEPLOY, "digitalocean-app/infra/app.yaml"), "utf8");
    expect(appSpec).toMatch(/key: TRUSTED_CLIENT_IP_HEADER\n\s+value: do-connecting-ip\n/);
    // Railway documents X-Real-IP as the client's address at its edge.
    expect(readFileSync(".railway/railway.ts", "utf8")).toMatch(
      /TRUSTED_CLIENT_IP_HEADER: "x-real-ip"/,
    );
    // Render and Replit document no client-address header or proxy depth, so
    // naming one would be a guess an attacker could exploit.
    for (const file of ["render.yaml", ".replit"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/TRUSTED_CLIENT_IP_HEADER|TRUSTED_PROXY_HOPS/);
    }
  });
});

describe("docker-selfhost keeps media on a volume that is backed up (C3.44)", () => {
  type Service = { image?: string; volumes?: string[]; environment?: Record<string, string>; command?: string[] };
  for (const file of ["compose.yml", "compose.https.yml"]) {
    it(`${file}: app media volume, LOCAL_STORAGE_ROOT and a backup service that reads it`, () => {
      const compose = parse(readFileSync(join(DEPLOY, "docker-selfhost/infra", file), "utf8")) as { services: Record<string, Service>; volumes: Record<string, unknown> };
      const { app, backup } = compose.services;
      expect(app!.volumes).toContain("media:/var/lib/freeholder/media");
      expect(app!.environment!.LOCAL_STORAGE_ROOT).toBe("/var/lib/freeholder/media");
      // FREEHOLDER_STORAGE comes from .env: an `environment:` value would
      // override the owner's choice of S3.
      expect(app!.environment!.FREEHOLDER_STORAGE).toBeUndefined();
      expect(backup!.image).toBe("postgres:16-alpine");
      expect(backup!.volumes).toEqual(expect.arrayContaining(["./backup.sh:/usr/local/bin/freeholder-backup:ro", "media:/srv/media", "backups:/backups"]));
      expect(backup!.command).toEqual(["sh", "/usr/local/bin/freeholder-backup", "schedule"]);
      expect(Object.keys(compose.volumes)).toEqual(expect.arrayContaining(["pgdata", "media", "backups"]));
    });
  }

  it("the image creates the mount point owned by the app user, so a new volume is writable", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("AS runtime"));
    expect(runtime).toMatch(/mkdir -p \/var\/lib\/freeholder\/media && chown -R freeholder:freeholder \/var\/lib\/freeholder/);
    expect(runtime.indexOf("/var/lib/freeholder/media")).toBeLessThan(runtime.indexOf("USER freeholder"));
  });

  it("the backup is a custom-format dump plus media with checksums, restored into a scratch database", () => {
    const script = readFileSync(join(DEPLOY, "docker-selfhost/infra/backup.sh"), "utf8");
    expect(script).toContain("pg_dump --format=custom --no-owner --no-privileges");
    expect(script).toContain("media.tar.gz");
    expect(script).toContain("sha256sum ./* > SHA256SUMS");
    expect(script).toMatch(/pg_restore [^\n]*-d freeholder_restore/);
    expect(script).not.toMatch(/^\s*[^#\r\n]*--clean/m);
  });

  it("prepare needs only openssl, and pins the release image rather than edge", () => {
    const selfhost = readFileSync(join(DEPLOY, "docker-selfhost/selfhost.sh"), "utf8");
    expect(selfhost).toContain("openssl rand -hex 32");
    const commands = selfhost.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(commands.filter((line) => /\b(pnpm|npm|npx|node)\s/.test(line))).toEqual([]);
    expect(selfhost).toContain('FREEHOLDER_IMAGE "ghcr.io/campdenman/freeholder:$(release_version)"');
    for (const file of ["compose.yml", "compose.https.yml"]) {
      expect(readFileSync(join(DEPLOY, "docker-selfhost/infra", file), "utf8")).not.toContain(":edge}");
    }
  });
});

describe("the droplet backup is a verifiable restore artifact", () => {
  const backup = readFileSync(
    join(DEPLOY, "digitalocean-droplet", "infra", "backup.sh"),
    "utf8",
  );

  it("uses portable custom format without ownership and uploads a checksum", () => {
    expect(backup).toContain("--format=custom --no-owner --no-privileges");
    expect(backup).toContain("sha256sum");
    expect(backup).toContain(".sha256");
    expect(backup).not.toMatch(/^\s*[^#\r\n]*--clean/m);
  });
});

describe("the playground cannot take production down with it (C1.38 capacity)", () => {
  // The demo shares a 4 GB / 2 vCPU droplet with production. Before these
  // limits it had no restart policy (an OOM kill left it down until the next
  // hourly reset), equal CPU priority, and a heap Node sized so close to its
  // cgroup that a measured burst peaked 32 MB short of the kill.
  const dir = join(DEPLOY, "docker-selfhost", "playground");
  const compose = parse(readFileSync(join(dir, "compose.yml"), "utf8")) as {
    services: Record<string, Record<string, unknown> & { environment?: Record<string, string> }>;
  };
  const megabytes = (value: unknown) => Number(String(value).replace(/m$/, ""));

  for (const name of ["app", "db"]) {
    it(`${name} yields CPU and memory to production and comes back after a kill`, () => {
      const service = compose.services[name]!;
      expect(service.restart).toBe("unless-stopped");
      expect(service.oom_score_adj).toBe(1000);
      expect(Number(service.cpu_shares)).toBeLessThan(1024);
      expect(service.memswap_limit).toBe(service.mem_limit);
    });
  }

  it("bounds the whole demo well inside the droplet, and the heap inside its container", () => {
    const { app, db } = compose.services;
    expect(megabytes(app!.mem_limit) + megabytes(db!.mem_limit)).toBeLessThanOrEqual(1408);
    // Its tmpfs data counts against this limit, and a killed database comes
    // back empty, so it keeps room to spare.
    expect(megabytes(db!.mem_limit)).toBeGreaterThanOrEqual(512);
    const heap = Number(/--max-old-space-size=(\d+)/.exec(app!.environment!.NODE_OPTIONS ?? "")?.[1]);
    // Measured: the live heap is ~315 MB, and ~300 MB of code and native
    // memory sits outside it.
    expect(heap).toBeGreaterThanOrEqual(384);
    expect(heap + 300).toBeLessThan(megabytes(app!.mem_limit));
    expect(Number(app!.environment!.FREEHOLDER_JOBS_POLL_SECONDS)).toBeGreaterThanOrEqual(10);
  });

  it("reports an emptied database as unhealthy, and a timer acts on it", () => {
    // Liveness would stay green while every page errors against an empty
    // database; readiness would turn red on a merely busy demo. The schema
    // probe answers only the question heal acts on.
    const check = JSON.stringify(compose.services.app!.healthcheck);
    expect(check).toContain("localhost:3000/api/health/db");
    expect(readFileSync(join(dir, "reset.sh"), "utf8")).toContain("/api/health/db");
    expect(readFileSync(join(dir, "freeholder-playground-heal.service"), "utf8")).toMatch(/reset\.sh --heal/);
    expect(readFileSync(join(dir, "freeholder-playground-heal.timer"), "utf8")).toMatch(/OnUnitActiveSec=/);
  });

  it("joins the proxy network only through reset.sh, after readiness", () => {
    expect(compose.services.app!.networks).toEqual(["private"]);
    const reset = readFileSync(join(dir, "reset.sh"), "utf8");
    const ready = reset.indexOf("until docker exec");
    const connect = reset.indexOf("docker network connect --alias");
    expect(ready).toBeGreaterThan(0);
    expect(connect).toBeGreaterThan(ready);
    // Running two playgrounds at once is conditional on the host having room.
    expect(reset).toMatch(/MemAvailable/);
    expect(reset).toMatch(/PLAYGROUND_OVERLAP_MIN_MB/);
  });

  it("Caddy compresses, queues a spike and holds requests through a reset", () => {
    const caddy = readFileSync(join(dir, "demo.freeholder.ai.caddy"), "utf8");
    expect(caddy).toMatch(/encode zstd gzip/);
    expect(caddy).toMatch(/lb_try_duration \d+s/);
    expect(caddy).toMatch(/max_conns_per_host \d+/);
    // Long admin actions (imports, exports) must not become a 503.
    expect(Number(/response_header_timeout (\d+)s/.exec(caddy)?.[1])).toBeGreaterThanOrEqual(120);
    expect(caddy).toMatch(/handle_errors 502 503 504/);
    expect(caddy).toMatch(/Retry-After/);
  });
});
