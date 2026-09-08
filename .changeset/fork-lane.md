---
"freeholder": minor
---

If you have modified Freeholder's code, updates now arrive as a merge instead
of an image swap. Upstream is merged in a throwaway worktree, conflicts are
reported file by file, and a pull request is opened in your own repository —
your CI is the review. A conflict inside your own plugins, config or
environment stops the lane rather than overwriting your copy. Drift is
reported the way it matters: "2 security releases behind — CVSS 8.1", not a
commit count.
