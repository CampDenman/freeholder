---
"freeholder": patch
---

Plugin and registry signatures now use Ed25519 public keys explicitly trusted by a freshly verified owner. Callers cannot supply their own verification secret, agents cannot approve keys, and unsigned artifacts are refused. Registry keys are pinned to their URLs; rotation clears the old catalogue, and revocation blocks future verification and disables matching installed registrations.

Artifact hashes now frame file names and contents unambiguously, include dependencies and directory entries, refuse symbolic links and ambiguous file names, and stream bounded artifacts. Signed updates retain their publisher identity, and rollback re-verifies the actual previous artifact. The migration disables old registrations until the owner verifies them again; old HMAC signatures and version-only rollback records cannot establish trust. Identical update retries preserve rollback history, and Doctor checks enabled bytes and catalogue trust. A publisher CLI and owner controls cover verification, catalogue refresh, rotation and explicitly confirmed permanent revocation. Runtime permission and egress enforcement remain separate open work.
