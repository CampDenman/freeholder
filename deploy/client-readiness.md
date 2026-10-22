# Client deployment requirements

Readiness repair, 2026-09-21 (MASTER.md C1.03, C1.05, C6.08, C6.11,
C9.09, C9.12, C10.06, C10.10, C11.10).

Before exposing a fresh production instance, configure an independent random
`BOOTSTRAP_SECRET` of at least 32 characters in the deployment environment.
Generate one with `openssl rand -hex 32`, store it privately, and enter it in
the setup form. API setup callers supply `bootstrapSecret` alongside email and
password. Keep it in private deployment settings for subsequent recipe deployments;
existing users do not enter it at login. If you unset it, remove the variable
entirely instead of leaving an empty value in the environment.
Development and test instances without a configured secret retain local setup.

The deployment examples and scaffold require this secret. Render generates it;
retrieve it from the private environment settings before setup. The App Platform
spec preparation script requires it. Never put the generated secret in Git.

Public waitlist enrollment now returns only `{ "ok": true }`, including repeat
requests. Read entry IDs and status through authenticated waitlist services.
Referral touches may still use an anonymous visitor identifier, but binding a
contact requires that contact's signed-in user or explicit referral write scope.

Forms limit repeated validated submissions by signed-in user, explicitly trusted
proxy address, validated email, or identical answers. Invalid answers do not
consume another visitor's bucket. This application limit is not a network flood
defense. Configure edge request limits for public endpoints. Only configure
`TRUSTED_CLIENT_IP_HEADER` when the proxy overwrites the named header and direct
access to the application is blocked. Supported headers are
`x-freeholder-client-ip`, `cf-connecting-ip`, `x-real-ip`, `do-connecting-ip`
and `x-forwarded-for`. The last is for an edge that appends to
X-Forwarded-For rather than replacing it: the address is read
`TRUSTED_PROXY_HOPS` entries from the right (default 1, the address the last
proxy saw), so entries a visitor wrote on the left are ignored, and a list
shorter than the hop count or a malformed entry at that position yields no
trusted address. Client-supplied forwarding headers are not trusted by default.

The Caddy recipes (DigitalOcean droplet, Docker host-updater, playground) set
`X-Freeholder-Client-Ip` from Caddy's `{client_ip}` on every request and
configure `TRUSTED_CLIENT_IP_HEADER=x-freeholder-client-ip`; their app port is
not published. `{client_ip}` is the connecting address unless Caddy's global
`trusted_proxies` option names a fronting proxy, so the default is correct for
a directly exposed droplet. If a CDN sits in front of Caddy, that address is
the CDN's, and per-visitor limits group by CDN edge until `trusted_proxies` is
configured for that CDN's published ranges. The plain Docker Compose recipe (`docker-selfhost/infra`)
publishes port 3000 directly and sets no trusted header; only set one after
putting an overwriting proxy in front and blocking direct access.

Managed platforms, checked against each platform's own documentation on
2026-10-22:

- **DigitalOcean App Platform** sets `TRUSTED_CLIENT_IP_HEADER=do-connecting-ip`
  in `digitalocean-app/infra/app.yaml`. DigitalOcean documents that App
  Platform adds `do-connecting-ip` with the client's address and uses
  X-Forwarded-For for its own ingress server
  (https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/).
  Apps are reachable only through that ingress.
- **Railway** sets `TRUSTED_CLIENT_IP_HEADER=x-real-ip` in
  `.railway/railway.ts`. Railway documents `X-Real-IP` "for identifying
  client's remote IP" among the headers its edge sets
  (https://docs.railway.com/networking/public-networking/specs-and-limits).
  The page does not say in words that a visitor's own X-Real-IP is replaced;
  Railway staff answers on its community forum say the edge overwrites it, and
  some users report it carrying a CDN address for some traffic, which groups
  those visitors together rather than separating them.
- **Render** sets nothing. Render's documentation names no client-address
  header and no proxy depth. A 2021 staff reply on its feedback board says the
  first X-Forwarded-For entry is the client, while users report Render appends
  to a visitor's own X-Forwarded-For, so the first entry is forgeable and the
  right-hand depth is undocumented
  (https://feedback.render.com/features/p/send-the-correct-xforwardedfor).
- **Replit** sets nothing. Replit says deployments "support the
  X-Forwarded-For Header" (https://replit.com/blog/deployments-updates) but
  documents neither whether it overwrites or appends nor how many proxies sit
  in front.

An operator who confirms an appending edge's depth for their own deployment can
set `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` with that `TRUSTED_PROXY_HOPS`;
the recipes do not guess it. Without a trusted header,
anonymous limits key on the forwarded address (forgeable, so each service also
has a site-wide ceiling for unvalidated callers) rather than one shared bucket
(C11.10).

Free event registrations remain supported. Events with tickets require an active
ticket belonging to that event. Paid registrations are currently refused before
contact creation, reservation, or charging: payment settlement has not been
integrated. Reconcile any existing paid-event confirmations made by older builds
against actual payment records before admitting attendees.
Legacy paid or invalid ticket registrations are also blocked from automatic
promotion and check-in; verifying old payments does not enable the missing flow.

Automatic apply and rollback are disabled. Use [the operator update procedure](update-apply.md).
Previous update history and 64-byte snapshot fingerprints are not evidence of a
backup, a completed deployment, or successful rollback. Do not delete them as
part of this repair; retain them as historical records with that limitation.

Before client launch, exercise the site's enabled workflows on staging and
restore a real database backup into a separate database. Container/provider
deployment, email delivery, payment settlement, and restore tests must use the
actual target configuration. Local tests cannot certify those external systems.
