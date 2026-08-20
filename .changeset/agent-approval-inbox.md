---
"freeholder": minor
---

The approval inbox. Parked managed writes are decided in one place at `/admin/work/approvals`: approving executes exactly what the agent proposed, exactly once, in the same transaction as the decision and under the approver's own permissions; rejecting requires a note the record keeps; unanswered approvals lapse on schedule and release their tasks. Decisions demand a fresh second factor, only a person can make them, and a decided row is never rewritten.
