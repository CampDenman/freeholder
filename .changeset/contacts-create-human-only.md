---
"freeholder": patch
---

`contacts.create` is deliberate entry by a human, and now the platform enforces it: API keys and MCP callers are refused and pointed at `contacts.resolve`, the door automated paths were always supposed to use. The unique email index catches an email-keyed fork, but nothing stopped a key from freely duplicating email-less contacts. The API examples and tests now use `contacts.resolve` as the canonical key-holder mutation.
