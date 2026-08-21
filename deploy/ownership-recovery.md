# Ownership, recovery and erasure drills

Freeholder has two different ownership artifacts, because pretending one file
can be both a recoverable system image and a safe data-portability export makes
both less trustworthy:

| Artifact | Contains | Deliberately excludes |
|---|---|---|
| PostgreSQL custom-format dump | All database schemas, queued work and encrypted connected-account credentials | Media bytes, configuration files and environment secrets |
| Logical ownership export | Every application-owned table, with authentication columns redacted; declarative config; recovery metadata; media manifest; checksums | Password/session/token hashes, OAuth credentials, signing secrets, second-factor material, raw environment values and database URLs |

Media bytes remain in the configured object store. `media-manifest.json` is the
bridge: it lists the database's Assets and storage objects, their keys, sizes,
MIME types, checksums where known, lifecycle state, and any database inventory
gap. A complete recovery needs the database dump, separately protected
configuration secrets and the object store.

## Create a secret-safe logical export

Run from a trusted machine with enough protected disk space:

```bash
pnpm ownership:export -- --output /protected/freeholder-export-2026-08-13
```

`EXPORT_DATABASE_URL` overrides `DATABASE_URL`; `--database-url` is also
accepted but can remain in shell history, so the environment form is safer.
The destination must be empty. The command creates files with owner-only modes
where the operating system supports them and never prints row data or a
database URL.

Before releasing an export, inspect:

1. `manifest.json`: every non-system base table appears exactly once, with row
   counts and SHA-256 file checksums.
2. `recovery.json`: `secretValuesIncluded` is false. A configured 32-byte
   `CREDENTIAL_KEY` has a fingerprint, never its value.
3. `media-manifest.json`: investigate `missingInventoryKeys` and
   `unreferencedInventoryKeys`. The former means database metadata references
   an object absent from the inventory ledger; the latter is often an
   interrupted upload awaiting the orphan sweep, but must still be explained.
4. A search for a known test-only token finds nothing. The export code replaces
   authentication-bearing columns explicitly instead of using a loose name
   substring that would erase legitimate fields such as `input_tokens`.

This is a portability and inspection format, not an authentication-state
restore. C3.18 adds the final single-archive/import UX and richer human
projections without weakening this boundary.

## Database backup and scratch restore

Use PostgreSQL client tools at least as new as the server:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file freeholder-2026-08-13.dump "$DATABASE_URL"
sha256sum freeholder-2026-08-13.dump > freeholder-2026-08-13.dump.sha256
```

Do not call an archive a backup until a restore has succeeded. Restore into a
new scratch database, never over the running instance:

```bash
createdb freeholder_restore_drill
pg_restore --no-owner --no-privileges \
  --dbname postgres:///freeholder_restore_drill freeholder-2026-08-13.dump
EXPORT_DATABASE_URL=postgres:///freeholder_restore_drill \
  pnpm ownership:export -- --output /protected/restore-inspection
