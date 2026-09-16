---
"freeholder": patch
---

Close a client gallery properly: its files are served through the session
rather than the public media URL, a rotated PIN ends the sessions the old one
opened, a download limit counts the gallery instead of resetting whenever the
client signs in again, a view-only gallery stops offering downloads, and a
guest invitation now arrives by email with a link the owner can also copy.
