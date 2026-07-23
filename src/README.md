# src/ — the application (AGPL-3.0-only)

Framework-agnostic application code, per `MASTER.md` §10:

- `core/` — the spine: db, auth, contacts, media, i18n, locations, settings,
  events, jobs, seo. Modules may import core; never the reverse.
- `modules/` — feature modules, each a `defineModule()` manifest
  (`MASTER.md` §11). Modules communicate only via events and core services.
- `adapters/` — vendor isolation (`MASTER.md` §12): payments, mail, storage,
  calendar, sms, ai, fx. Core never imports a vendor SDK directly.
- `mcp/` — the bundled MCP server; tools generated from the service registry.

Lands with build-order step 1 (`MASTER.md` §7).
