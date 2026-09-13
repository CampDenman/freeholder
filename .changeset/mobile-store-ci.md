---
"freeholder": minor
"freeholder-app": minor
---

Every change now typechecks, bundles iOS and Android, and fails CI if the demo
app contract cannot be parsed, a store icon or screenshot is missing, or the
privacy answers do not match the permissions the app actually asks for. Apple
and Play checklists ship with the honest note that the stores still decide
review. Signed store binaries still need your Expo account — CI will not spend
that quota on a pull request.
