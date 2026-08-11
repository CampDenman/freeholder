# src/ — the application (AGPL-3.0-only)

Framework-agnostic application code, per `MASTER.md` §10:

- `core/` — the implemented spine: db, auth, named roles and module grants,
  staff invitations, contacts, media, i18n, locations, settings, events, jobs,
  SEO, API keys, webhooks, agents and connections.
  Modules may import core; never the reverse.
- `modules/` — current CMS, forms, analytics and seed modules, each a
  `defineModule()` manifest (`MASTER.md` §11). Modules communicate only via
  events and core services.
- `adapters/` — current storage and mail vendor isolation (`MASTER.md` §12).
  Remaining adapter families are tracked from C5.01; core never imports a
  vendor SDK directly.
- `mcp/` — the bundled MCP server; tools generated from the service registry.
