<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — security advisories 2026-10-23

Product version stays **0.2.0-beta.3**, in active development. These notes
explain one runtime update and how Freeholder stands against the security
advisories published in October 2026. `CHANGELOG.md`, generated from
`.changeset/`, is still the canonical list of changes for owners; this
update's entry is `node-22-23-4-october-2026-advisories.md`. MASTER §43
item: C11.10.

## Summary

- The Freeholder image moves from Node.js 22.23.2 to **22.23.4**, the
  security release of 21 October 2026.
- That release also stops trusting the eMudhra/emSign certificates involved
  in the October key compromise.
- The Next.js advisories of 14 October were already fixed on `main` by
  Next.js 16.4.2 (#549). Next.js's image optimizer is switched off (#578).
  The Caddy proxy recipes now refuse its address as well.
- Freeholder contains no PHP and is not affected by PHP2Shell.
- Self-hosters should pull the image built from this revision and restart.
  Commands are below.

## Node.js 22.23.4

Advisory:
<https://nodejs.org/en/blog/vulnerability/october-2026-security-releases>.
Release notes:
<https://github.com/nodejs/node/releases/tag/v22.23.4>.

The Dockerfile pins every stage (deps, build, runtime) to
`node:22.23.4-bookworm-slim` by its multi-architecture index digest,
`sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
CI and the Forgejo deploy job read the same version from `.node-version`.

Fixes in the 22.x line that matter here:

- **Brotli out-of-bounds write, CVE-2026-111497 (High).** Malformed Brotli
  input decompressed with `node:zlib` could write past a decoder buffer. The
  result could be a crash, leaked memory or code execution.
- **TLS certificate checks for IP addresses: CVE-2026-106069 (High) and
  CVE-2026-106072 (Medium).** An IPv4 address written in a non-canonical
  form, such as `0127.0.0.1` or `127.1`, could be checked against the wrong
  certificate entry. A server could then pass verification for an address
  its certificate does not name.
- **DNS NUL truncation, CVE-2026-105482 (High).** `dns.resolve*()` and
  `dns.reverse()` silently cut a hostname at a NUL byte. They could return
  records for a different name than the one an application checked.
- **Keep-alive response smuggling, CVE-2026-105481 (Medium).** A reused
  HTTP client connection could accept a response that arrived before the
  request was sent.
- **Certificate store.** Node.js now refuses certificate chains that pass
  through the eight compromised eMudhra intermediates
  ([nodejs/node#66871](https://github.com/nodejs/node/pull/66871)). Its
  bundled root store moves to NSS 3.131.1, which removes emSign ECC Root CA -
  G3, emSign Root CA - C1 and emSign ECC Root CA - C3
  ([nodejs/node#66877](https://github.com/nodejs/node/pull/66877)).
- **Bundled libraries.** OpenSSL 3.5.9, undici 6.29.1, c-ares 1.34.9 and
  SQLite 3.53.4.

The same release fixes CVE-2026-106074 (Medium) and CVE-2026-106073 (Low).
The first affects startup snapshots and single-executable builds; the second
affects the Permission Model. Freeholder uses neither, but the image picks
up both fixes. CVE-2026-105483 does not affect the 22.x line.

**Why it matters for Freeholder.** The server makes outbound TLS
connections to payment providers, mail providers and the S3-compatible
storage that holds its media. It also calls OAuth, calendar, web-push and
update-feed endpoints over HTTPS. Each of those connections depends on
Node.js checking certificates correctly and parsing responses safely.

### Certificate configuration in the image

- Freeholder does not set `NODE_USE_SYSTEM_CA`, `NODE_EXTRA_CA_CERTS`,
  `--use-system-ca` or `--use-openssl-ca` anywhere in the repository. Node.js
  therefore uses its own bundled store, which this update replaces.
- The runtime image does not include Debian's `ca-certificates` package. The
  upstream `node:*-bookworm-slim` image removes it after installing Node.js,
  and the 22.23.4 image's package database confirms this. So there is no
  Debian certificate bundle in the image to update.
- The compiled-in block on the eight intermediates applies to every TLS
  context Node.js creates. It still applies if you add your own CA
  certificates with `NODE_EXTRA_CA_CERTS`.

## eMudhra certificate key compromise

The private keys of eight eMudhra (emSign) intermediate certificate
authorities were reported compromised on 17 October 2026. Six were used for
TLS and two for code signing. Chrome and Firefox blocked the TLS
intermediates through their revocation lists that day; other vendors
followed over the next three days. Software that keeps its own certificate
store and does not read browser revocation lists, as Node.js does, needs
an update to stop trusting them. Node.js 22.23.4 is that update.

Sources: the Node.js advisory above;
[Mozilla's dev-tech-crypto notice on NSS 3.131.1](https://groups.google.com/a/mozilla.org/g/dev-tech-crypto/c/vSxZxnOMMvs);
[eMudhra's press release of 21 October 2026](https://nsearchives.nseindia.com/corporate/EMUDHRA2008_21102026105726_Press_Release_21102026.pdf).

**Self-hosters must pull or rebuild the image to get this protection.** An
image built before this revision still trusts those intermediates. If you
connect Freeholder to a service whose certificate chains to one of the three
removed emSign roots, those connections will now fail until that service
changes certificates.

## Next.js October advisories

Freeholder runs Next.js 16.4.2. It arrived on `main` on 22 October 2026 in
#549 (from 16.3.8). The 14 October Next.js release (16.4.1 and 15.5.28)
fixed the following, so 16.4.2 includes those fixes:

- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
  (Critical): remote code execution in `use cache` functions that return
  typed arrays.
- [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
  (Critical, CVE-2026-96889): remote code execution in the Image
  Optimization API when SVG files are used. Next.js lists this CVE on its
  advisory. NVD describes CVE-2026-96889 as the underlying librsvg flaw.
- [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
  (High, CVE-2026-94482): denial of service in App Router applications that
  use Server Actions.

**Image optimizer.** Freeholder never used Next.js's image optimizer.
Pictures are prepared by its own media service. Since #578,
`next.config.ts` sets `images: { unoptimized: true }`, so `/_next/image`
answers 404 on every kind of hosting. `tests/core/security-headers.test.ts`
checks that setting and that no code imports `next/image`.

Before this update, the Caddy recipes in `deploy/` did **not** refuse
`/_next/image` themselves. This update adds that refusal to:

- the droplet `Caddyfile`;
- the host-updater `Caddyfile`;
- the playground site file and the snippet in its README.

Caddy now answers 404 for that path without contacting the app.
`tests/core/deploy-recipe.test.ts` checks every one of them. Recipes without
Caddy rely on the Next.js setting alone: the plain Docker Compose recipe,
App Platform, Render, Railway and Replit.

Freeholder also refuses SVG uploads. Its only SVG rendering is the
watermark text it generates itself, with the text escaped.

**CVE-2026-75604**
([GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
August 2026) affects only Next.js servers hosted on Windows. Freeholder's
supported images are Linux. The fix shipped in 16.3.3, so the current
version includes it too.

## PHP2Shell (CVE-2026-109618 and CVE-2026-109619)

These are flaws in the PHP interpreter
([GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w),
[GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)).
Freeholder contains no PHP code, and its images do not install PHP. It is
not affected.

## What self-hosters should do

Update to the image built from this revision, or any later one, and
restart. Migrations travel inside the image. Keep your current image digest
so you can roll back.

- **Docker Compose** (`deploy/docker-selfhost`): set `FREEHOLDER_IMAGE` to
  the new digest. Keep the old one as `PREVIOUS_FREEHOLDER_IMAGE`. Then run
  the recipe's `update` operation:

  ```bash
  docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.yml pull && docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.yml up -d
  ```

- **DigitalOcean droplet:** pin `FREEHOLDER_IMAGE` to
  `ghcr.io/campdenman/freeholder@sha256:<64 hex>`. Use the linux/amd64
  digest, not the tag's index digest. Then run:

  ```bash
  ssh root@DROPLET_IP 'cd /opt/freeholder && docker compose pull && docker compose up -d'
  ```

  Alternatively, follow "Doing it by hand" in
  `deploy/digitalocean-droplet/deploy.md`. It starts with
  `node scripts/deploy-droplet.mjs --revision <12-char-or-full-sha> --dry-run`
  and verifies, backs up and pins the image for you.

  To add the edge refusal, copy the updated
  `deploy/digitalocean-droplet/infra/Caddyfile` to
  `/opt/freeholder/Caddyfile`. Then run
  `docker compose up -d --force-recreate caddy`. This step is optional:
  the app already refuses the path.

- **Host updater:** apply the new release through the updater
  (`deploy/update-apply.md`). The updater keeps your deployment's own
  `Caddyfile` and does not install the recipe's copy. To add the edge
  refusal, merge the two `@nextImage` lines from
  `deploy/docker-selfhost/docker-updater/Caddyfile` into it. Then reload
  Caddy from the deployment directory with
  `docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
  This step is optional, as for the droplet.
- **Render, Railway, DigitalOcean App Platform:** run each recipe's
  `update` operation with the new image tag or digest (`recipe.yaml` in
  `deploy/render`, `deploy/railway`, `deploy/digitalocean-app`).
- **Replit:** see the note below.

After updating, complete the recipe's `verify.md`. At minimum, check
`GET /api/health` and confirm that `/_next/image` answers 404.

To confirm the running Node.js version, use the app container. For the
Compose recipe:
`docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.yml exec app node --version`
should print `v22.23.4`.

### Replit

Replit does not use the Docker image. `.replit` asks for Replit's
`nodejs-22` module, and `replit.nix` asks for `nodejs_22` from the
`stable-25_05` Nix channel. Neither names a patch release, so Freeholder
cannot pin 22.23.4 there. On 23 October 2026, nixpkgs `release-25.05`
carried Node.js 22.20.0, and `release-26.05` carried 22.23.4. This update
does not change Replit's channel; that needs a tested change of its own.

Replit owners should run `node --version` in their Deployment. If it
reports a version older than 22.23.4, Node.js's fixes above are not in
effect there.

## Deployment

This is a pull request, not a deployment. The new image is published by the
normal workflow after it merges. The last freeholder.ai deployment recorded
in this repository is revision `5af2cf0c`, from 17 October 2026
(`deploy/release-notes-2026-10-17.md`). That revision predates #549, #578 and
this update. Any later redeploy will be recorded in its own release notes.
