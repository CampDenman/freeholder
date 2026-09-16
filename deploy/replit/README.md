# Replit (Tier 1)

The root `.replit` and `replit.nix` define a Node 22/PostgreSQL workspace and a
production Deployment. Workspace storage is ephemeral; media uses private
Replit Object Storage through the official SDK.

## Install

Import the repository, create Replit Postgres and Object Storage, and add the
variables from `.env.example` to Secrets. Set `FREEHOLDER_STORAGE=replit` and
`REPLIT_BUCKET_ID` when Replit does not inject the default bucket. Run the
recipe's `install` command, then publish a Deployment using the checked-in
`[deployment]` build/run commands. A sleeping development workspace is not the
production target.

## Operate

- Complete `verify.md` against the Deployment URL.
- Run the recipe's `backup`/`restore` from the Shell with the database URL.
  `pnpm media:transfer` copies and byte-verifies Object Storage during moves.
- Update by pulling a reviewed release and rebuilding. Roll back by checking
  out the prior signed release tag, rebuilding and republishing.
- Use `migrate.md`; do not copy media through workspace disk as the durable
  migration mechanism.
