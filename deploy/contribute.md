# Contribution channel

The instance can file a bug, feature request or question with the project.
Nothing is sent until `contribute.submit` runs. The daily update check is a
separate, identity-free GET and is not this path.

## Spoke (every instance)

- `contribute.getSettings` / `contribute.updateSettings` — `hubUrl` defaults
  to `https://freeholder.ai`. An empty URL files locally only.
- `contribute.submit` writes a local row. If the hub is this instance, the
  row is `received`. Otherwise a `contribute.deliver` job POSTs
  `/api/v1/contribute.ingest`.
- Agents need an explicit `contribute.*` scope. `contacts.*` is not enough.
- An optional doctor snapshot is stored only when the caller attaches one.
  Secrets in that snapshot are redacted.

## Hub (off by default)

Turn ingest on with `contribute.updateSettings({ hubEnabled: true })`.
Until then `contribute.ingest` is 404.

Rotate `receiveSecret` (step-up) if spokes should HMAC their deliveries
with the same scheme as outbound webhooks. Unsigned public ingest remains
rate-limited.

Security-kind reports are refused. Use `SECURITY.md`.

## Determinations

`contribute.determine` may cite a `C#.##` checklist id. It never edits
`MASTER.md`. Product work still lands in §43 in a later PR.
