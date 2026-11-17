---
"freeholder": patch
---
Original uploads whose PUT response is lost before a provider revision is retained can now be recovered through a fresh nonce-bound, full-byte read and complete inventory proof. Unversioned S3 inventory entries now match the same current object revision, allowing their exact original quota reservation to settle without retrying the upload.
