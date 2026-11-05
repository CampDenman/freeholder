---
"freeholder": minor
---
Mail now works on a private preview. Sign-in links and notifications go to the owner addresses listed in `FREEHOLDER_PREVIEW_MAIL_ALLOW` and to the site's own contacts, through the configured mail adapter, up to 100 messages a day (`FREEHOLDER_PREVIEW_MAIL_DAILY_CAP`). Anything else is held, not sent. The owner can read held messages, sign-in links included, in the new preview outbox at Admin → Mail. Campaign and bulk mail are refused while the site is a preview.
