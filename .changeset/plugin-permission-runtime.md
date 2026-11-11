---
"freeholder": patch
---

Plugin contributions require the owner's approval of their exact declared permissions. Cross-module service calls use a named plugin actor, including when plugin code supplies a system or owner actor; human-review operations remain unavailable to plugins. Plugin service contexts cannot impersonate core events, timeline entries or queued jobs. Changes to permission lists invalidate approval. The Plugins screen explains each requested permission and provides fresh-owner approval and revocation.

Unexpected server runtime failures roll back the current shared mutation and disable the plugin for review, while widget failures stay within their contribution. Earlier committed orchestration phases retain their normal recovery rules. Core backup and recovery include permission consent records. Existing registrations are disabled for permission review during migration. This is enforcement at Freeholder's plugin seams, not a process sandbox (C3.40).
