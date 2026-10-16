// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` (MASTER.md C3.30): one command from nothing to a hosted
// Freeholder site and a one-click owner claim link.
//
// Each step records itself in the site's state file as soon as it is done,
// so running the same command again continues instead of creating a second
// droplet, bucket or key; `--destroy` removes what the state names. The CLI
// never creates the owner: it ends at `/setup#claim=…`, where the owner sets
// their own email and password or passkey.
import { promises as dns } from "node:dns";
import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPinned, resolveEdgeImage } from "./image.js";
import { SpacesClient } from "./s3.js";
import { claimLink, generateSecrets, Redactor } from "./secrets.js";
import { readEnv, readState, siteDirectory, writeEnv, writeState } from "./state.js";
import { LaunchFailure, STEPS, type LaunchOptions, type LaunchProvider, type LaunchState, type Remote, type Step } from "./types.js";

export const LAUNCH_EXIT = { ok: 0, failed: 2, unreachable: 3 } as const;

export interface LaunchDeps {
  provider: LaunchProvider;
  remote: (ip: string, knownHosts: string, identity?: string) => Remote;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  resolve4?: (host: string) => Promise<string[]>;
  openUrl?: (url: string) => void;
  canOpen?: boolean;
  prompt?: (question: string) => Promise<string>;
  configRoot?: string;
  out?: { log: (line: string) => void; error: (line: string) => void };
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const NAME = /^[a-z0-9][a-z0-9-]{1,53}[a-z0-9]$/;

/** The site's resource name: lowercase, dashes, short enough for `<name>-backups` to be a valid bucket. */
export function defaultName(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55).replace(/-+$/, "");
}

export const sslipHost = (ip: string) => `${ip.replace(/\./g, "-")}.sslip.io`;

/** The recipe's files: shipped inside the package, or read from the repository in development. */
export function recipeDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "..", "recipes", "digitalocean-droplet"), join(here, "..", "..", "..", "..", "deploy", "digitalocean-droplet", "infra")]) {
    if (existsSync(join(candidate, "compose.yml"))) return candidate;
  }
  throw new LaunchFailure("The DigitalOcean recipe files are missing from this install.", "Reinstall @freeholder/cli.", LAUNCH_EXIT.failed);
}

export const CRON_LINE = "15 3 * * * root set -a; . /opt/freeholder/.env; set +a; /opt/freeholder/backup.sh >> /var/log/freeholder-backup.log 2>&1";

