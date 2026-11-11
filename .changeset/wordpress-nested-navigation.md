---
"freeholder": minor
---

Keep a WordPress menu's nested links when importing a site. The menu editor
now offers a translated nesting-level choice, and public menus use accessible
nested lists on desktop and mobile. Existing owner menu labels and order stay
intact; imported children join their matching parent.

Menu imports preserve grandchildren, category/tag destinations and ordinary
query/fragment links. Private or vetoed imported pages do not advertise their
labels at cutover. Rollback removes additions from the original nav block and
preserves later owner copies and descendants. Repeated publish/rollback calls
are safe. Invalid, deeper-than-four and unresolved source relationships stay
reported for review. This is source work toward C3.22, not completed WordPress
cutover acceptance or a stable-release sign-off.
