---
"freeholder": minor
"@freeholder/sdk": minor
---

An owner can see, before a newsletter goes out, how many people in a segment can actually be mailed. The count is one query: an address, current marketing-email consent, and no active suppression. Starting the campaign freezes the audience and reports the same skip count. Consent is checked again when each copy is sent.

Mail settings explain what sender verification proves for Resend, Postmark and Amazon SES, and show the stored check (domain, identity, provider status, DKIM, return path) without dumping the raw provider payload. The template editor can send one test copy of its wording. A public subscribe form can require the owner's own consent sentence; leaving that sentence off keeps the previous form. Someone who unsubscribed can join again and confirm a second time. A fresh demo installs The Aurora Coast Letter, one published issue, and a campaign template.

This is beta functionality. SMTP and HTTP doubles prove the sending journey. Real provider credentials and live inbox placement remain the owner's acceptance. Editing issues in the block editor, cadence, from-identity, a public-archive flag, issue stats, and a per-customer preference center are not in this change.
