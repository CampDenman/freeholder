---
"freeholder": patch
---

Recording uploads can no longer lose footage silently. Each chunk upload in the record studio retries on failure and is tracked to completion; stopping a recording waits for every chunk, and a recording with missing parts shows a clear retry control instead of assembling with a hole. The server refuses to assemble a capture whose chunk sequence has gaps or whose count falls short of what the recorder produced.
