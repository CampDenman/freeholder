---
"freeholder": patch
---

The editor preview keeps up with typing. The canvas rendered only stored state, so every keystroke's preview waited for the 1.2s autosave debounce plus the save round-trip and a frame reload — measured at ~1.4s against the §15.1 budget of 100ms. The editor now broadcasts its local draft to the preview frame on the next animation frame, and the frame layers the draft text onto the typeable elements it already renders; autosave still runs on its own debounce and a save still reloads the frame from stored state, so structure and anything a text patch cannot express reconverge as before.
