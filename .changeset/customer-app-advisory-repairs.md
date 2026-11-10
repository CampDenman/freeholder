---
"freeholder": patch
---

Update the customer app's dependency lockfile to patched releases, including node-forge and decode-uri-component. Patch the file-matching libraries used by Expo's fingerprint tool without changing Expo's major version. Both pull-request CI and scheduled security scans now audit this separate dependency tree as well as the server's.