```

Compare the export manifest, run `doctor` against an application pointed at the
scratch database, sample business/contact/media counts, and verify several
object-store keys and checksums. Drop the scratch database only after recording
the result.

For automated rehearsal, set `TEST_DATABASE_URL` to a disposable database whose
name contains `test` or `drill`, then run:

```bash
pnpm ownership:drill
```

The guard rejects ordinary database names. The drill creates a random restore
database on the same server, runs real `pg_dump` and `pg_restore`, compares the
row count and canonical digest of every non-system table, generates the
secret-safe export from the restored copy, and removes its temporary database
and files. CI runs it on every change.

The DigitalOcean Droplet recipe's nightly script uploads the database archive
to a versioned bucket. Its `verify.md` remains the infrastructure rehearsal;
this repository gate proves the archive itself and the logical inventory.

## Configuration and credential keys

`freeholder.config.ts` is declarative and contains no secrets, so the logical
export copies it. `recovery.json` also copies an explicit allowlist of
non-secret environment configuration and strips URL credentials, queries and
fragments. `.env` is never copied; every known secret variable contributes
only its name and configured/unconfigured state. Keep an encrypted environment
backup in a secrets manager separate from the database archive and record who
can recover it.

`CREDENTIAL_KEY` is uniquely important. The database contains only AES-256-GCM
ciphertext for connected accounts. Losing the key means reconnecting every
account; possessing only the key without the database is not useful. Match the
SHA-256 fingerprint in `recovery.json` before a restore, but retrieve the key
itself only from the separate secrets backup.

Rotate without downtime:

1. Preserve the current key in the secrets backup and record its fingerprint.
2. Generate a new independent 32-byte key.
3. Set the new value as `CREDENTIAL_KEY` and the old value as
   `CREDENTIAL_KEY_PREVIOUS`; deploy both together.
4. Call `connections.rotateCredentials` as a signed-in connection manager with
   required two-factor step-up. Re-run until `failed` is zero; the operation is
   idempotent and resumes after interruption.
5. Run doctor and exercise each connected provider.
6. Remove `CREDENTIAL_KEY_PREVIOUS`, deploy, run doctor again, update the
   secrets backup, and retain the old key only under the backup-retention
   policy needed to restore older database archives.

## Who can reach a connected account

Rotating a key changes how a credential is stored. It does not change *who*
may use it, and those are separate questions with separate answers.

An agent's scopes say what kind of work it may do. They never say whose
account it may do that work with: on an instance holding the owner's mailbox,
a shared shop inbox and a staff member's personal calendar, an agent scoped to
read calendars would otherwise read all three. So reaching a connected account
is a second, narrower permission (`agent_connection_grants`), granted one
agent and one account at a time:

- `connections.grantToAgent` — an owner or connection manager, signed in with
  a fresh second factor, gives one worker `read` or `write` on one account.
- `connections.revokeFromAgent` — takes it back. Deliberately *not* behind
  step-up: removing access is the safe direction and should never wait.
- `connections.grants` lists every grant, including revoked ones. Revocation
  is a timestamp rather than a deletion, so "did that agent ever have access
  to my calendar, and when did it stop" has an answer.
- `connections.mine` is what an agent itself sees: the accounts it was given,
  never the rest, and never a credential.

Two cascades matter when recovering or auditing an instance:

- A provider withdrawing consent (`connections.flag` with `revoked`) revokes
  every agent grant on that account in the same transaction. The list of who
  can reach a mailbox stays true at the moment it matters most.
- An account that merely `needs_reconnect` keeps its grants — an expired token
  is not the owner changing their mind — but cannot be used until it is
  reconnected, and the reconnect notification names how many agents are
  waiting on it.

After restoring a database into a new environment, review `connections.grants`
before resuming agent work: the grants come back with the data, and an
instance restored for testing should usually have them revoked rather than
left pointing at production mailboxes.

If neither current nor previous key decrypts a row, Freeholder marks the
connection `needs_reconnect` instead of deleting ciphertext or retrying into a
provider lockout. A lost key is a reconnect incident, not a reason to weaken
encryption.

## Retention and erasure proof

Erasure applies to the live system and future backups. It cannot alter an
already-created immutable backup. Protect backup access, expire archives on a
documented schedule, and if an old archive is restored, reapply completed
erasure records before that copy can serve users.

The repository's ordinary test gate proves:

- `contact-privacy-rights.test.ts`: complete registered-scope export/erasure,
  customer-login revocation, named legal-retention exceptions, suppression
  evidence, step-up and exact confirmation, artifact expiry and pruning.
- `registry-completeness.test.ts`: every contact-bearing table registers its
  export, erasure and merge behavior instead of becoming a shadow store.
- `media.test.ts`: reversible thirty-day trash, exact owner-only purge,
  scheduled expiry purge, storage-object deletion and orphan cleanup.
- analytics, CSP, sessions, outbox, webhook, notification and job suites:
  bounded retention and scheduled pruning for their operational records.
- `connections.test.ts`: an old backed-up key decrypts during rotation, every
  credential is rewritten under the new key, and the previous key can then be
  removed.

Record restore-drill date, source archive checksum, restored table/row totals,
media discrepancy counts, key fingerprint match, retention/erasure checks and
the operator. Never put raw credentials or personal row contents in the drill
record.
