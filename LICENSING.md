# Licensing

Freeholder is dual-licensed by component. This file is the plain-English map;
the license texts themselves are authoritative.

## The short version

| What | Where | License |
|---|---|---|
| Freeholder core (the platform: server, web app, admin, all modules) | everything in this repository **except** `packages/` | **AGPL-3.0-only** ([`LICENSE`](LICENSE)) |
| SDKs, client libraries, templates, and integration packages | `packages/*` | **MIT** (a `LICENSE` file in each package) |

Copyright (C) 2026 Camp Denman Society.

## Why this split

The core is AGPL so that Freeholder stays open: anyone may self-host, modify,
and redistribute it, but if you run a modified Freeholder as a network service
you must offer your users the corresponding source (AGPL section 13). This is
what lets a not-for-profit steward — Camp Denman Society — keep the project
open for everyone, permanently.

The SDKs and templates are MIT so that creators, businesses, and third-party
developers can integrate with a Freeholder site — build themes, external
apps, automations, agents — under any license they choose, including
closed-source and commercial, with zero friction.

## The two integration lanes

1. **In-process plugins** — code that loads into and runs inside the
   Freeholder core process is a derivative work of the core and must be
   licensed under an AGPL-3.0-compatible license.
2. **External apps** — anything that talks to a Freeholder site from the
   outside via the SDK, the HTTP API, or the MCP server may be licensed
   however you like. Using the MIT-licensed `packages/*` does not subject
   your app to the AGPL.

## SPDX identifiers

Manifests carry SPDX license fields: the repository root and all core
packages declare `AGPL-3.0-only`; each package under `packages/` declares
`MIT`. New source files in the core should carry the header:

```
// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
```

and new files under `packages/`:

```
// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: MIT
```

## Contributions

Contributions are accepted under the license of the component they touch
(inbound = outbound), certified via the [Developer Certificate of
Origin](DCO.md) with a `Signed-off-by` line (`git commit -s`). There is no
CLA.

## Questions

If you are unsure which side of the line your use case falls on, open a
Discussion — and note that nothing in this file is legal advice.
