---
"freeholder": patch
---

Reverts a change made earlier today that would have let Freeholder record a file as erased while the storage provider still held old versions of it. The change asked the provider whether it kept versions and skipped looking for them if it said no. Freeholder's own tests show why that is unsafe: a provider can report that it keeps no versions and retain the bytes anyway, and the search is what proves the erasure actually happened. Providers that cannot list versions are refused for this path, which is the correct outcome rather than a limitation to work around.
