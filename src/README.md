# src/ — the application (AGPL-3.0-only)

Framework-agnostic application code, per `MASTER.md` §10:

- `core/` — the implemented spine: db, privacy-bounded session/device history,
  suspicious-login notices, TOTP/WebAuthn/recovery and step-up auth, named
  roles and module grants, staff invitations, customer magic-link proof and
  single-spine portal account linking, contacts with organizations, canonical
  tags, typed owner fields, relationships, regional preferences and lifecycle
  history, media, i18n, locations, settings, events, jobs, SEO, API keys,
  webhooks, agents, connections, and the personal notification fanout/inbox.
  Modules may import core; never the reverse.
- `modules/` — current CMS, forms, analytics and seed modules, each a
  `defineModule()` manifest (`MASTER.md` §11). Modules communicate only via
  events and core services.
- `adapters/` — current storage, mail, and notification-channel vendor isolation (`MASTER.md` §12).
  Remaining adapter families are tracked from C5.01; core never imports a
  vendor SDK directly.
- `mcp/` — the bundled MCP server; tools generated from the service registry.
