# Replit (Tier 1)

The root `.replit` and `replit.nix` define a Node 22/PostgreSQL workspace and a
production Deployment. Workspace storage is ephemeral; media uses private
Replit Object Storage through the official SDK.

## Start here: import, then reset

Replit's **Import from GitHub** runs an agentic importer that treats an
unfamiliar repository as something to port. On Freeholder it commits a
`pnpm_workspace migration scaffold`: the whole project is moved into
`.migration-backup/`, an importer `package.json`, `pnpm-workspace.yaml` and
`replit.md` are written at the workspace root, and the checked-in `.replit` is
replaced by a generated one naming `nodejs-24` and an `autoscale` deployment,
with no PostgreSQL module and no port mapping.

Freeholder needs none of that. The repository ships its own first-class
`.replit` and `replit.nix`, so the first thing to do after importing is drop
that commit:

```sh
git reset --hard origin/main
```

Then confirm before going further:

- `.replit` names `modules = ["nodejs-22", "postgresql-16"]`, runs
  `pnpm start:replit`, and maps `localPort = 3000` to `externalPort = 80`.
- The project is at the workspace root and `.migration-backup/` is gone.
- `git status --short` prints nothing.

Do not ask Replit Agent to port, migrate or "set up" the project, and decline
the paid-plan upgrade it offers for that work: there is nothing to port, and
the agent run would only be undoing the importer. Provisioning PostgreSQL and
Object Storage from the workspace Tools pane, plus the steps below, is all a
launch needs.

## Install

Start with the [agent launch guide](../agent-launch.md) and its ready-to-paste
prompt. Import the repository and let Replit Agent provision Postgres and Object
Storage. Run `pnpm launch:prepare --target replit --url https://YOUR-SITE.replit.app`
to generate private credentials and a claim link; import the private `.env` into
Replit Secrets, preserving the same secrets in the Deployment. Missing
infrastructure is reported by name, with exit 2, without printing credentials.
For manual configuration, use the variables in `.env.example`. Set `FREEHOLDER_STORAGE=replit` and
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
