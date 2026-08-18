---
"freeholder": minor
---

Plugins now have a real authoring contract: `definePlugin` from `@freeholder/plugin-kit` declares platform compatibility, permissions, migrations and capabilities. The proof module uses it, and boot refuses a plugin that does not fit this instance.
