---
"freeholder": minor
---

Make customer locale selection consistent across the public site, portal,
transactional templates and notifications. Public links now retain the
selected path prefix, while a signed-in customer's linked Contact preference
drives portal rendering, magic-link mail, notification catalog copy, localized
action links and digest wrappers.

Add keyboard-native public and portal language choosers, independently
editable locale variants for CMS header/footer sections, coherent source
chrome fallback, localized public-form boilerplate, and an additive migration
that snapshots recipient locales and upgrades existing header block data.
