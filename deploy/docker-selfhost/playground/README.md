# Public playground (C1.38)

This is a separate disposable installation, never a switch to turn on in a client
database. All visitors share a restricted account and can edit sample pages,
forms, products, contacts, notes and tasks. The banner warns that data is public
and resets hourly. Do not enter personal data. Account administration, uploads,
payments, email/SMS delivery and host changes are refused by the service layer.

The recipe requires Linux Docker Compose and an existing HTTPS reverse proxy.
Copy `compose.yml` and `reset.sh` to `/opt/freeholder-playground`. Create a
root-readable `.env` containing a verified `FREEHOLDER_IMAGE=...@sha256:...`,
`PLAYGROUND_DOMAIN`, and independent random hex values for
`PLAYGROUND_DB_PASSWORD` and `PLAYGROUND_SESSION_SECRET`. Do not copy production
environment variables. Create the dedicated proxy network:

```sh
docker network create --internal freeholder-playground-proxy
chmod 700 /opt/freeholder-playground/reset.sh
chmod 600 /opt/freeholder-playground/.env
```

Attach only the HTTPS proxy to that network. The playground app joins it under
the alias `playground-app` only when `reset.sh` has seen it ready, so a plain
`docker compose up` is not reachable from the proxy. Add this site to Caddy
(replace the hostname), keeping the main site's configuration intact:

```caddyfile
demo.example.com {
  encode zstd gzip
  header X-Robots-Tag "noindex, nofollow"
  request_body {
    max_size 64KB
  }
  reverse_proxy playground-app:3000 {
    header_up X-Freeholder-Client-Ip {client_ip}
    lb_try_duration 20s
    lb_try_interval 500ms
    transport http {
      dial_timeout 2s
      response_header_timeout 120s
      max_conns_per_host 16
    }
  }
  handle_errors 502 503 504 {
    header Retry-After 30
    header Cache-Control no-store
    respond "The demo is resetting or busy. Please try again in a minute." 503
  }
}
```

The `header_up` line is required: the playground app trusts
`X-Freeholder-Client-Ip` (`TRUSTED_CLIENT_IP_HEADER` in `compose.yml`) for its
rate limits, and Caddy must overwrite it on every request so a visitor cannot
supply their own. If your proxy cannot overwrite it, remove
`TRUSTED_CLIENT_IP_HEADER` from the playground compose file.

For the project's own `demo.freeholder.ai` on the DigitalOcean production
droplet, the checked-in `demo.freeholder.ai.caddy` is that Caddy site. The host
needs enough spare memory for the two bounded playground containers as well as
the production stack. Add `compose.proxy-overlay.yml` beside the production
`compose.yml` as `compose.playground.yml`, then put
`COMPOSE_FILE=compose.yml:compose.playground.yml` in the production `.env`.
This keeps Caddy attached to the internal proxy network after future Compose
deployments while leaving the production app and database on their own network.
Run `docker compose --env-file .env config` in `/opt/freeholder` before
recreating Caddy. The playground still uses its own `/opt/freeholder-playground`
Compose project and `.env`; never copy production secrets into it. Point demo
DNS at the host only after the playground boots, a visitor can edit a sample
page, egress is blocked, and a reset recovers the editor.

Copy the reset and heal services and timers to `/etc/systemd/system`, run
`systemctl daemon-reload`, then `systemctl enable --now freeholder-playground-reset.timer
freeholder-playground-heal.timer` and `systemctl start freeholder-playground-reset.service`.
The fixed reset script alternates between the two fixed projects
`freeholder-playground` and `freeholder-playground-b`: it boots the fresh one
while the current one serves, waits for readiness (health, jobs, the entry page
and a warm home page), gives it the proxy alias, then stops the old one. The serving
project is whichever app holds the proxy network. Until the hand-over, any
failure removes the fresh stack and the previous playground keeps serving.
When the host has less than `PLAYGROUND_OVERLAP_MIN_MB` available, the old
playground stops first instead. The default, 2200, is the second stack's caps
(1,408 MB) plus about 800 MB left for production's growth and page cache, so
a reset never borrows memory production may need. Every two minutes the heal
timer runs `reset.sh --heal`, which resets only when nothing is serving or
Docker reports the app unhealthy. The app's health check is readiness, which
reads the database, so a database restarted empty after an out-of-memory kill
is rebuilt within minutes rather than at the next hourly reset. Its PostgreSQL data and media use bounded tmpfs
mounts. The app filesystem is read-only. Both networks
are internal: external delivery is blocked even if a background listener runs.
The existing main-site network must never be attached to the demo app or database.

