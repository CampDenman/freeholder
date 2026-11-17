---
"freeholder": patch
---

Reading a controlled payment's ancestry now refuses when the underlying journal changes while it is being read. The reader shares one composed journal between its own read and the authority batch to avoid a duplicate query, and that sharing silently removed the only live comparison it had: it was checking a cached value against itself, so a later cash or financial fact landing mid-read was reported as verified ancestry instead of a conflict. The reader now takes the final fresh certificate that the composition contract has always required, matching the two other composed readers. The two fault-injection mocks in its test were also forwarding only two of three arguments, which meant the refusal was being proved in a configuration production never uses; with them corrected the test fails without this fix and passes with it.
