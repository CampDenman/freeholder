<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Launch and operate Freeholder with an agent

This guide implements the launch tooling and owner/agent surfaces in MASTER.md
§43 C1.39 and C3.27. Actual Replit and Lovable account acceptance is C3.28 and
remains open until a fresh launch succeeds on each platform.

## Replit: launch the complete application

[Import Freeholder](https://replit.com/github.com/CampDenman/freeholder), then
paste this instruction into Replit Agent:

> Launch this Freeholder project as a business I own. Read AGENTS.md and
> deploy/agent-launch.md. Use Replit PostgreSQL and private Object Storage.
> Prepare the configuration with pnpm launch:prepare, preserving credentials
> across reruns and deployments. Put credentials in Replit Secrets using the
> private configuration file; do not print them in chat. Use the checked-in
> Run and Deployment commands. Show missing steps and deployment progress.
> Ask me to approve paid hosting before purchasing it. Verify the published
> HTTPS URL and readiness, then direct me to the private owner claim file.
> I will create my passkey and save recovery codes myself. Afterward, help me
> connect your MCP access through /admin/connect and verify a permitted task.

The agent should:

1. Provision PostgreSQL and Object Storage through Replit's own tools. Use
   the intended production database; never migrate a different site's database.
2. Set `DATABASE_URL` and `REPLIT_BUCKET_ID` in private Secrets.
3. Run `pnpm install --frozen-lockfile`, then:

   ```sh
   pnpm launch:prepare --target replit --url https://YOUR-SITE.replit.app --json
   ```

   This generates independent bootstrap/session/encryption credentials in a
   mode-0600 `.env` and a mode-0600 claim link in mode-0700
   `.freeholder-launch/`. It preserves configured credentials, imports injected
   provider values, and prints only a redacted report. Exit 2 names missing
   infrastructure; it does not mean provisioning or deployment succeeded.
4. Import the `.env` into Replit Secrets. Confirm the Deployment retains the
   **same** session/encryption credentials. Workspace files are not the durable
   production secret store. Choose the final HTTPS origin before passkey setup.
5. Run the workspace with its checked-in Run command; publish using the
   checked-in Deployment build/start commands. Runtime instrumentation runs
   migrations before services/jobs. Production is a Deployment, not a sleeping
   workspace. Re-run preparation with the published origin if it changed.
6. Verify `GET /api/health`: HTTP 200, `ok: true`, ready workers, no disabled
   modules. Verify real storage upload/delivery, backup and restore using the
   recipe's `verify.md`. Keep that operational evidence separate from setup.
7. The owner opens the private claim file themselves. The claim is in a URL
   fragment, which the browser consumes and clears; it is not sent in the URL
   query or Referer. The once-only owner service still verifies the deployment
   secret. Without JavaScript, the existing manual setup-secret field works.
8. Create a passkey using the device prompt, or choose the authenticator
   alternative. Download and save recovery codes. Finish business setup.
9. Open `/admin/connect`, select Replit, name the connection and choose its
   scope/expiry. In Replit Integrations add the MCP endpoint and an
   `Authorization` header containing `Bearer ` followed by the credential.
   Keep that value in connector settings, not the conversation or repository.
10. Test from Replit Agent: list tools, create and publish a test page if the
    chosen permissions allow it, verify the public URL, and attempt a forbidden
    credential/payment/update operation. A browser connection test alone does
    not prove Replit Agent compatibility.

[Replit imports](https://docs.replit.com/build/import-from-providers),
[Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets),
[MCP connections](https://docs.replit.com/features/mcp/overview).

## Lovable: create a site using your hosted Freeholder

Lovable currently cannot import an existing GitHub repository. Connect a
Freeholder backend you own and use Lovable for a new interface or site. Its MCP
chat connector and its published app's runtime API are separate connections.

1. Launch a separate Freeholder instance through a maintained recipe, complete
   owner setup, and use its final HTTPS domain. It can be hosted on Replit or
   another supported target. Each business keeps its own database and storage.
2. Open `/admin/connect`, choose Lovable and create a named, expiring connection.
   Choose **Read website content** for inspection or **Edit and publish pages**
   when you want Lovable's agent to operate the native CMS.
3. In Lovable **Connectors → + → MCP server**, enter the endpoint and choose
   **Bearer token** authentication. Store the credential in that private form.
4. Start a new Lovable project and ask:

   > Use my Freeholder MCP connector. Discover the tools I have allowed.
   > Help me build a site for this business using Freeholder's existing content,
   > contacts, bookings and commerce services. Preserve its existing backend
   > and ownership. If I authorize page publishing, publish through its CMS
   > tools and verify the public result. Keep credentials in private settings.

5. If the published Lovable app itself needs the API, ask Lovable to add a
   **server-side** integration against the instance's `/api/openapi.json`.
   Issue a separate credential scoped to those operations. Do not reuse the
   builder's admin key or put it in frontend code, Vite env variables, or a
   downloadable client bundle. Public visitors need the platform's public
   customer flows or properly authorized customer sessions, not blanket admin
   authority. Lovable chat connectors do not become runtime app connections.
6. Prove discovery and actual permitted reads/writes inside Lovable, verify
   the result, refusal of forbidden operations and runtime credential isolation
   before marking C3.28 complete. This repository does not contain evidence of
   an actual Lovable launch yet.

[Custom MCP connections](https://docs.lovable.dev/integrations/custom-mcp),
[GitHub limitations](https://docs.lovable.dev/integrations/github),
[chat/runtime distinction](https://docs.lovable.dev/integrations/chat-connectors).

## Permission presets and recovery

The connection page grants exact available service names, filtered by the
human caller's grants and the instance's MCP registry. New services do not
silently widen an existing key. Website editing excludes customer records,
payments, credentials, updates and destructive page deletion. Health inspection
cannot apply or roll back updates. Advanced per-area choices remain in Settings.
Only a person with API-key management access and fresh verification can issue
credentials; existing human-only issuance and audit checks still apply.
Presets grant administrative permissions. The existing public visitor services
remain public; a read preset does not grant CMS editing or publishing rights.

The page tests the credential against its own MCP endpoint without sending it
to an arbitrary host. It proves permitted discovery; the agent client must
still complete its own connection test. Revoke or replace keys in Settings.

New passkeys are discoverable credentials with device user verification.
Passwordless sign-in uses a separate, expiring, once-only passkey challenge;
it cannot be completed with an authenticator or recovery code alone. Existing
password-plus-factor login remains available, including for older credentials
that are not discoverable. If the site domain changes, use that fallback and
register a new passkey on the final domain. Restore the original encryption
key with a database restore; do not generate replacement secrets on restart.
