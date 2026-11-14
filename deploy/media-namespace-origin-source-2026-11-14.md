<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# New-launch namespace origin precursor — SOURCE ONLY

C1.12/C10.32/C11.08 remain OPEN. Predecessor e3f558dc stays immutable.
This finite source checkpoint supplies one provisioning evidence producer and
its private delivery/reader. It does NOT implement quota initialization or its
permanent initial-write fence, initialize an account, publish either storage
capability, close old writers, prove a remote issued URL terminal or qualify a
platform. No compiler/lint/parser/test/PG/native/provider-account/host operation
has run for this checkpoint. The dedicated native TCP control is opt-in and
UNRUN; the twelve source controls are also UNRUN. Existing oracle bodies,
owned SQL82, model rows, old JSON/HMAC domains and original receipts are intact.

The actual producer is packages/cli/src/launch/digitalocean.ts storage, called
by runLaunch after dry-run/cost approval and before any droplet app starts.
An actual account UUID from its authenticated preflight is required for this
new path. Missing identity keeps the older non-origin launch behavior and
cannot qualify initialization. New media names retain a 128-bit random suffix
in an exclusive fsynced admission before key/bucket creation. A separate
exclusive dispatch entry permits at most one media create. No new suffix,
rotation or replay heals a retained ambiguous admission. Existing/resumed old
deployments preserve their original names. A genuinely returned successful
first receipt can finish the remaining launch steps only for the same actual
account/endpoint/region/bucket, without issuing that media PUT again. Unknown
or lost first responses remain recovery debt; creating the backups bucket
does not establish origin for the media namespace.

The dependency-free CLI's new namespace-origin module uses a finite strict
ListBuckets grammar with bounded UTF-8 bytes. Unexpected fields, truncation,
DTD/entity text, duplicate bucket identities and unsupported structures refuse
provenance; the old permissive listKeys regex grants no origin authority.
DO's published ListBuckets response omits Owner, so absent Owner remains NULL.
The actual authenticated account and actual account-created temporary key are
retained through safe digests rather than inventing an owner ID. The provider's
before/after metadata is corroboration, not standalone freshness or quiescence.
The real HTTP response status, request-ID digest, date, complete body digest and
return are independently retained. HTTP200 alone never qualifies this path.
The signed final receipt retains created/existing/unknown truthfully; original
ACK/FIN artifacts cannot be rewritten by later deployment failures.

Primary contract evidence: [DigitalOcean Spaces API](https://docs.digitalocean.com/reference/api/spaces/)
describes region-unique new bucket creation and account bucket metadata. Its
success example does not specify every already-owned recreate case. The design
therefore also requires the secret unpredictable pre-admitted name, one actual
create, complete metadata and privately authenticated producer provenance.
[DO S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/)
is partial; do not generalize its proof to other S3 implementations.
[AWS S3 error semantics](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateBucket.html)
explicitly allow an already-owned us-east-1 bucket to return200, so generic
compatible HTTP200 cannot be promoted into a fresh-namespace proof. These are
public documentation reads, not account configuration inspection or an observed
production incident. Selected-provider acceptance remains required.

Delivery follows the actual source recipe, not a new generator: launch.ts reads
deploy/digitalocean-droplet/infra/cloud-init.yml and compose.yml; the existing
packages/cli/scripts/copy-recipe.mjs copies those same sources into the packaged
recipe. Cloud-init installs Docker but never starts the app. It creates the
empty private witness directories; emptiness is not an origin assertion. Before
the first docker compose up, runLaunch sends the independent public key, first
signed receipt and immutable actual-droplet installation through Remote's
private stdin/file path. The dedicated signing private key stays in the owner's
mode600 launch directory and is never copied. No claim/API/CREDENTIAL key is
reused. No new environment secret or public proof parameter is introduced.

The deployed Dockerfile runs UID/GID1001. Trust directory root:1001 mode750 and
files root:1001 mode640 are readable through the readonly compose bind mount
/run/freeholder/namespace-origin, without app write permission. The separate
mode700 UID1001 journal mount is reserved for the REQUIRED initialization
consumption consumer; this precursor does not claim that it implements one.
The fixed server loader refuses symlink/insecure/oversized artifacts, validates
strict typed body/signatures/exact configured binding and installation digest,
then registers the actual frozen object in an in-process WeakSet. A pure
signature-verified value or caller's lookalike cannot pass that runtime scope
check. Public callers cannot select a trust key, signature or path.

Prepared acceptance uses the real digitalOcean/runLaunch producer against a
fictional TCP provider that authenticates API requests and recalculates actual
SigV4/body signatures. Its private-delivery adapter transports the actual
receipt/key/installation before the real launch sequence starts compose. It
verifies those delivered bytes and rejects treating their pure verified result
as an installed runtime scope. That adapter is not actual SSH/root permissions,
owner claim, initializer service or DigitalOcean account acceptance. Twelve
additional controls prepare first-body preservation, one-create resumption,
existing409/unknown200/lost-reply refusal, installation rebinding and malformed
provider metadata. Existing launch/recipe tests are byte-identical and UNRUN.

Required next implementation is the approved FOUR-model initialization claim/
association protocol with actual owner human/fresh-verification checks before
GETs, complete current caller/namespace fences, actual two-pass page ledger and
sameTX state/group accounting. It MUST consume this installed origin with a
durable installation-specific anti-replay journal; restoring/copying old
receipts or rolling back only the DB cannot mean a fresh empty namespace. The
first writer must be fenced from installation until that complete protocol
commits. This checkpoint deliberately supplies no always-false initializer,
fake positive history, marker-based permission or early capability. Claims and
passive setup remain reachable; the actual owner initialization UI/transport,
first writer refusal/continuation and cross-restart replay control still need
implementation and genuine qualification. The separately reviewed tokenless
initial-group retirement/re-review consumer, legacy origins/remote authorities,
capture/quota/cutover and all actual provider/host acceptance remain required.
