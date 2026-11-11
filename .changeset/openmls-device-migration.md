---
"freeholder": patch
---
Encrypted member conversations now use a pinned OpenMLS WebAssembly runtime for new messages and call keys. Existing browser devices keep their identity keys and readable history while migrating. Commit recovery and cross-tab locking preserve sender state during retries; erased or removed devices cannot receive new group secrets. The same Rust implementation verifies device key packages on the server. Earlier history transfers retain their approved-device workflow. A failed runtime download can be retried without replacing the device, and encrypted-file controls fit narrow screens in every supported locale. This change does not establish protection against a compromised server or supply the independent security review (C12.39/C11.10).
