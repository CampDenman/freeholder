# db/ — Drizzle migrations

Forward-only migrations (`MASTER.md` §16). Schema is owned per-module
(`src/modules/*/schema.ts`) and by core (`src/core/db`); generated migrations
land in `migrations/`.

C10.19 collapsed the pre-1.0 `0000`–`0167` chain into
`0000_reviewed-baseline.sql`. That is a one-time N-1 break: existing journals
cannot migrate onto this file, and the upgrade gate loses its chain-apply
anchor at this commit. Sibling `0168_*` first-party plugin migrations are not
in this baseline and must be folded in when those PRs land.
