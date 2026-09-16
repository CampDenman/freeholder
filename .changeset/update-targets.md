---
"freeholder": minor
---

Updates now run your deploy target's own update and rollback commands instead
of a single generic one. A droplet swaps an image in seconds, App Platform and
Render hand it to their deploy API, and Replit rebuilds from source in minutes
— and `freeholder doctor` tells you which one you are and what a rollback there
needs. Set `FREEHOLDER_RECIPE_TARGET` so an update actually swaps something;
without it, it migrates and smokes but changes nothing.
