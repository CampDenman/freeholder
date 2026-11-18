---
"freeholder": patch
---

When an instance cannot finish starting, its log now names the kind of failure instead of only saying it will retry. A packaged or freshly installed Freeholder that could not reach its database repeated `migration unavailable; readiness is unavailable; retrying` with nothing to act on; it now reads `migration unavailable (42703); readiness is unavailable; retrying`, so an operator can tell a missing column from a refused connection from a bad credential without turning on anything extra. Only an error's code or its class name is printed — never its message, its stack or a nested cause, because those carry SQL fragments, connection strings and provider payloads. The code is additionally bounded to a short identifier, so an error that puts something longer in that field falls back to the class name rather than printing it.
