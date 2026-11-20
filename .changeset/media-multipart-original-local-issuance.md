---
"freeholder": patch
---

C1.12/C11.08: record each direct-upload link attempt against its original file,
part sizes and checksums before returning it. Issued links remain visible in
upload recovery and cannot be treated as retired merely because signing finished
or a link expired. Availability remains gated on the full recovery protocol.