Verify `/playground`, sign in with the entry button, edit a page, and exercise a
forbidden operation. Run a reset and verify the old session/content disappears.
Check network membership and blocked outbound connections before exposing it.
`FREEHOLDER_PLAYGROUND_URL=https://demo.example.com/playground` optionally adds a
demo link on the main project website. Leave it unset on normal client sites.

This is a shared sandbox with a global 300 mutations/minute cap, per-surface
row caps (pages, sections, forms, contacts, products, notes and tasks refuse
creates once full until the next reset), and no upload staging at all — not a
private workspace. A visitor may overwrite another visitor's work.
Availability is bounded by the reset and container limits; this recipe is not
a multi-tenant hosting service. Update its pinned image explicitly and reset
after an upgrade.

The service layer also fails closed on outbound delivery: queued mail, SMS
and webhook deliveries are refused with a playground reason before any
provider or endpoint is contacted, so a background job can never make this
box send — the internal-only networks above are the outer bound, not the
only one.

## Capacity on a shared host

The project's own demo shares a 4 GB / 2 vCPU droplet with production, so the
recipe is written for the demo to slow down, and under host pressure to die,
before production does. `compose.yml` gives both playground containers
`cpu_shares: 256` (production's default is 1024, so production wins CPU four
to one under contention), `oom_score_adj: 1000` (a host out-of-memory kill
picks the playground first), swap disabled, and `restart: unless-stopped` (an
out-of-memory kill recovers in seconds rather than at the next reset). The
hard caps total 1,408 MB: 896 MB for the app with a fixed 384 MB heap, and
512 MB for a database tuned for tmpfs. Job workers poll every 15 seconds.
Caddy compresses responses, queues a burst at 16 connections to the app
rather than rendering everything at once, retries for 20 seconds while the
app is being swapped or restarted, and otherwise answers a short plain-text
503 with `Retry-After`.

Anonymous, cookie-less visits to the sample site's pages carry
`Cache-Control: public, max-age=0, s-maxage=10, stale-while-revalidate=30`
and no cookies, so a CDN in front of the demo can absorb a traffic spike.
Signed-in visitors, query strings, the entry page and every app route stay
`private, no-store`. Stock Caddy does not cache, so without a CDN the header
changes nothing on the host. With one, every visitor served the same cached
copy also shares its Content-Security-Policy nonce for up to forty seconds.
That weakens the nonce only against markup injected into that same cached
response; query strings, which reflected injection would need, are never
cached, and stored content is re-rendered with a fresh nonce.

Measured locally on 2026-10-21 under a 1-CPU, 768/896 MB cgroup: about 27
anonymous page renders and 30 admin
renders a second per CPU, unchanged by this recipe; idle database
transactions down from ~70 to ~17 a second; a 48-connection burst peaked at
736 of 768 MB before and 649 of 896 MB after; memory flat over a three-minute
mixed soak, so the ~630 MB the demo shows is its working set, not a leak.

What configuration cannot fix is that the demo shares a kernel, disk, Caddy
and TLS with production. For a launch, put a CDN in front of
`demo.example.com` (with Caddy's global `trusted_proxies` naming the CDN's
address ranges and `client_ip_headers` its client-address header, so rate
limits still see visitors), or move the playground to its own small host and
point its DNS there.