export async function runLaunch(options: LaunchOptions, deps: LaunchDeps): Promise<number> {
  const redactor = new Redactor();
  const out = deps.out ?? console;
  const progress = (line: string) => (options.json ? out.error : out.log)(redactor.clean(line));
  const fetcher = deps.fetcher ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const resolve4 = deps.resolve4 ?? ((host: string) => dns.resolve4(host).catch(() => []));

  try {
    if (!options.destroy && !DOMAIN.test(options.domain)) throw new LaunchFailure(`"${options.domain}" is not a domain name.`, "Pass the bare domain, like --domain example.com.", LAUNCH_EXIT.failed);
    if (!NAME.test(options.name)) throw new LaunchFailure(`"${options.name}" cannot name the site's resources.`, "Use 3–55 lowercase letters, digits and dashes, like --name example-site.", LAUNCH_EXIT.failed);
    const dir = siteDirectory(options.name, deps.configRoot);
    const envPath = join(dir, "freeholder.env");
    let state = await readState(dir);
    let env = await readEnv(dir);
    redactor.addEnv(env);
    redactor.add(options.paradisemodernKey);

    if (options.destroy) return await destroy(options, deps, dir, state, progress);
    if (options.cutover) return await cutover(options, deps, dir, state, env, progress, fetcher, sleep, resolve4);

    if (state && (state.domain !== options.domain || state.provider !== options.provider)) {
      throw new LaunchFailure(`The site ${options.name} was launched for ${state.domain} on ${state.provider}.`, "Use a different --name for a different site.", LAUNCH_EXIT.failed);
    }
    const preflight = await deps.provider.preflight(options, state);
    for (const note of preflight.notes) progress(note);
    if (options.dryRun) {
      printPlan(options, state, envPath, out);
      return LAUNCH_EXIT.ok;
    }
    state ??= { version: 1, name: options.name, provider: options.provider, domain: options.domain, region: options.region, size: options.size, done: [] };
    state.sshKeyId = preflight.sshKeyId;
    const save = async (patch: Partial<LaunchState>, envPatch?: Record<string, string>) => {
      state = { ...state!, ...patch };
      for (const key of Object.keys(patch) as (keyof LaunchState)[]) if (patch[key] === undefined) delete (state as unknown as Record<string, unknown>)[key];
      if (envPatch) {
        env = { ...env, ...envPatch };
        redactor.addEnv(env);
        await writeEnv(dir, env);
      }
      await writeState(dir, state);
    };
    const finish = async (step: Step, line: string) => {
      if (!state!.done.includes(step)) await save({ done: [...state!.done, step] });
      progress(`✓ ${line}`);
    };
    const pending = (step: Step) => !state!.done.includes(step);
    await finish("preflight", "Account, SSH key, region and size checked.");

    if (pending("image")) {
      const image = options.image ?? (await resolveEdgeImage(fetcher));
      if (!isPinned(image)) throw new LaunchFailure(`${image} is not pinned to a digest.`, "Pass --image ghcr.io/campdenman/freeholder@sha256:<64 hex>, or leave it out to pin the current edge build.", LAUNCH_EXIT.failed);
      await save({ image }, { FREEHOLDER_IMAGE: image });
    }
    await finish("image", `Image pinned: ${state.image}.`);

    if (pending("secrets")) {
      // Generated once. A resumed launch keeps the secrets it already wrote.
      const fresh = env.BOOTSTRAP_SECRET ? {} : generateSecrets();
      await save({}, {
        ...fresh,
        ...(options.paradisemodernKey ? { PARADISEMODERN_API_KEY: options.paradisemodernKey } : {}),
        ...(options.paradisemodernSiteId ? { PARADISEMODERN_SITE_ID: options.paradisemodernSiteId } : {}),
      });
    }
    await finish("secrets", `Secrets generated and written to ${envPath} (mode 600).`);

    if (pending("spaces")) await deps.provider.storage(options, state, save);
    await finish("spaces", `Storage ready: ${state.buckets!.media} and ${state.buckets!.backups} (versioned), with a key scoped to just those two.`);

    const userData = await readFile(join(recipeDirectory(), "cloud-init.yml"), "utf8");
    if (pending("droplet")) await deps.provider.server(options, state, userData, (patch) => save(patch));
    await finish("droplet", `Server ${state.dropletId} is up at ${state.ip}.`);

    const remote = deps.remote(state.ip!, join(dir, "known_hosts"), options.sshIdentity);
    if (pending("cloud-init")) await waitForCloudInit(remote, sleep);
    await finish("cloud-init", "The server finished setting itself up (Docker, firewall, security updates).");

    if (pending("host")) {
      const resolved = await resolve4(options.domain);
      const temporary = options.temporaryHost || !resolved.includes(state.ip!);
      const host = temporary ? sslipHost(state.ip!) : options.domain;
      await save({ host, temporaryHost: temporary }, { APP_URL: `https://${host}`, FREEHOLDER_DOMAIN: host, FREEHOLDER_PRIMARY_DOMAIN: host });
    }
    await finish("host", state.temporaryHost ? `Using the temporary address ${state.host} until ${options.domain} points here.` : `Serving ${state.host}.`);

    if (pending("deploy")) {
      const recipe = recipeDirectory();
      await remote.upload(["compose.yml", "Caddyfile", "backup.sh"].map((f) => ({ local: join(recipe, f), remote: `/opt/freeholder/${f}` })));
      await remote.writeFile("/opt/freeholder/.env", (await readFile(envPath, "utf8")), "600");
      const started = await remote.run("cd /opt/freeholder && chmod +x backup.sh && docker compose pull --quiet && docker compose up -d");
      if (started.code !== 0) throw new LaunchFailure("The site did not start on the server.", `Look at \`ssh root@${state.ip} 'cd /opt/freeholder && docker compose logs --tail 50'\`, then run the same command again.`, LAUNCH_EXIT.failed);
    }
    await finish("deploy", "The site is installed and starting.");

    if (pending("readiness")) await waitForReady(remote, state.host!, fetcher, sleep);
    await finish("readiness", `https://${state.host}/setup answers, with a valid certificate.`);

    if (pending("backups")) await setUpBackups(remote, env, deps.provider, state, fetcher);
    await finish("backups", "Nightly backups are scheduled, and a first backup is in the bucket with its checksum.");

    const link = claimLink(state.host!, env.BOOTSTRAP_SECRET!);
    const dnsRecords = [
      { type: "A", name: options.domain, value: state.ip! },
      { type: "A", name: `www.${options.domain}`, value: state.ip! },
    ];
    const next = [
      ...(state.temporaryHost ? [`freeholder launch --cutover --name ${options.name} --domain ${options.domain}`] : []),
      `freeholder update --check --url https://${state.host}`,
    ];
    if (options.json) {
      out.log(JSON.stringify({ ok: true, name: options.name, provider: options.provider, site: `https://${state.host}`, temporaryHost: state.temporaryHost, claimLink: link, envFile: envPath, dnsRecords: state.temporaryHost ? dnsRecords : [], next, server: { id: state.dropletId, ip: state.ip, region: options.region, size: options.size }, buckets: state.buckets }, null, 2));
    } else {
      out.log("");
      out.log(`Your site is live at https://${state.host}`);
      out.log("");
      out.log("Claim it (open this once; it signs you up as the owner):");
      out.log(`  ${link}`);
      out.log("");
      out.log(`Everything the site needs is in ${envPath}.`);
      out.log("Back that file up somewhere safe. Losing CREDENTIAL_KEY means reconnecting every account the site connects to.");
      if (state.temporaryHost) {
        out.log("");
        out.log(`To use ${options.domain}, add these DNS records, then run the cutover:`);
        for (const r of dnsRecords) out.log(`  ${r.type}  ${r.name}  ${r.value}`);
      }
      out.log("");
      out.log("Next:");
      for (const n of next) out.log(`  ${n}`);
      if (options.open && !options.nonInteractive && deps.canOpen && deps.openUrl) deps.openUrl(link);
    }
    return LAUNCH_EXIT.ok;
  } catch (error) {
    if (error instanceof LaunchFailure) {
      out.error(redactor.clean(`freeholder launch: ${error.message}`));
      out.error(redactor.clean(`  ${error.recovery}`));
      return error.code;
    }
    out.error(redactor.clean(`freeholder launch: ${error instanceof Error ? error.message : String(error)}`));
    out.error("  Run the same command again: it continues where it stopped.");
    return LAUNCH_EXIT.failed;
  }
}

