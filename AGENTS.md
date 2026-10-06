<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Working on or launching Freeholder

Read `CLAUDE.md` and `MASTER.md` before changing product code. `MASTER.md` §43
is the only product/status authority. Use the shared services for all business
operations; UI, HTTP and MCP must have the same permissions and audit trail.

For a new launch, follow `deploy/agent-launch.md`. The owner keeps their hosting
account and approves spending. Use the provider's tools to provision Postgres
and private object storage; do not substitute in-memory or workspace storage.
Run `pnpm launch:prepare --target replit --url https://THE-PUBLISHED-SITE` to
prepare credentials. Exit 2 means infrastructure/configuration is missing;
read the redacted report, supply those items, and rerun. Preserve existing
secrets. Keep `.env` and `.freeholder-launch/` private and out of source control,
build artifacts, screenshots and chat. Import the generated environment into
the provider's private secret settings using its secure tooling.

The owner personally opens `.freeholder-launch/claim-link.txt`, creates their
account/passkey and saves recovery codes. Agents must not retain the owner's
password, passkey, recovery codes or bootstrap claim. Once setup is complete,
use `/admin/connect` to issue a named, expiring, scoped agent credential. Store
it in the agent client's private connector settings. Discover the instance's
live tools at `/api/mcp`; use `/api/openapi.json` for API integrations.

For Replit, use the checked-in `.replit`, PostgreSQL and Object Storage, and a
Deployment for production. For Lovable, connect a hosted Freeholder through a
custom MCP connector; Lovable does not import this existing repository. A
Lovable application's runtime uses a server-side API integration with a
separate credential, never an admin key in frontend JavaScript.

Before reporting success: verify `/api/health`, perform a real owner sign-in,
connect a restricted agent, create and publish a page with the permitted tools,
verify its public URL, and prove forbidden operations are refused. Keep platform
launch acceptance open until these steps pass in the actual provider account.
