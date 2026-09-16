---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C3.13: A verified voice or video recording is now copied automatically into the owner's configured storage, transcript included when present, using the media storage conventions: content-addressed keys, content type and a SHA-256 checksum. Retries converge on the same objects instead of duplicating them, and a failed copy stays visible on the recording with an admin retry plus scheduled in-place retries. Contact erasure deletes the imported owner-storage copies through the same durable job receipt as provider copies, and recording retention holds protect them. Recordings above 512 MiB are not imported and report the failure. Live Daily acceptance remains incomplete.
