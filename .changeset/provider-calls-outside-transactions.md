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
  Sending now confirms the text is queued rather than delivered: the
  provider's reference and any refusal arrive a moment later and show as the
  message's delivery status in the inbox (an invalid number is still marked
  invalid). Retrying the same send never texts twice. A marketing text whose
  recipient replied STOP while it waited, or any text whose number was marked
  invalid meanwhile, is not sent.
- **Calendar sync, mailbox import, number checks, gallery downloads, the
  assistant, page translation drafts and builder proposals** now talk to their
  providers without keeping a database transaction waiting, so one slow
  provider no longer slows the rest of your site.
- **Agent approvals** for any of these actions now run once approved, instead
  of staying pending.
- **Merging contacts** now also moves documents, published facts and signup
  commissions filed against the duplicate contact, and undo puts them back.
  If both people had earned the same referral code's signup commission, the
  survivor's stands and the duplicate's unpaid one is reversed.
- The companion app's default ink and accent colours now match the site's
  palette.