function printPlan(options: LaunchOptions, state: LaunchState | null, envPath: string, out: { log: (line: string) => void }) {
  const done = new Set(state?.done ?? []);
  const plan = {
    preflight: "check the account, SSH key, region and size",
    image: options.image ? `pin ${options.image}` : "pin the current edge build's linux/amd64 digest",
    secrets: `generate BOOTSTRAP_SECRET, SESSION_SECRET, CREDENTIAL_KEY and POSTGRES_PASSWORD into ${envPath}`,
    spaces: `create ${options.name}-media and ${options.name}-backups (versioned) in ${options.region}, and a key scoped to both`,
    droplet: `create droplet ${options.name} (${options.size}, ${options.region}, Ubuntu 24.04, monitoring on)`,
    "cloud-init": "wait for the server to finish setting itself up",
    host: options.temporaryHost ? "use a temporary <ip>.sslip.io address" : `serve ${options.domain} if it already points at the server, otherwise a temporary <ip>.sslip.io address`,
    deploy: "copy compose.yml, Caddyfile, backup.sh and .env to /opt/freeholder and start the stack",
    readiness: "wait until /setup answers over a valid certificate",
    backups: "schedule nightly backups and confirm a first one",
  } satisfies Record<Step, string>;
  if (options.json) {
    out.log(JSON.stringify({ dryRun: true, name: options.name, steps: STEPS.map((s) => ({ step: s, done: done.has(s), action: plan[s] })) }, null, 2));
    return;
  }
  out.log(`Plan for ${options.name} (${options.domain}) on DigitalOcean:`);
  for (const step of STEPS) out.log(`  ${done.has(step) ? "done " : "     "} ${plan[step]}`);
  out.log("Nothing was created. Run again without --dry-run to launch.");
}

