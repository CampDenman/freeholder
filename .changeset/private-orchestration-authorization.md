---
"freeholder": patch
---

Allow an exact operation-scoped key to complete an explicitly bound private
phase of that operation without adding key scopes or changing the audit actor.
The binding is limited to core services in the same family, the original
caller, the currently authorized invocation and its permitted query/write
kind. Normal human-review and fresh-verification restrictions remain enforced.

Private calls cannot inherit this authority through another operation, actor,
ordinary service transaction or async work after the operation ends. This is
the shared permission boundary for the public import crawler (C3.22/C11.10),
not a security-review sign-off.
