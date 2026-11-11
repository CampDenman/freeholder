<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C12.39 OpenMLS migration source evidence — 2026-11-11

`MASTER.md` §43 is the status authority. C12.39 and C11.10 remain open while
protected checks and independent review are completed. No production deployment,
provider acceptance, stable publication or independent signature is claimed.

## Delivered boundary

New device keys and KeyPackages, MLS groups/messages/call keys, payload
signatures and approved-history HPKE use the committed OpenMLS WebAssembly
runtime. The server uses the same Rust KeyPackage parser and signature verifier,
initialized before business transactions. Only the Node loader imports the
filesystem; the browser loads the pinned same-origin runtime. Deployment needs
Node, not Rust. `native/openmls/README.md` records the exact upstream revision,
toolchain, RustSec result, reproducibility and complete third-party source and
license bundle. Historical OpenMLS audits do not audit this integration.

Existing raw or PKCS#8 device signing keys keep their public key and device ID.
The isolated `legacy.ts` bridge reads old groups and Welcomes and signs a
correctly framed GroupInfo before external resync. It does not encrypt new
application messages. The driver rereads a legacy group's log if an older
client skipped a public commit and advanced its cursor; cached readable
messages survive replay. An older server lacking `supportsOpenMlsRefresh`
leaves the new client read-only instead of silently reverting its encryption.

## Persistence, authority and privacy

The driver persists prepared commit bytes and the exact RPC request before
transport. Exact accepted receipts and own log entries merge pending commits;
conflicting commits abandon a member pending state without rewinding its sender
ratchet. An unaccepted external migration keeps its legacy backup for retry.
Creator commits also have durable receipts, so a lost create response can be
recovered. Sender ratchets and a private outgoing candidate are persisted
together before message/control transport. Each conversation admits at most
32 unconfirmed application/control sends; a full queue refuses another send
before advancing the ratchet. The exact ciphertext, conversation, device,
epoch, kind and franking tag or call/generation bind accepted acknowledgements
and own-log receipts to the private readable message/key. Unknown outcomes
remain private and are never blindly retransmitted. Explicit typed refusals
discard only that candidate, without rewinding the ratchet. A call-key candidate
does not occupy the confirmed key slot until acceptance; older confirmed
generations remain available for rekey authority.
Critical commit or Welcome failures do not consume the delivery cursor.

Actual cryptographic leaves are reconciled against current entitlement,
identity keys and the server epoch before new ciphertext or exported secrets.
An erased member's public keys may remain only in another recipient's private
historical snapshot for reading/removal; they are not restored to the server
and cannot authorize new sharing. Late legacy Welcomes remain readable after
such erasure, then require removal/rekey before sending. Local state is bound
to its conversation and device identity. Corrupt state fails closed.

An initial security regression reproduced full privacy erasure after encryption
but before delivery: the unchanged MLS epoch alone could accept ciphertext for
the erased device. Membership commits, application and call-key writes now
carry a required SHA-256
delivery witness computed from the exact pre-encryption epoch, roster, complete
entitled identity/key tuples and missing-member set. The service recomputes it
under the conversation lock; a mismatch refuses that ciphertext. A retry must
sync, reconcile the actual MLS leaves and encrypt again. The transport never
adds a newly fetched witness to previously encrypted bytes. The new capability
is required for writable sync; clients without a witness are read-only.
An unaccepted prepared commit whose authority changed at the same epoch is
abandoned and rebuilt from the current snapshot, preserving sender ratchets.
Receiving another member's application does not discard its pending request.
A persisted pending request is not delivered to an older server lacking the
required capability.

Privacy erasure, device registration/revocation, conversation membership changes
and direct blocking take profile locks followed by affected conversation locks
in stable order. Delivery takes its own profile lock and the conversation lock
before checking authority. Erasure therefore cannot mutate the authorized
roster halfway through an accepted send. Privacy erasure uses the real service
context for call removal in the same transaction; public keys still hard-delete.
The merge queue was paused when this regression was found, pending renewed
qualification of the corrected source.

