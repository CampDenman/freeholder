---
"freeholder": minor
---

Add opt-in private-S3 storage byte quotas shared by every upload and derived
object write. Initialization requires a verified complete inventory. Ambiguous
provider operations retain reserved bytes for reconciliation. This mode uses
bounded proxy uploads; direct multipart is unavailable until it can enforce the
same limit before an upload reaches the provider.
