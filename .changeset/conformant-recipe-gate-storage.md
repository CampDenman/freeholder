---
"freeholder": patch
---

The release validation that proves file storage works on every supported hosting recipe now runs against a storage server that behaves the way real object storage does, so that check passes again instead of failing on the test server's own defect. Ten S3-compatible storage servers were measured for this: four of them, all well-regarded, deleted a file they had been told to delete only if it had not changed — which is why Freeholder tests every storage endpoint's behaviour before trusting it with an original file, rather than trusting its reputation. Nothing about what Freeholder requires of a storage provider has changed. The new test server also checks credentials, so a mistake in how Freeholder signs its storage requests is caught before release rather than after deployment.