The real loopback SFU probe also confirmed that a cached self-hosted LiveKit
credential can rejoin after participant removal, as documented by
[LiveKit's token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/#self-hosted-deployments).
Calls now use generation-specific transport rooms. A membership/device loss
advances the media-key generation and transactionally queues retirement of the
old room; eligible browsers acquire the matching key and reauthorize/reconnect
to the new room. The original room alias is retired too for existing calls.
Cached old credentials are limited to the obsolete room. Ten-minute credential
lifetimes supplement this boundary; their expiry is not treated as immediate
revocation. A generation conflict refuses a stale join request. Reconnection
preserves the member's microphone and camera choices.

Browser Web Locks serialize the persisted device/conversation state across
tabs. A browser without this coordination is refused. History key changes and
imports are serialized too, including conversation message writes; in-memory
native tests share a queue per store. Production CSP grants WebAssembly only
on the member message/report/group-call surfaces (including locale paths),
without allowing JavaScript `unsafe-eval`.

The site still supplies the device directory. The existing member warning and
safety-number/device verification controls remain. This change does not prove
safety against a compromised server. Private device/group/history keys remain
in the originating browser; site backups continue to contain only the existing
public directory, KeyPackages and ciphertext delivery records. Clearing browser
data still loses that device's local history. No SQL migration is introduced.

## Evidence

The initial protected run passed, including its pinned native build:
[OpenMLS checks](https://github.com/CampDenman/freeholder/actions/runs/42994883626/job/130436369666).
The erasure/delivery and interrupted-send corrections have also passed the
renewed qualification below. Updated-head protected checks remain required
before returning the PR to the merge queue.

- Fourteen native Rust tests cover package/signature validation, fallback reuse
  across groups, joined-device Welcomes, state substitution, replay/ratchets,
  exact pending receipts, removal/rekey, stale epochs and erased-device pins.
- The synthetic Node interoperability proof passes on the supported Node
  20.19.0 floor, exact CI Node 22.23.4 and local Node 24.15.0. It migrates a legacy two-device group
  without identity reset, lets the legacy recipient read OpenMLS output, and
  checks signatures and history HPKE in both library directions.
- Independently located builds reproduce all eleven runtime/license assets.
  RustSec reports no vulnerabilities; the uncompiled `cfg(hax)` maintenance
  warning remains visible and documented without an ignored advisory.
- Seventeen core integration/CSP tests pass, including late legacy Welcome
  recovery after erasure, refusal before removal/rekey and refusal without
  browser cross-tab locking.
- Twenty-nine PostgreSQL message/group-call tests pass. They cover legacy public-
  commit recovery, unchanged identity/safety numbers, lost creator response,
  concurrent clients on one store, forced competing member/external commit CAS,
  devices/removal, franked moderation, sealed
  files, approved history and call-key rotation. They also cover full erasure
  between preparation and actual application/commit delivery, the SQL lock
  barrier, exact own receipts after message/call response loss, explicit refusal
  without ratchet rewind, queue exhaustion, a pending commit during incoming
  application delivery, refusal to retry on an older server, competing call
  keys, admission after an uncertain losing key, and privacy/outbox rollback.
- Eight SDK checks pass after regenerating the shared refresh/capability contract.
- The final production standalone build passes: 18,785 files, 233,970,397 bytes,
  with native source, application source and environment leakage scrubbed.
- Twenty-five actual Chromium browser journeys pass, including the complete
  existing member suite and group video through the checksum-pinned local
  LiveKit 1.13.7 SFU. Valid media decodes, a wrong-key peer decodes none, and
  removing a participant rotates media keys while remaining peers keep reading.
- The final membership-commit fence passes all four affected browser reruns:
  migration, message requests, encrypted multi-device/franked reporting and
  actual SFU video. The latter reuses a removed synthetic member's cached JWT:
  it rejoins only the obsolete empty room while the remaining peers continue
  decoding in the next generation. New credentials for the removed member are
  refused. A sender's accepted response is deliberately dropped; reloading the
  same browser recovers exactly one readable own message without retransmission.
- The final focused migration rerun passes after the last recovery/layout fixes:
  abort the first WASM download, retry in the same document without resetting
  identity, recover an old client's skipped public commit, send simultaneously
  from two actual tabs, and approve history to a newly registered device.
  Eight 320px locale/theme variants (English, Spanish, French, Arabic RTL;
  light/dark) pass WCAG A/AA scans and document/native-input bounds checks.
  English light and Arabic dark screenshots were visually inspected. The
  initial visual check found an existing native-file-input overflow despite
  clean Axe scans; the final source fixes it and verifies actual bounds.
- Required fast gates pass: TypeScript, full ESLint, license/plan/notes and 368
  contract tests (one deliberate skip). The final small recovery/layout changes
  also pass production TypeScript/build, targeted lint, seventeen core checks,
  license/workflow checks and their affected real-browser rerun.

## Remaining acceptance

Final protected pull-request/merge-group checks and the independent security
review remain required before completion. The local SFU proof uses synthetic
members and fake test camera/microphone media on loopback; it is not hosted-
instance or external-provider acceptance. No production deployment or stable
announcement follows from this source evidence alone.
