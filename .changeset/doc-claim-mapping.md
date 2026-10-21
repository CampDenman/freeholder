---
"freeholder": patch
---

Every affirmative claim in MASTER.md §§1–42 now maps to a passing acceptance test, a generated artifact, or a same-change strike: `deploy/doc-claim-mapping.md` is the full inventory (all 42 sections, 118 claim rows) and `tests/core/doc-claim-mapping.test.ts` refuses unmapped claims, unresolved evidence paths, and strike rows whose old wording still parses. Ten over-claims were narrowed in the spec itself, including the §25 "MIT plugin-kit" licence line, the §31 "pgvector" retrieval line, the §4.8 instance-release-notes scope, the §28 hosted docs-site promise, and the §21b backup-script path. Closes C11.15.
