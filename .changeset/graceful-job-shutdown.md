---
"freeholder": patch
---

Own production termination through Next's manual signal contract, stop startup
retries, and give pg-boss a bounded window to drain active job leases before
the process exits. Document the supervisor grace period and keep the signal
ownership contract in the fast repository gates.
