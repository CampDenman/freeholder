# Media upload and lifecycle operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder treats an uploaded filename and browser MIME as claims. The server
accepts an original only after matching its filename extension, declared type,
byte signature and per-kind size limit. SVG and HTML are not accepted as media.
Images are additionally decoded before they become ready. The original gets a
SHA-256 digest; only safe, owner-visible metadata is retained, never raw EXIF
or GPS fields.

## Limits and paths

| Kind | Accepted formats | Maximum |
|---|---|---:|
| Image | JPEG, PNG, GIF, WebP, AVIF | 25 MB |
| Document | PDF, text, Markdown, CSV, JSON, DOCX, XLSX, PPTX | 100 MB |
| Audio | MP3, WAV, Ogg, FLAC, M4A | 500 MB |
| Video | MP4/M4V, MOV, WebM | 5 GB |

The application proxy is capped at 25 MB. A private S3-compatible adapter
exposes multipart upload instead: the browser sends 8 MB parts to short-lived
presigned URLs, records each ETag, and can resume the durable upload session.
Local and Replit storage state plainly that only the proxy path is available.
A public S3 bucket never receives direct multipart uploads because the staged,
unvalidated object would be reachable before completion.

## Required private-bucket CORS

Allow the deployed Freeholder origin, not `*`. The equivalent S3 JSON is:

```json
[
  {
    "AllowedOrigins": ["https://your-freeholder.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep the bucket private and leave `S3_PUBLIC` unset. Freeholder signs ready
image/audio/video URLs and always streams documents through a controlled,
`nosniff`, attachment-only response. Configure the provider's own rule to
abort incomplete multipart uploads after two days as defence in depth;
Freeholder also aborts its expired sessions hourly.

## Client-gallery asset privacy

Adding an asset to a client gallery marks it private across public media and
project views, including an asset already reused in a published case study.
Publication consent remains required; it does not override private delivery.
Migration `0023_gallery_private_delivery.sql` applies this privacy ceiling to
assets already attached to client galleries. Removing an asset from a gallery
does not automatically make it public again. Use a separate public asset for
public presentation with the required consent.

Controlled gallery routes continue to check the session, item permissions,
watermark/download policy and consent. Consent withdrawal blocks those routes
as well. Keep object storage private; application checks cannot revoke
previously delivered copies or existing signed URLs.

## Form file uploads (C3.38)

A form question of kind `file` takes one file of the kinds it accepts —
`audio`, `doc` or `image`, one or a list — up to its `maxMb`, which may not
exceed the media limit of any accepted kind (image 25 MB, document 100 MB,
audio 500 MB; a list takes the smallest). Local and Replit storage move every
file through the 25 MB application proxy, so a larger answer needs
S3-compatible storage with the CORS above.

Only a signed-in customer can answer a file question. The browser reserves
the upload with provenance `purpose: "form"`, which makes the asset private
from the moment it exists: no public media URL serves it, and the public
resolvers return nothing for it. A signed-out visitor sees "Sign in to
upload" with a link to the portal sign-in instead of a file input; the
upload itself needs JavaScript, and the question says so. The form posts
only the asset id. `forms.submit` refuses an anonymous answer, someone
else's upload, a library (non-form) upload, a file still processing or not
cleared by the scanner, a sniffed kind the question does not accept, a file
over its limit, and a file already attached to a submission (migration
`0059_form_submission_files.sql`'s unique asset index).

The owner opens an attached file from the form's submissions screen
(`/admin/forms/files/<attachment>`), which streams it as a no-store
download for staff with access to forms. The file is part of the contact's
data: the `forms.submissions` privacy source exports each attachment's
facts beside the answers, and erasure trashes the asset with an immediate
purge date so the media purge removes the bytes.

For an intake, the project lists the same attachment beneath its linked form
submission. `projects.get` reads those facts through
`forms.listSubmissionFiles`, with the caller's existing forms authority and
the project's current contact. A project-only scope reveals no file facts;
opening bytes still needs `forms.openSubmissionFile`. Inputs stay outside
portfolio media. Files for another contact, quarantined files and erased
attachments do not appear. Removing the project's submission link removes
its file links from that view without deleting the original submission.

## Malware scanner

Structural validation always runs. With no antivirus engine, assets record
`scan_status = not_configured` and the media console says so; the product never
calls that state clean. To connect an existing self-hosted ClamAV daemon:

```dotenv
MALWARE_SCANNER=clamav
CLAMAV_HOST=clamav.internal
CLAMAV_PORT=3310
```

No file is written to instance disk. The original streams to clamd using its
INSTREAM protocol. A detected signature or scanner error quarantines the
asset, public resolvers return no URL, and the controlled storage route returns
404. **Scan again** re-runs the configured engine. `pnpm doctor` sends ClamAV's
harmless standard test signature and fails unless the engine detects it.

## Durable object inventory and recovery

`media_uploads` is the resumable session state. `media_objects` is the exact
inventory of originals and renditions. Before any application-side write,
Freeholder commits a pending ledger row; attaching it happens in the Asset
transaction. A failed transaction therefore leaves visible cleanup work, not
an unknowable object in a bucket.

- `core.sweepMediaOrphans` runs hourly. It aborts expired multipart sessions,
  removes staged bytes, and deletes pending objects older than 24 hours.
- Moving an asset to trash revokes its resolvers immediately but keeps every
  byte for 30 days.
- Restore returns a non-infected asset to ready state in one action.
- Permanent purge is owner-only, requires fresh step-up authentication and the
  exact filename, and removes every inventoried original/rendition before its
  database row.
- `core.purgeExpiredMedia` processes up to 100 expired trash rows each day.

If a purge is interrupted, the Asset row remains inspectable and the next run
retries idempotent object deletes. Before enabling production traffic, verify
the database/media backup and restore drill required by MASTER.md C1.23; never
use permanent purge as a substitute for that backup policy.

## Verification

After changing storage, CORS or ClamAV:

1. Run `pnpm doctor` and require storage round-trip success. If ClamAV is
   selected, require its test-signature check to pass.
2. Upload one file of each enabled kind. For an object larger than 25 MB,
   interrupt and retry the upload; the progress should resume from listed S3
   parts.
3. Confirm the asset records its canonical MIME, SHA-256, provenance and scan
   truth. Images must have responsive renditions and a focal point.
4. Move an asset to trash and verify both its public resolver and a previously
   known controlled URL return nothing. Restore it and verify delivery returns.
5. On a disposable test asset only, complete step-up, type its exact filename,
   purge it, and verify its inventory and objects are gone.

Migration `0029_closed_rockslide.sql` adds accurate bigint `byte_size`
accounting without changing the previous release's integer `bytes` column,
then adds lifecycle fields and backfills the object inventory for every
existing original and variant. A compatibility trigger mirrors writes made by
the previous release and inventories originals it creates, so an image-swap
rollback remains writable. Do not reverse the migration until all newer
application processes are stopped and a verified backup exists.
