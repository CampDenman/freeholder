# DigitalOcean App Platform (Tier 1)

This recipe provisions the published Freeholder image, a private-bound
PostgreSQL 16 development database and a private Spaces media bucket. For a
production database, change `production` to `true` and supply an existing
managed cluster name in the spec.

## Install

Create a private Spaces bucket and scoped read/write key. Export every variable
listed in `.env.example`; use independent random values for `SESSION_SECRET`
and `CREDENTIAL_KEY`. Then run the `install` command in `recipe.yaml`. The
preparation script replaces template markers in a gitignored mode-0600 file,
and refuses missing inputs. Delete `.freeholder-do-app.yaml` after `doctl`
accepts it.

## Operate

- Verify with `verify.md` and the recipe's `verify` command.
- Back up and restore with the recipe's custom-format `pg_dump`/`pg_restore`
  commands; copy media separately with `pnpm media:transfer`.
- Update by rendering a new spec with a digest-pinned image and running the
  `update` operation. Retain the prior secret-bearing spec outside the repo.
- Roll back with `PREVIOUS_FREEHOLDER_APP_SPEC`, then rerun verification.
- Migrate with `migrate.md`; do not change DNS before database and media
  fingerprints match.
