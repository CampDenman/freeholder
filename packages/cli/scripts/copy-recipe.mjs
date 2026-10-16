// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` ships the DigitalOcean droplet recipe it installs. The
// repository's deploy/digitalocean-droplet/infra is the only source; this
// copies it into the package at build time so the two can never drift.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "deploy", "digitalocean-droplet", "infra");
const target = join(here, "..", "recipes", "digitalocean-droplet");
mkdirSync(target, { recursive: true });
for (const file of ["compose.yml", "Caddyfile", "backup.sh", "cloud-init.yml"]) copyFileSync(join(source, file), join(target, file));