async function waitForCloudInit(remote: Remote, sleep: (ms: number) => Promise<void>) {
  // SSH is not up the moment the API says "active"; cloud-init keeps working after that.
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await remote.run("cloud-init status");
    if (status.code !== 255 && /status:\s*done/.test(status.stdout)) {
      // cloud-init reports done even when it threw its user-data away (a non-ASCII byte does that), so check what it was meant to install.
      const docker = await remote.run("docker compose version && test -d /opt/freeholder");
      if (docker.code !== 0) throw new LaunchFailure("The server finished setting up without Docker.", "Its cloud-init user-data was not applied. Run `freeholder launch --destroy` for this site and launch again.", LAUNCH_EXIT.failed);
      return;
    }
    if (/status:\s*error/.test(status.stdout)) throw new LaunchFailure("The server's first-boot setup failed.", "Read /var/log/cloud-init-output.log on the server, then destroy and launch again.", LAUNCH_EXIT.failed);
    await sleep(5000);
  }
  throw new LaunchFailure("The server did not finish setting up within ten minutes.", "Run the same command again to keep waiting.", LAUNCH_EXIT.failed);
}

async function waitForReady(remote: Remote, host: string, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>) {
  // Requests during migrations answer 500 ("relation … does not exist"); wait for the app to say so rather than treating that as failure.
  for (let attempt = 0; ; attempt++) {
    const logs = await remote.run("cd /opt/freeholder && docker compose logs app 2>&1 | grep -c 'schema is up to date' || true");
    if (Number.parseInt(logs.stdout.trim(), 10) > 0) break;
    if (attempt >= 180) throw new LaunchFailure("The site's database setup did not finish within fifteen minutes.", `Look at \`docker compose logs app\` on the server, then run the same command again.`, LAUNCH_EXIT.failed);
    await sleep(5000);
  }
  let last = "no answer";
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      // fetch verifies the certificate: an answer at all means TLS is valid.
      const response = await fetcher(`https://${host}/setup`, { redirect: "manual" });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : "no answer";
    }
    await sleep(5000);
  }
  throw new LaunchFailure(`https://${host}/setup did not come up (${last}).`, "If the certificate is the problem, Caddy may still be getting one; run the same command again in a few minutes.", LAUNCH_EXIT.failed);
}

async function setUpBackups(remote: Remote, env: Record<string, string>, provider: LaunchProvider, state: LaunchState, fetcher: typeof fetch) {
  // `set -a` matters: a plain `. .env` does not export, and backup.sh would fail every night unseen.
  await remote.writeFile("/etc/cron.d/freeholder-backup", `${CRON_LINE}\n`, "644");
  const run = await remote.run("cd /opt/freeholder && set -a && . ./.env && set +a && ./backup.sh");
  if (run.code !== 0) throw new LaunchFailure("The first backup failed.", "Run `/opt/freeholder/backup.sh` on the server to see why, then run the same command again.", LAUNCH_EXIT.failed);
  const { endpoint, region } = provider.storageEndpoint(state.region);
  const spaces = new SpacesClient(endpoint, region, { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! }, fetcher);
  const keys = await spaces.listKeys(state.buckets!.backups, "db/");
  const dump = keys.find((k) => k.endsWith(".dump") && keys.includes(`${k}.sha256`));
  if (!dump) throw new LaunchFailure("The first backup is not in the bucket with its checksum.", "Run `/opt/freeholder/backup.sh` on the server, then run the same command again.", LAUNCH_EXIT.failed);
}

