---
"freeholder": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C3.13: The voice/video admin credential panel shows the provider's actual expiry on minted LiveKit credentials instead of a hardcoded "expire within 30 minutes" claim. Paradise Comms currently grants 60-second TTLs regardless of the 30 minutes requested, so the old copy was wrong by 30× and could strand an owner mid-setup; the panel now renders the real `expiresAt` in the business timezone (§4.9), and the English, French, Spanish and Arabic `voiceVideo.credentialHelp` strings no longer assert a fixed duration.
