# db/ — Drizzle migrations

Forward-only migrations (`MASTER.md` §16). Schema is owned per-module
(`src/modules/*/schema.ts`) and by core (`src/core/db`); generated migrations
land in `migrations/`.

C10.19 collapsed the pre-1.0 `0000`–`0167` chain into
`0000_reviewed-baseline.sql`. That is a one-time N-1 break: existing journals
cannot migrate onto this file, and the upgrade gate loses its chain-apply
anchor at this commit. Sibling `0168_*` first-party plugin migrations are not
in this baseline and must be folded in when those PRs land.

Do not regenerate `0000`. Later schema changes are `0001` and up. The
generate body does not carry gist excludes, asset triggers or `project_tasks`;
those extras live only in the SQL file. Identity with the deleted chain is
`node scripts/schema-baseline-identity.mjs` (and
`tests/core/schema-baseline-identity.test.ts`): it applies the chain from the
git parent that still has `0000_core-spine.sql` when history is available,
always applies this baseline, and diffs catalogs after normalizing drizzle
`*_id_*_id_fk` names against Postgres `*_fkey`. A shallow clone compares
against `tests/fixtures/c1019-chain.catalog`.