async function cutover(options: LaunchOptions, deps: LaunchDeps, dir: string, state: LaunchState | null, env: Record<string, string>, progress: (l: string) => void, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>, resolve4: (h: string) => Promise<string[]>): Promise<number> {
  if (!state?.ip || !state.done.includes("deploy")) throw new LaunchFailure(`There is no launched site named ${options.name}.`, "Launch it first, or pass the --name you launched with.", LAUNCH_EXIT.failed);
  const [apex, www] = await Promise.all([resolve4(options.domain), resolve4(`www.${options.domain}`)]);
  if (!apex.includes(state.ip) || !www.includes(state.ip)) {
    throw new LaunchFailure(`${options.domain} does not point at this server yet.`, `Add A records for ${options.domain} and www.${options.domain} pointing at ${state.ip}, wait for them to resolve, then run the cutover again.`, LAUNCH_EXIT.failed);
  }
  const host = options.domain;
  const next = { ...env, APP_URL: `https://${host}`, FREEHOLDER_DOMAIN: host, FREEHOLDER_PRIMARY_DOMAIN: host };
  const envPath = await writeEnv(dir, next);
  const remote = deps.remote(state.ip, join(dir, "known_hosts"), options.sshIdentity);
  await remote.writeFile("/opt/freeholder/.env", await readFile(envPath, "utf8"), "600");
  const restarted = await remote.run("cd /opt/freeholder && docker compose up -d --force-recreate app caddy");
  if (restarted.code !== 0) throw new LaunchFailure("The site did not restart on its new domain.", "Look at `docker compose logs` on the server, then run the cutover again.", LAUNCH_EXIT.failed);
  for (let attempt = 0; attempt < 120; attempt++) {
    const live = await fetcher(`https://${host}/api/health/live`).then((r) => r.status === 200).catch(() => false);
    if (live) {
      await writeState(dir, { ...state, host, temporaryHost: false, domain: host });
      progress(`✓ The site now answers at https://${host}.`);
      return LAUNCH_EXIT.ok;
    }
    await sleep(5000);
  }
  throw new LaunchFailure(`https://${host} did not come up after the cutover.`, "Caddy may still be getting a certificate; run the cutover again in a few minutes.", LAUNCH_EXIT.failed);
}

async function destroy(options: LaunchOptions, deps: LaunchDeps, dir: string, state: LaunchState | null, progress: (l: string) => void): Promise<number> {
  if (!state) throw new LaunchFailure(`There is no launch record for ${options.name}.`, "Pass the --name you launched with. Nothing was deleted.", LAUNCH_EXIT.failed);
  const answer = options.confirm ?? (options.nonInteractive || !deps.prompt ? "" : await deps.prompt(`This deletes the server for ${state.domain} and its Spaces key (buckets only if empty). Type ${options.name} to confirm: `));
  if (answer.trim() !== options.name) throw new LaunchFailure("Not confirmed. Nothing was deleted.", `Type the site name, or pass --confirm ${options.name}.`, LAUNCH_EXIT.failed);
  await deps.provider.destroy(state, progress);
  await rename(join(dir, "state.json"), join(dir, "state.destroyed.json"));
  progress(`The launch record is kept as ${join(dir, "state.destroyed.json")}; ${join(dir, "freeholder.env")} is kept too.`);
  return LAUNCH_EXIT.ok;
}
