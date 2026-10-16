// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// DigitalOcean for `freeholder launch`: a droplet running the
// deploy/digitalocean-droplet recipe, with media and backups in Spaces.
//
// Spaces buckets are created over S3, which needs S3 credentials, and a key
// cannot be scoped to a bucket that does not exist yet ("invalid grant"). So a
// short-lived full-access key creates the two buckets, the permanent key is
// then scoped to just those, and the short-lived key is deleted — always,
// in `finally`, and again on the next run if that deletion ever failed.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SpacesClient } from "./s3.js";
import { LaunchFailure, type LaunchOptions, type LaunchProvider, type LaunchState } from "./types.js";

const API = "https://api.digitalocean.com";
export const EXIT_FAILED = 2;
export const EXIT_UNREACHABLE = 3;

/** DIGITALOCEAN_TOKEN, or the token of the user's current (or named) doctl context. */
export async function digitalOceanToken(context?: string, env: Record<string, string | undefined> = process.env, home = homedir()): Promise<string | null> {
  if (env.DIGITALOCEAN_TOKEN && !context) return env.DIGITALOCEAN_TOKEN;
  const paths = [join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "doctl", "config.yaml"), join(home, "Library", "Application Support", "doctl", "config.yaml")];
  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const current = context ?? /^context:\s*(\S+)/m.exec(text)?.[1] ?? "default";
    if (current === "default") {
      const top = /^access-token:\s*(\S+)/m.exec(text)?.[1];
      if (top) return top;
    }
    const start = lines.findIndex((l) => /^auth-contexts:/.test(l));
    if (start >= 0) {
      for (const line of lines.slice(start + 1)) {
        if (!/^\s/.test(line)) break;
        const match = /^\s+([^:\s]+):\s*(\S+)/.exec(line);
        if (match && match[1] === current) return match[2]!;
      }
    }
  }
  return null;
}

