---
"freeholder": patch
---

Keep reader erasure in progress until original private import chunks are
confirmed gone. Durable cleanup covers reserved and stored keys, survives
provider outages, and refuses acknowledgement while a source window or any
provider write remains unresolved. Upload reservation and direct comment import
use the same contact identity guard as erasure.

Raw source text, previews and comment bodies no longer enter generic audit
inputs. Typed audit input fields preserve caller/action/subject evidence and
global secret redaction. Erasure also removes named historical content fields
from import/comment audit differences while preserving operation history.
C2.29/C3.22/C11.10 remain open for independent and actual-provider acceptance.

Explicit reader holds protect only the existing original upload IDs through
expiry, replacement and rollback. Cleanup consults the actual current exception,
so removal or expiry releases it. Private request/exception bindings remain
server-side and do not reach source-only run/list keys.
