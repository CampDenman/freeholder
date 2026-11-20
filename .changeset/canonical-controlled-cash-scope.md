---
"freeholder": patch
---

Fixes a payment application that could be refused for no reason on a busy site. Before applying cash to an invoice, Freeholder records exactly which records are in scope, does its checks, then looks again and refuses if anything moved underneath it — a deliberate safety check. But the list of records it compared was not built in a stable order, so the same unchanged set of records could come back in a different order and read as a change. On an idle site the order rarely varied; under load it did, and a correct payment was refused with a message about restoring the authentic bank batch. The scope is now recorded in a fixed order, so the check compares what is actually there rather than the order a query happened to return. No record is added to or removed from the scope, and the safety check itself is unchanged — it still refuses a genuine concurrent change.
