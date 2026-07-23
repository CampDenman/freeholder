# db/ — Drizzle migrations

Forward-only migrations (`MASTER.md` §16). Schema is owned per-module
(`src/modules/*/schema.ts`) and by core (`src/core/db`); generated migrations
land in `migrations/`.
