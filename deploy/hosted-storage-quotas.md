<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Hosted storage quotas (C10.32)

This opt-in mode applies one byte limit to every native storage write, including
uploads, staged files and generated variants. It uses PostgreSQL reservations
before provider I/O. Unknown provider outcomes keep their reservation and block
another mutation to the same key. A deletion frees bytes only after confirmation.
Reads retain the existing signed URL, expiry and private-object behavior.

Use a private S3 bucket and an instance-exclusive, bucket-scoped credential. Keep
versioning disabled and stop out-of-band writers. The limit covers the native
adapter's current object bytes and unresolved reservations; it is not a provider
invoice cap or authorization to create a bucket, change a subscription or spend.
Hosting/provisioning still requires the owner's normal approval and budget.

## New, empty bucket

After normal migrations, set the instance's private configuration:

```dotenv
FREEHOLDER_STORAGE=s3
FREEHOLDER_STORAGE_QUOTA_BYTES=104857600
FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY=true
S3_PUBLIC=false
```

Keep the ordinary S3 endpoint/region/bucket and scoped credentials private. On
the first write, the adapter verifies complete empty `ListObjectsV2` and
`ListMultipartUploads` results and disabled `GetBucketVersioning`, then commits
the exact namespace's initial inventory. Redirects, malformed/oversized XML,
unknown permissions, retained versioning or any existing object/upload refuse
initialization. Concurrent new processes cannot reset each other's ledger.

For an existing bucket, leave automatic initialization off. A stopped-writer,
complete verified inventory (including orphan/derived/staging objects) must be
passed to `initializeStorageQuota` with `storageInventorySha256(inventory)` and
the exact `storageNamespace({id:'s3',endpoint,bucket})`. This internal operator
function has no HTTP/MCP endpoint and never replaces an existing ledger. Do not
infer empty storage from an empty asset library. A namespace or limit change
requires reconciliation; it does not create an empty allowance.

## Actual upload capability and recovery

This mode omits direct multipart capability: presigned parts currently cannot
enforce the reservation before bytes arrive. Native media uses the existing
25 MB per-file proxy and gives actionable guidance for larger files. Other
storage configurations retain their current multipart capability.

Never clear a pending token because a request timed out or the app restarted.
Reconcile the exact prior provider operation and actual object bytes, with all
writers stopped, before changing its ledger row under the namespace lock.
Preserve the failed operation and its before/after proof. There is deliberately
no timeout-based reservation expiry, guessed zero usage or automatic retry.

Images advertise code support through OCI labels
`io.freeholder.storage.quota.version=1`,
`io.freeholder.storage.quota.proxy_max_bytes=26214400` and
`io.freeholder.storage.quota.unknown=reserved`. These labels describe capability;
the deployed private configuration, ledger and upload acceptance must also be
qualified. They alone do not prove a working hosted site.

## Validation and remaining acceptance

The disposable PostgreSQL16 suite exercises concurrent writers, old/new byte
holds, ambiguous writes/deletes, restart behavior, wrong tokens/namespaces,
verified-empty bootstrap races and immutable inventory. Parser/transport tests
exercise signed fixed-bucket reads, malformed XML, retained multipart uploads,
versioning, redirects and bounded replies. No provider resources are required.

Source validation is separate from C10.32's OPEN hosted acceptance: qualify the
actual image/configuration and scoped provider permissions, owner sign-in and
scoped agent, ordinary upload/variant/read/delete, over-quota refusal, recovery
proof and the public page. No live bucket, deployment, key or provider request
was made during this source preparation.

Provider contracts: [ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html),
[ListMultipartUploads](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html)
and [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/).
