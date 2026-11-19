---
"freeholder": patch
---

Uploads now work on S3-compatible storage that does not keep old versions of objects. Saving a gallery image, a social post, a sealed member file or a crawled import records what the provider did with it, and that record used to require a listing of every version of every object — so a provider which simply does not retain versions could not accept an upload at all, however correctly it behaved otherwise. The listing is now requested only where the bucket itself reports that it keeps versions. A suspended bucket still counts, because it holds the versions it took while it was enabled. Nothing is relaxed about what Freeholder checks of a provider before trusting it with your files: it still refuses an endpoint that accepts a conditional write or delete and then ignores it. Existing sites are unaffected and their stored records stay valid.
