# Customization seams

An update is only safe if Freeholder knows which parts of a running instance
belong to the owner. Those seams are:

| Seam | Holds | Survives an image swap because |
|---|---|---|
| Database | Pages, settings, media records, every business row | Structure is data |
| Plugins | Owner and third-party code under `plugins/` | Installed artifacts, never merged into core |
| Configuration | `freeholder.config.ts` and `.env` | Instance choices, never baked into the image |
| Uploads | Object storage | The container is disposable |

Core (`src/`, `app/`, `packages/`, `db/`, `scripts/`) is replaceable. Editing
those files on a live server is not a supported customization. Doctor reports
it as `update.coreFiles`, and `platform.inspectSeams` lists the paths.

This is the contract that later update apply/rollback work (C10.02–C10.11)
depends on. It is not a claim that unattended self-update is already running.
