# Railway (Tier 1)

`.railway/railway.ts` is Railway's current TypeScript IaC contract. It defines
the public image-backed service, PostgreSQL and a private Storage Bucket, and
wires typed database/S3 references. Railway's older `railway.toml` format is
not used.

## Install

Install Railway CLI 5.42.1 or newer, authenticate and link an environment. Run
`railway config plan`, inspect the diff, then `railway config apply`. Set
`APP_URL`, a 32+ character `SESSION_SECRET` and the base64 `CREDENTIAL_KEY` on
`freeholder-web`; the IaC `preserve()` entries retain them on later applies.
Generate/attach a public domain, set `APP_URL` to its HTTPS origin and redeploy.

## Operate

- Verify with `verify.md` and the recipe's `verify` command.
- Use the recipe's `backup`/`restore`; the CLI injects the linked database
  variable. Media moves through `pnpm media:transfer` with virtual-hosted S3.
- Run `config plan` before every `update`. Pin a release digest rather than an
  edge tag for production; roll back by restoring the prior digest in IaC and
  applying it, then verify.
- Follow `migrate.md` before moving DNS or deleting the old environment.
