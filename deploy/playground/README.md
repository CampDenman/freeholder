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

Attach only the HTTPS proxy to that network. Add this site to Caddy (replace the
hostname), keeping the main site's configuration intact:

```caddyfile
demo.example.com {
  header X-Robots-Tag "noindex, nofollow"
  request_body { max_size 64KB }
  reverse_proxy playground-app:3000
}
```

Copy the reset service and timer to `/etc/systemd/system`, run
`systemctl daemon-reload`, then `systemctl enable --now freeholder-playground-reset.timer`
and `systemctl start freeholder-playground-reset.service`.
The fixed reset script recreates only project `freeholder-playground`, waits for
readiness, and returns failure if initialization fails. Its PostgreSQL data and
media use bounded tmpfs mounts. The app filesystem is read-only. Both networks
are internal: external delivery is blocked even if a background listener runs.
The existing main-site network must never be attached to the demo app or database.

Verify `/playground`, sign in with the entry button, edit a page, and exercise a
forbidden operation. Run a reset and verify the old session/content disappears.
Check network membership and blocked outbound connections before exposing it.
`FREEHOLDER_PLAYGROUND_URL=https://demo.example.com/playground` optionally adds a
demo link on the main project website. Leave it unset on normal client sites.

This is a shared sandbox with a global 300 mutations/minute cap, not a private
workspace. A visitor may overwrite another visitor's work. Availability is
bounded by the reset and container limits; this recipe is not a multi-tenant
hosting service. Update its pinned image explicitly and reset after an upgrade.
