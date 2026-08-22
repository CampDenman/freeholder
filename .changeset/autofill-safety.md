---
"freeholder": patch
---

Fixed a way a real enquiry could be marked as spam.

Every form carries a hidden field that only an automated script should ever
fill. It was called "website_url" — and that is a name password managers and
iPhone autofill recognise, so a visitor accepting their own saved contact
details could have it filled in for them without ever seeing it. Their genuine
enquiry then landed in the spam queue.

The field is now named for something no browser or password manager reaches
for, and carries the opt-out markers 1Password, LastPass and Bitwarden read.
Turning autofill "off" is only ever a request, and iOS ignores it, so it can
never be the only defence.

Freeholder now also refuses to build if any submit button is greyed out because
an autofillable field looks empty. Browsers fill those fields without telling
the page, so a button gated that way stays dead over a form the person can see
is complete — no error, nothing happening, indistinguishable from a broken
site. Nothing in Freeholder did this; the check is there so nothing ever does.
