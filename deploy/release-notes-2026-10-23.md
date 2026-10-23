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
- Node.js reports a chain through one of the eight blocked keys as a revoked
  certificate, through its normal verification
  ([nodejs/node#66871](https://github.com/nodejs/node/pull/66871)). Code
  that turns verification off, for example with `rejectUnauthorized: false`
  or `NODE_TLS_REJECT_UNAUTHORIZED=0`, therefore does not get this
  protection. Freeholder's source and deployment files set neither, and
  none sets `NODE_EXTRA_CA_CERTS`. If your own configuration turns
  certificate verification off for a database, mail or storage connection,
  this block does not cover that connection.

## eMudhra certificate key compromise

eMudhra's statement of 21 October 2026 says eight of its intermediate
certificate authorities had weak private keys. The intermediates belong to
its global TLS business and were created at a key ceremony on 30 April
2025. An independent researcher found that the keys could be derived "last
weekend", which was the weekend before the statement. The researcher
reported this to Apple, Google, Microsoft and Mozilla.

Mozilla's NSS 3.131.1 notice says Firefox users were already protected by
a OneCRL update. NSS 3.131.1, released on 20 October 2026, removes the
emSign ECC Root CA - G3 in response to the incident. Press reports add
more detail that the primary sources above do not state:

- six of the intermediates issue TLS certificates and two are for code
  signing;
- Chrome and Firefox blocked them on the day of the report, Apple followed
  on 19 October and Microsoft on 20 October.

Software that keeps its own certificate store and does not read browser
revocation lists needs an update to stop trusting these intermediates.
Node.js is such software, and 22.23.4 is that update.

Sources:

- [eMudhra's statement of 21 October 2026](https://nsearchives.nseindia.com/corporate/EMUDHRA2008_21102026105726_Press_Release_21102026.pdf)
- [Mozilla's dev-tech-crypto notice on NSS 3.131.1](https://groups.google.com/a/mozilla.org/g/dev-tech-crypto/c/vSxZxnOMMvs)
- [nodejs/node#66871](https://github.com/nodejs/node/pull/66871)
- press report: [Help Net Security, 21 October 2026](https://www.helpnetsecurity.com/2026/10/21/emudhra-certificates-private-keys-compromised/)

**Self-hosters must pull or rebuild the image to get this protection.** An
image built before this revision still trusts those intermediates. If you
connect Freeholder to a service whose certificate chains to one of the three
removed emSign roots, those connections will now fail until that service
changes certificates.

## British Columbia time zone

British Columbia has moved to permanent UTC−7. The spring change on 8 March
2026 was its last; on 1 November 2026, when clocks would usually go back,
they stay where they are
([B.C. government release, 2 March 2026](https://news.gov.bc.ca/releases/2026AG0013-000209)).
The communities in eastern B.C. that keep mountain time are not affected.

The tz database added this in release 2026b
([tzdb NEWS](https://github.com/eggert/tz/blob/main/NEWS)). Until CLDR and
ICU can express it, tzdb models the change as taking effect at 02:00 on
1 November 2026. The same NEWS file records three more changes:

- Alberta moved to permanent UTC−6 (2026c).
- The Northwest Territories moved to permanent UTC−6 (2026d).
- Manitoba moves to permanent UTC−5 (2026e).

The Node.js versions involved carry these tz data releases (from each
release's `test/fixtures/tz-version.txt`):

| Node.js | tz data | Has these rules |
| --- | --- | --- |
| 22.23.4 | 2026e | Yes |
| 22.23.2 | 2026a | No |
| 22.20.0 | 2025b | No |

Freeholder works out every local time in Node.js. That includes booking
days and slots, reminders, report buckets and the times on pages. So a
British Columbia business keeps correct times after 1 November only on the
new image. On Node.js 22.23.2, or on the Node.js 22.20.0 that Replit's
current Nix channel provides, B.C. times from 1 November are an hour off:
the app still applies the old UTC−8 winter. The same applies to Alberta,
the Northwest Territories and Manitoba. **This makes the Replit gap below
urgent for any Canadian business in those provinces.**

**Freeholder doctor.** The "Time zone data" check
(`src/core/doctor/timezone.ts`) compares the business's zone in the app and
in Postgres. It warns when they disagree. The warning is not a failure:
pages, reports and reminders all use the app's answer, so they agree with
each other. It matters only for things that read Postgres directly, such as
a hand-run export or a BI tool. Updating the database image's time zone
data clears it.

**Zone labels.** ICU 78.3 still calls a British Columbia winter "Pacific
Daylight Time" (short form "PDT"), because CLDR has no name yet for the new
rule. Booking pages now label zones by their generic name, such as
"Pacific Time (Vancouver)", which is right under either rule. Event times
still print ICU's short name, so a December event in Vancouver reads
"PDT". The time itself is correct.

## Next.js October advisories

Freeholder runs Next.js 16.4.2. It arrived on `main` on 22 October 2026 in
#549 (from 16.3.8). The 14 October Next.js release (16.4.1 and 15.5.28)
fixed the following, so 16.4.2 includes those fixes:

- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
  (Critical): remote code execution in `use cache` functions that return
  typed arrays.
- [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
  (Critical, CVE-2026-96889): remote code execution in the Image
  Optimization API when SVG files are used, on glibc-based Linux. The flaw
  is in an upstream image library, not in Next.js itself. NVD describes
  CVE-2026-96889 as a librsvg flaw. Next.js gives the workaround as using
  `sharp` 0.35.5 or later.
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

**The real protection is the image library itself.** Turning off the
optimizer closes the Next.js route, but Freeholder also calls `sharp`
directly:

- `src/core/media/variants.ts` reads image dimensions and builds
  renditions.
- `src/modules/social/render.ts` crops stills and makes thumbnails, with
  `failOn: "none"`.

So what protects Freeholder from this flaw is the version of `sharp` it
runs, together with its refusal of SVG uploads:

- `pnpm-lock.yaml` locks a single `sharp`, 0.35.5. That is the fixed
  version Next.js names, and Next.js uses the same copy.
- `sharp` 0.35.5 bundles `@img/sharp-libvips` 1.3.4. Its installed
  `versions.json` lists libvips 8.18.7 and librsvg 2.63.2.
- Upload validation (`src/core/media/validation.ts`) has refused SVG by
  extension and by declared type since the media lifecycle landed (#70,
  August 2026).
- Validation accepts images only when the file's own signature is JPEG,
  PNG, GIF, WebP or AVIF. The media and social pipelines pass `sharp` only
  assets stored as images, so visitor-supplied SVG does not reach it
  through them.

Freeholder renders SVG with `sharp` in two places. Both render markup
written by Freeholder's own code:

- `src/core/media/watermark.ts` builds a watermark from the owner's
  watermark text, with that text XML-escaped.
- `src/modules/seed/service.ts` turns the demo illustrations in
  `seed/demo/content` into JPEGs when demo content is installed. Those
  illustrations ship in the repository. The install refuses to run on a
  site that already has pages.

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

- **DigitalOcean droplet:** use `scripts/deploy-droplet.mjs`, as
  described in "Doing it by hand" in `deploy/digitalocean-droplet/deploy.md`.
  It does five things:
  - verifies the image's signed build provenance;
  - selects the linux/amd64 digest;
  - takes a database backup;
  - pins `FREEHOLDER_IMAGE` and keeps the previous pin for rollback;
  - waits for readiness.

  Start with a dry run:

  ```bash
  node scripts/deploy-droplet.mjs --revision <12-char-or-full-sha> --dry-run
  ```

  Then apply it as that document describes.

  There is a fallback, `docker compose pull && docker compose up -d` on the
  droplet with a hand-pinned digest (`deploy/digitalocean-droplet/README.md`).
  It skips provenance verification and the backup, so use it only if you
  cannot run the script.

  To add the edge refusal, merge the two `@nextImage` lines from
  `deploy/digitalocean-droplet/infra/Caddyfile` into your
  `/opt/freeholder/Caddyfile`, so your own edits survive. The Caddy notes
  below apply.

- **Host updater:** apply the new release through the updater
  (`deploy/update-apply.md`). The updater keeps your deployment's own
  `Caddyfile` and does not install the recipe's copy. To add the edge
  refusal, merge the two `@nextImage` lines from
  `deploy/docker-selfhost/docker-updater/Caddyfile` into it. The Caddy
  notes below apply.

  Do not edit the file while an update is running. During an update the
  executor copies your `Caddyfile` aside, swaps in a maintenance page, and
  then writes the copy back. An edit made in between would be lost.

  **Caddy notes, for both droplet and host updater.** These steps are
  optional, because the app already refuses the path.
  - Both recipes mount the single file `./Caddyfile` read-only into the
    Caddy container. Many editors save by replacing the file rather than
    rewriting it. After such a save, the container still sees the old
    content, and `caddy reload` reloads that old content.
  - So either edit the file in place, or recreate Caddy from the deployment
    directory with `docker compose up -d --force-recreate caddy`.
  - Then confirm that `curl -sI https://YOUR-SITE/_next/image` returns
    `404`.

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
effect there. Older versions also miss the 2026 Canadian time zone rules.
Check `node -p process.versions.tz` too. Below `2026b`, British Columbia
times from 1 November 2026 will be an hour off. Below `2026e`, at least
one of the four provinces will be. A business in any of them should not
run on Replit until the runtime is updated.

## Deployment

This update is not deployed yet. The Node.js 22.23.4 image is published
by the normal workflow after this change merges. It will then be deployed,
and that deployment will be recorded in a follow-up note.

The operator's deploy logs record the following state of the live sites.
This repository had not recorded these deployments before.

- **2026-10-23:** freeholder.ai and demo.freeholder.ai were both deployed at
  main revision `b1cabb427405c2f0758de1e6b3f5abf88085abe9`, image

  `ghcr.io/campdenman/freeholder@sha256:34840fcae5bab5fd18c862f842aff0ec8d6c46985aa1335adefd02fac618529a`.

  Both deployments passed signed-provenance verification and readiness.
  Earlier deployments the same day were at `48b2da44` and `fb7a67df`.
- **Next.js fixes:** both sites already include #549 (Next.js 16.4.2) and
  #578 (image optimizer off).
- **Edge refusal:** Caddy on both servers has refused `/_next/image*` since
  2026-10-22. That was added on the servers before this update put the
  refusal in the recipes.

As of this note, neither site was exposed to the Next.js October
advisories. Both sites still run Node.js 22.23.2 until this update is
deployed. The previous recorded deployment is in
`deploy/release-notes-2026-10-17.md`.
