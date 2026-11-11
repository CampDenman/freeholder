---
"freeholder": patch
---

Include cached WordPress reader comments in contact export and erasure. Existing
readers stay bound to their unified contact through address changes, merges and
merge undo. Those internal contact bindings stay out of returned import run
and list data, including for keys that can import sources but cannot read CRM
contacts. Publication and erasure lock the same import run so a queued cutover
cannot recreate an erased contact or comment. Commit removes redundant preview
copies, and rollback removes pending comment input while retaining page/media
recovery ownership. Older unbound caches can match the subject's own recorded
prior address. Merged-subject audit payloads are erased while their immutable
actor/action history is preserved; undone identities stay separate.

A source upload begun before an overlapping erasure must be reviewed and uploaded
again before its reader comments can be imported. Upgrade cleanup removes
redundant terminal caches; ambiguous legacy inputs that overlap an acknowledged
erasure lose their cached reader input and require rollback, source review and a
new import before cutover. The owner-facing error contains no reader identity.
This repair supports C2.29/C3.22/C11.10; independent security review and actual
source-specific acceptance remain open.
