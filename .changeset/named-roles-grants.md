---
"freeholder": patch
---

Replace hard-coded owner/staff/customer rank checks with named, data-backed
roles and normalized per-module view/manage grants. Seed owner, administrator,
editor, bookkeeper, service-provider, and customer defaults; preserve an
unassignable legacy staff role for safe rollback; load grants on every session
resolution; enforce them through services, admin routes, navigation, HTTP, and
MCP; and add localized role/grant management with assignment and audit history.