export function digitalOcean(token: string, fetcher: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): LaunchProvider {
  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new LaunchFailure("DigitalOcean could not be reached.", "Check your network connection and run the same command again; it continues where it stopped.", EXIT_UNREACHABLE);
    }
    if (response.status === 401) throw new LaunchFailure("DigitalOcean refused the token.", "Set DIGITALOCEAN_TOKEN to a token with write scope, or run `doctl auth init`.", EXIT_UNREACHABLE);
    if (response.status === 204) return undefined as T;
    const value = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new LaunchFailure(`DigitalOcean refused ${method} ${path.split("?")[0]}: ${value.message ?? response.status}.`, "Fix what the message says and run the same command again.", EXIT_FAILED);
    return value;
  }

  const spacesEndpoint = (region: string) => ({ endpoint: `https://${region}.digitaloceanspaces.com`, region });

  async function createKey(name: string, grants: { bucket: string; permission: string }[]) {
    const { key } = await api<{ key: { access_key: string; secret_key: string } }>("POST", "/v2/spaces/keys", { name, grants });
    return key;
  }
  const deleteKey = (accessKey: string) => api<void>("DELETE", `/v2/spaces/keys/${encodeURIComponent(accessKey)}`);

  return {
    id: "digitalocean",
    storageEndpoint: spacesEndpoint,

    async preflight(options, state) {
      const notes: string[] = [];
      await api<{ account: { status: string } }>("GET", "/v2/account");
      const { ssh_keys: keys } = await api<{ ssh_keys: { id: number; fingerprint: string; name: string }[] }>("GET", "/v2/account/keys?per_page=200");
      const key = options.sshKey ? keys.find((k) => String(k.id) === options.sshKey || k.fingerprint === options.sshKey) : keys.length === 1 ? keys[0] : undefined;
      if (!key) {
        throw new LaunchFailure(
          options.sshKey ? `No SSH key ${options.sshKey} on this DigitalOcean account.` : keys.length ? "This account has several SSH keys; say which one." : "This DigitalOcean account has no SSH key.",
          keys.length ? `Pass --ssh-key with one of: ${keys.map((k) => `${k.id} (${k.name})`).join(", ")}.` : "Add one with `doctl compute ssh-key import`, then run again.",
          EXIT_FAILED,
        );
      }
      const { regions } = await api<{ regions: { slug: string; available: boolean; sizes: string[] }[] }>("GET", "/v2/regions?per_page=200");
      const region = regions.find((r) => r.slug === options.region);
      if (!region?.available) throw new LaunchFailure(`The region ${options.region} is not available.`, `Pick one of: ${regions.filter((r) => r.available).map((r) => r.slug).join(", ")}.`, EXIT_FAILED);
      if (!region.sizes.includes(options.size)) throw new LaunchFailure(`The size ${options.size} is not offered in ${options.region}.`, `Pick one of: ${region.sizes.slice(0, 12).join(", ")}.`, EXIT_FAILED);
      // A droplet with this name that this launch did not create is someone else's.
      const { droplets } = await api<{ droplets: { id: number; name: string }[] }>("GET", `/v2/droplets?name=${encodeURIComponent(options.name)}`);
      const clash = droplets.find((d) => d.name === options.name && d.id !== state?.dropletId);
      if (clash) throw new LaunchFailure(`A droplet named ${options.name} already exists (${clash.id}) and this launch did not create it.`, "Choose another --name, or remove that droplet first.", EXIT_FAILED);
      if (state?.dropletId) notes.push(`Resuming the launch of ${options.name}.`);
      return { sshKeyId: key.id, notes };
    },

    async storage(options, state, save) {
      const { endpoint, region } = spacesEndpoint(options.region);
      const buckets = { media: `${options.name}-media`, backups: `${options.name}-backups` };
      if (state.orphanTemporaryKeyId) {
        await deleteKey(state.orphanTemporaryKeyId).catch(() => undefined);
        await save({ orphanTemporaryKeyId: undefined });
      }
      if (state.spacesKeyId && state.buckets) return;
      const temporary = await createKey(`${options.name}-launch-temporary`, [{ bucket: "", permission: "fullaccess" }]);
      await save({ orphanTemporaryKeyId: temporary.access_key });
      try {
        const spaces = new SpacesClient(endpoint, region, { accessKeyId: temporary.access_key, secretAccessKey: temporary.secret_key }, fetcher);
        await spaces.createBucket(buckets.media);
        await spaces.createBucket(buckets.backups);
        await spaces.enableVersioning(buckets.backups);
        await save({ buckets });
        // A permanent key from an interrupted run whose secret never reached the env file is useless: replace it.
        if (state.spacesKeyId) await deleteKey(state.spacesKeyId).catch(() => undefined);
        const permanent = await createKey(`${options.name}-rw`, [
          { bucket: buckets.media, permission: "readwrite" },
          { bucket: buckets.backups, permission: "readwrite" },
        ]);
        await save({ spacesKeyId: permanent.access_key }, {
          FREEHOLDER_STORAGE: "s3",
          S3_BUCKET: buckets.media,
          S3_ENDPOINT: endpoint,
          S3_REGION: region,
          S3_ADDRESSING_STYLE: "path",
          S3_ACCESS_KEY_ID: permanent.access_key,
          S3_SECRET_ACCESS_KEY: permanent.secret_key,
          BACKUP_BUCKET: buckets.backups,
        });
      } finally {
        try {
          await deleteKey(temporary.access_key);
          await save({ orphanTemporaryKeyId: undefined });
        } catch {
          // Recorded in state; the next run deletes it before anything else.
        }
      }
    },

    async server(options, state, userData, save) {
      let id = state.dropletId;
      if (!id) {
        const { droplet } = await api<{ droplet: { id: number } }>("POST", "/v2/droplets", {
          name: options.name,
          region: options.region,
          size: options.size,
          image: "ubuntu-24-04-x64",
          ssh_keys: [state.sshKeyId],
          user_data: userData,
          monitoring: true,
          tags: ["freeholder", `freeholder-${options.name}`],
        });
        id = droplet.id;
        await save({ dropletId: id });
      }
      for (let attempt = 0; attempt < 120; attempt++) {
        const { droplet } = await api<{ droplet: { status: string; networks: { v4: { ip_address: string; type: string }[] } } }>("GET", `/v2/droplets/${id}`);
        const ip = droplet.networks.v4.find((n) => n.type === "public")?.ip_address;
        if (droplet.status === "active" && ip) {
          await save({ ip });
          return { id, ip };
        }
        await sleep(5000);
      }
      throw new LaunchFailure("The droplet did not become active within ten minutes.", "Check it in the DigitalOcean console, then run the same command again.", EXIT_FAILED);
    },

    async destroy(state, log) {
      if (state.dropletId) {
        await api<void>("DELETE", `/v2/droplets/${state.dropletId}`).catch((error: unknown) => {
          if (!(error instanceof LaunchFailure && /404|not found/i.test(error.message))) throw error;
        });
        log(`Deleted droplet ${state.dropletId}.`);
      }
      if (state.buckets) {
        // Buckets are deleted only when empty: media and backups are the owner's data.
        const temporary = await createKey(`${state.name}-destroy-temporary`, [{ bucket: "", permission: "fullaccess" }]);
        try {
          const { endpoint, region } = spacesEndpoint(state.region);
          const spaces = new SpacesClient(endpoint, region, { accessKeyId: temporary.access_key, secretAccessKey: temporary.secret_key }, fetcher);
          for (const bucket of [state.buckets.media, state.buckets.backups]) {
            log((await spaces.deleteEmptyBucket(bucket)) ? `Deleted the empty bucket ${bucket}.` : `Kept ${bucket}: it still holds files. Empty it in the DigitalOcean console to remove it.`);
          }
        } finally {
          await deleteKey(temporary.access_key).catch(() => log(`Could not delete the temporary Spaces key ${temporary.access_key}; delete it in the console.`));
        }
      }
      if (state.spacesKeyId) {
        await deleteKey(state.spacesKeyId).catch(() => undefined);
        log("Deleted the site's Spaces key.");
      }
    },
  };
}

export type { LaunchOptions, LaunchState };
