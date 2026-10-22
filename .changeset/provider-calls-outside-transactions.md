---
"freeholder": patch
---

Slow or failing outside services can no longer hold your database open or
lose work:

- **Recordings are safer.** Assembling a screen or camera recording keeps
  every recorded piece until the finished file is safely stored, so a storage
  hiccup can simply be retried instead of losing the recording.
- **Text messages are queued, then sent.** A text is recorded in the
  conversation straight away and handed to your SMS provider a moment later.
  Retrying the same send never texts twice, and a provider refusal shows on
  the message (an invalid number is still marked invalid).
- **Calendar sync, mailbox import, number checks, gallery downloads, the
  assistant, page translation drafts and builder proposals** now talk to their
  providers without keeping a database transaction waiting, so one slow
  provider no longer slows the rest of your site.
- **Merging contacts** now also moves documents filed against the duplicate
  contact and signup commissions about them, and undo puts them back.
- The companion app's default ink and accent colours now match the site's
  palette.
