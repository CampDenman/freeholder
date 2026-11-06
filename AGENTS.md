<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Working on or launching Freeholder

Read `CLAUDE.md` and `MASTER.md` before changing product code. `MASTER.md` §43
is the only product/status authority. Use the shared services for all business
operations; UI, HTTP and MCP must have the same permissions and audit trail.
To build on the member features (profiles, posts, messages, calls, market),
read `deploy/members-vibe-coding.md`.

## Launching a new site

The owner keeps their hosting account, approves every purchase, and runs every
step that reveals the owner claim. Use the provider's own tools to provision
Postgres and private object storage; do not substitute in-memory or workspace
storage. Pick the path for where the owner wants to host:

- **DigitalOcean, from a terminal agent** (Claude Code, Cursor, Codex). The
  owner signs in with `doctl auth init` (or sets `DIGITALOCEAN_TOKEN`) in their
  own shell and has an SSH key on the account. Run
  `npx @freeholder/cli@next launch --provider digitalocean --domain THEIR-DOMAIN --dry-run`
  and show the owner the plan and the monthly cost it prints. Do not run the
  launch without `--dry-run` yourself: hand the owner that exact command
  without `--dry-run` to run in their own terminal, because it prints the
  owner claim link. It keeps the site's secrets in
  `~/.config/freeholder/<name>/freeholder.env` (mode 600); never read, print or
  copy that file. See `packages/cli/README.md` and
  `deploy/digitalocean-droplet/README.md`.
- **Replit.** Follow `deploy/agent-launch.md`: Replit PostgreSQL and Object
  Storage, then
  `pnpm launch:prepare --target replit --url https://THE-PUBLISHED-SITE`, the
  checked-in `.replit`, and a Deployment for production.
- **Lovable.** Connect a hosted Freeholder through a custom MCP connector;
  Lovable does not import this existing repository. A Lovable application's
  runtime uses a server-side API integration with a separate credential, never
  an admin key in frontend JavaScript.
- **Any other recipe** in `deploy/README.md`: follow that recipe's README.

`pnpm launch:prepare` exit 2 means infrastructure or configuration is missing;
read the redacted report, supply those items, and rerun. Preserve existing
secrets. Keep `.env` and `.freeholder-launch/` private and out of source
control, build artifacts, screenshots and chat. Import the generated
environment into the provider's private secret settings using its secure
tooling.

## The owner claims the site, then connects you

The owner personally opens the claim link (`freeholder launch` prints it in
their terminal; `launch:prepare` writes `.freeholder-launch/claim-link.txt`),
creates their account and passkey, and saves the recovery codes. Agents must
not open or retain the claim link, and must not retain the owner's password,
passkey or recovery codes.

**You cannot connect yourself.** Only a signed-in person with API-key access
and fresh verification can issue a key: requests from agents are refused, and
no key can create another. Ask the owner to open `/admin/connect`, name the
connection, choose its scope and expiry, and paste the key into your client's
private connector settings themselves. Never ask for the key in chat. Then
discover the instance's live tools at `/api/mcp`; use `/api/openapi.json` for
API integrations.

Before reporting success: verify `/api/health`, confirm the owner signed in,
use the restricted key the owner issued, create and publish a page with the
permitted tools, verify its public URL, and prove forbidden operations are
refused. Keep platform launch acceptance open until these steps pass in the
actual provider account.
