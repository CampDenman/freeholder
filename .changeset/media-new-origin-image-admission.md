---
"freeholder": patch
"@freeholder/cli": patch
---

C1.12/C3.30/C10.32/C11.08: refuse new DigitalOcean storage before purchase when
the original account or the pinned application's complete storage runtime
cannot be verified. Reuse the existing signed main-CI image provenance policy
and verify actual manifest, configuration and source-profile bytes. Existing
retained legacy storage keeps its separate path. The complete origin/init/
write-fence/recovery profile remains unpublished while its consumers are
unfinished; no compatible-image or new-provider launch acceptance is claimed.
