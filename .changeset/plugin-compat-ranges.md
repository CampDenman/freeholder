---
"freeholder": patch
---

Built-in plug-ins now name the Freeholder versions they work with (0.2.x)
instead of claiming to work with every version. Before an update, the
compatibility check compares each installed plug-in with the version you are
updating to and stops, naming the plug-in, if it does not fit. Each new
release must update those ranges before it can be published.
