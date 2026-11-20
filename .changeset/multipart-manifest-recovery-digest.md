---
"freeholder": patch
---
Unknown multipart completion recovery now hashes persisted part manifests in their canonical field order, so JSONB key reordering cannot falsely invalidate the original completion evidence.
