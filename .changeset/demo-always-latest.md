---
"freeholder": patch
---

The public demo at demo.freeholder.ai now updates itself to each promoted build instead of waiting for someone to remember. It had drifted behind the published code because the only deployment path was a manual one. The update repins the demo to the promoted image, checks the site answers afterwards, and puts the previous image straight back if it does not, so a bad build cannot leave the demo down. It refuses outright to touch anything but the demo's own directory.
