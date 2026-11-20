---
"freeholder": patch
---

The shared migration runner checks the complete committed journal again after
later migrations, including when there are none. A mismatch refuses completion.
This source correction still requires real database and packaged-runtime
qualification before safe-response rollout.
