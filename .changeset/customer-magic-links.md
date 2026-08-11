---
"freeholder": minor
---

Add passwordless customer sign-in with private 15-minute, one-use magic links
and atomic linking to the existing Contact spine. Requests resist account
enumeration, tokens are hashed at rest and invalidated by changed email or
contact merge, and a scanner-safe GET-to-POST confirmation prevents mail
clients from spending credentials. Magic links refuse every role carrying
admin grants, create privacy-bounded sessions, record login history and contact
timeline evidence, and include scheduled credential cleanup plus English,
French and Spanish customer entry copy.
