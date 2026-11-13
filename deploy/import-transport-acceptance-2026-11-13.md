<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Import transport acceptance controls

C3.22/C3.46/C3.47/F05 remain open. This is a **source-only, unqualified test checkpoint** from frozen imports738/SQL81 `43808cb3`. It does not change product code, regenerate the SDK, run a server, use a database or touch provider accounts. Every original import/privacy/native oracle remains unchanged.

## Missing proof map

| Existing evidence | What it proves | Remaining transport boundary |
| --- | --- | --- |
| `tests/core/sdk.test.ts` mocked-fetch wrappers | SDK serialization and result/error handling | Actual authenticated incoming HTTP requests and live service execution |
| API/MCP tests calling route handlers in-process | Real handlers, database permissions and protocol projection | Incoming TCP ingress shared by typed SDK and MCP clients |
| Actual501 REST lifecycle with a real source TCP server and two separate index processes | Domain capture, bounded persistence/restart, media, publication and reversal | Incoming HTTP/MCP/typed-SDK lifecycle for that actual source |
| Current exact-scope and source-privacy controls | Domain permission, ownership, byte-retirement and recovery invariants | Incoming scoped-key refusal, binary-uploader identity and audit provenance |
| Generated738 SDK | Typed upload/review/graph/commit/reconcile/publish/rollback | **Missing public `imports.advanceCrawl` and `imports.crawlProgress` wrappers** |

The missing crawl wrappers are a generated-catalog parity gap found by source inspection: the runtime modules define both public services, but frozen738 `packages/sdk/src/generated.ts` names neither. The parent owns regeneration from the **final combined live registry**, including commercial and reader additions. Regenerating against this older isolated source would drop unrelated capabilities. The prepared REST control calls the expected `client.api.imports.advanceCrawl` and `.crawlProgress` wrappers directly: it deliberately has no unknown-name fallback, fake cast or `@ts-ignore`. Type qualification must follow final combined SDK regeneration. This checkpoint does not claim those missing wrappers already compile.

## Finite control design

`tests/helpers/import-transport-host.ts` adapts actual owned Node TCP requests into the checked-in application API, MCP, raw upload and OpenAPI route handlers. It does not resolve actors, call services for an incoming request, construct a ServiceContext, reimplement authorization or stub fetch. Native SDK clients use their normal native fetch transport. The MCP client sends real JSON-RPC requests over TCP, validates response IDs and structured output, and is explicitly not an official external-client interoperability claim. The host is a test adapter for production route handlers, not a deployed Next.js server or hosting-account acceptance.

Synthetic setup creates only fictional owner/factor/session rows using the existing auth harness and real signed session creation/resolution. The fresh owner then issues each scoped expiring key through the actual HTTP API with session cookies and CSRF protection. No real owner claim link, password, passkey, recovery code or connector key is used or retained. Authorization, scope checks, input validation, transactions, service audit and credential revocation all remain the production code.

Three independently selectable native controls are prepared:

1. **501 original WXR records:** typed SDK starts/reserves, real binary HTTP uploads the exact original, SDK/MCP alternate bounded index/review, a fresh client resumes the saved500 boundary, and a real explicit plan review changes its revision. Private PUT SHA/bytes/namespace/key binding and actual queued cleanup payload are read back. Two accepted CMS batches commit500+1 as drafts, replay creates no extra batch, publication is explicit and the original draft stays private, anonymous HTTP reads reflect publication, and rollback removes only imported content and restores the exact initial pages. The original private bytes remain exact pending their actual cleanup job; no erasure completion is claimed.
2. **Refusal boundaries:** real scoped keys cannot preview without that scope, a different credential cannot upload into another original upload, private helpers stay absent from HTTP/MCP/SDK/OpenAPI, revoked credentials cannot create work, and an import-only key cannot acquire independent CMS grants. Before/after minimal digests cover actual import/source/storage/CMS business records; ordinary authentication last-used/session bookkeeping is distinguished from business side effects. The CMS-grant refusal uses the ordinary finite import transaction rather than inventing a graph permission exception.
3. **501 actual REST records:** a fictional owned TCP WordPress source supplies the real robots and paginated original responses. Only DNS/test-local source admission is injected; neither provider bodies nor incoming authentication is mocked. Actual regenerated typed SDK and MCP requests advance the saved frontier, observe500 then501, review bounded metadata and finish the same draft/publication/rollback flow. Accepted private original bytes/digests, source generation, exact key executor, original audit actor, no outbound owner credential, retained request/response identities and real cleanup payloads are checked. The existing independent-process domain oracle remains unchanged and is not relabelled as transport proof.

Each new native leaf has its own bounded180s maximum, finite phase loops and no test retry override. The two source lifecycles use no external media, keeping source transport separate from the already-proven shared-image domain case. Reader-comment provenance, source-specific SEO/feed/query-ID coverage, official MCP client interoperability, packed SDK consumers, browser routes, production host/accounts and final combined candidate acceptance remain required elsewhere; these controls do not close C2.29/C3.13 or claim the full WordPress feature specification.

## Qualification and evidence requirements

**UNRUN:** full/incremental types, lint, unit/native/server/database/transport execution, final combined SDK generation and provider/owner acceptance. No local dependency install, build or database action is performed by this checkpoint. The known SDK generation dependency is explicit above.

When granted, the parent should first regenerate/check the combined catalog and run source qualification; then use a genuinely new combined-schema database with exact journal/model/guard proof. Run one actual leaf at a time, preserving the first unexpected failure, and independently read minimal exact-request/scope/receipt/storage/audit facts, all migration hashes, UTC/fsyncON/jitOFF and closed database clients before the next owned passing fixture reset. Do not clone or export old failure databases. Existing originals and independent proofs remain authoritative for their original bounded claims. No C-item, stable tag, deployment, social announcement, independent review or owner signature follows from source preparation.
