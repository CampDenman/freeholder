<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Publisher keys and signed plugin artifacts

MASTER.md C3.42. This guide covers publisher authentication, owner trust and
artifact verification. A signature identifies a trusted publisher; it is not a
security review or a process sandbox. Plugins run in the application process.
Declared-permission/consent enforcement and the plugin egress boundary remain
C3.40/C3.41; sandboxing remains explicitly deferred under C3.43 and §43.18.

## Owner: establish trust

Obtain the publisher's Ed25519 public key and its SHA-256 fingerprint through
an independent, authenticated source. The fingerprint is lowercase hexadecimal
SHA-256 of the DER-encoded SPKI public key, not an SSH fingerprint. A key
included with an untrusted plugin or catalogue does not establish its identity.

Open `/admin/plugins`. If verification has expired, follow **Confirm your
identity**. In **Publisher keys**, enter the publisher name, public PEM and
independently checked fingerprint, confirm the check and trust the key. Only a
freshly verified owner session can do this. Agents, personal API keys, staff
and system composition cannot approve a key. No service accepts a private key.

Publisher names are local trust identities. When rotating a key, select the
exact existing publisher name. A signed update from another publisher is
refused; a deliberately reviewed fork is a separate installation.

Configure the registry URL and select its trusted signing key. Paste its JSON
index and signature into **Verify and save catalogue**. The signature binds the
complete canonical index and the exact canonical URL. A caller cannot choose a
different verification key while refreshing a registry. The shared services
are `plugins.trustPublisherKey`, `plugins.setRegistryPublisherKey`,
`plugins.cacheRegistry` and `plugins.listCatalog`; UI, HTTP and MCP use the
same permission and audit rules.

Install an artifact from its immutable release folder and paste the
publisher's signature. Every installed artifact and update requires a valid
Ed25519 signature. Unsigned artifacts are refused for everyone, including the
owner. Local developers can sign their own code and have the owner trust that
public key through the same explicit process. Supplying a verification secret
or a caller-defined local override cannot bypass signature verification.

## Publisher: produce the public proof

These repository tools require Node 24+ and the locked repository dependencies;
they do not change the server's supported runtime. Generate and keep your
private Ed25519 signing key outside the artifact and outside Freeholder. Run
signing commands in the publisher's private signing environment. Never upload
or paste a private key into Freeholder or chat. Private key files must have
owner-only permissions (normally mode 600).

Derive the fingerprint from the public key:

```sh
node scripts/sign-plugin.mjs fingerprint --public-key /private/publisher-public.pem
```

This prints only the public fingerprint. Publish it through an authenticated
channel separate from the artifact's download. Sign the final extracted release
folder, including its installed dependency bytes:

```sh
node scripts/sign-plugin.mjs artifact --directory /releases/my-plugin --private-key /private/publisher-private.pem
```

The JSON output contains `integrity`, `signature` and public `keyId`. Publish
these beside the artifact. Put that exact integrity hash, version and
permissions in the registry index, then sign the index for its published URL:

```sh
node scripts/sign-plugin.mjs registry --index /releases/index.json --url https://publisher.example/index.json --private-key /private/publisher-private.pem
```

This prints the public registry signature and key ID. Formatting or property
order in the JSON does not change its canonical meaning. Registry signatures
and artifact signatures have separate signing purposes and cannot substitute
for one another. Verification uses Node's built-in
[Ed25519 signing and verification](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback).

## Rotation, revocation and recovery

Trust the replacement key after checking its fingerprint independently, using
the same publisher name. For routine rotation, keep the retiring key trusted
while supported plugin or registry releases still depend on it; publish their
successors before retiring that key. Pin each registry to that key; this clears its old
catalogue until a fresh signature verifies. Updates may move to a different
trusted key of the same publisher.

Revoke a key after its replacement is ready, or immediately if it is
compromised. Explicitly confirm that revocation permanently disables registrations signed by that key. Revocation is permanent in this interface. Matching installed
registrations become disabled, catalogues signed by that key disappear, and
future install/enable/update/rollback verification refuses it. Revocation and
artifact state changes serialize in one database transaction. This is not a
claim that revocation terminates arbitrary code already running in-process;
runtime enforcement remains C3.40.

Keep old release directories immutable if rollback is required. Rollback
restores the actual previous path, hash, signature and manifest metadata,
re-verifying the bytes and current key trust. Missing, modified, unsigned
downgrades and revoked previous artifacts are refused. Reinstall a reviewed
copy if the historical artifact is unavailable.

The migration preserves old metadata but disables all old registrations for
review under the new hash format. It does not invent trust for an old HMAC or
an unsigned folder. Old catalogue rows remain available for inspection but are
not listed until an owner pins a trusted key and a new index verifies. Legacy
unverified registrations require a freshly verified owner to adopt a new publisher
signature; agents cannot make that trust decision. Old version-only rollback
records are not a verified previous artifact.

## Artifact limits and deployment boundaries

The v2 SHA-256 directory format binds regular-file bytes, relative UTF-8 names,
entry kinds and empty directories using lengths, so embedded NUL bytes cannot
forge entry boundaries. Dependency files and VCS files are included when
present. Publish a clean release folder to avoid signing mutable VCS metadata.

Artifacts are limited to 1 GiB, 100,000 entries and 64 directory levels.
Verification streams files, detects size/metadata changes during each read, and refuses symlinks,
non-regular files, invalid UTF-8 and literal backslashes in file names. Bundle
dependencies or include their actual regular files; linked workspace trees
are not release artifacts. Manifests are limited to 64 KiB. A signature covers
the bytes being verified, not changes a privileged filesystem writer makes
later: protect release directories and keep them immutable.

This software proof does not close independent security review, final recovery,
provider/platform launch acceptance or stable publication. Those statuses
remain exclusively in MASTER.md §43.

## Qualification and operational checks

C3.42 qualification passed 36 focused native/CLI/PostgreSQL tests, six real
update-preflight checks, eight live SDK checks and one composed owner-browser
journey. The production build, standalone artifact gate and repository gates
passed. Tests use real Ed25519 keys and PostgreSQL. Native tests cover forged/unsigned/unknown-key artifacts, owner-only
trust, confirmed revocation, key rotation, URL binding, modified bytes,
concurrent revocation and actual rollback. Retrying the identical signed update
preserves its original rollback artifact. Doctor checks enabled artifact bytes
and current key trust, and reports cached indexes whose signatures no longer
verify. These checks read local artifacts and public keys; they make no network
request. Public trust records, revocations and registry pins participate in
normal core database backup/restore; publisher private keys are never stored.

The real 64→65 migration rehearsal disabled two legacy registrations while
preserving their metadata, created no trusted keys and left the old catalogue
unpinned. The temporary database was removed afterward. Migration SHA-256:
`2ab011d3737356cda6da4ed536e8d1aa9ac8692b912f7adf4bc4a45693f2009f`.

The owner-browser journey covers trust → verified catalogue → signed install →
update → key rotation → catalogue refresh → revocation → refused rollback and
enable, including keyboard navigation, 320px reflow and both-theme Axe scans.
The offline publisher CLI is exercised with temporary fixture keys. Successful
mutations share the service audit/outbox transaction; refused mutations roll
back without changing trust or installed state. This does not claim a separate
persistent log of refused service calls.
