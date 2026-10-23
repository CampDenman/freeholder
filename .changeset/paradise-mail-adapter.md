---
"freeholder": minor
---
Paradise Modern is now one more choice for sending mail, beside SMTP, Gmail, Outlook, Resend, Postmark and Amazon SES. Set `MAIL_ADAPTER=paradise` for account mail or `MAIL_BULK_ADAPTER=paradise` for newsletters, with your Paradise Modern site key. Every message says why it is being sent. A newsletter only goes to people whose sign-up Freeholder has on record, and it keeps your own unsubscribe link. When someone unsubscribes, Paradise Modern is told too. Once any mail has been sent through Paradise Modern, rolling back to an earlier version is forward-only: the earlier release does not accept those records.
