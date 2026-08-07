// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The mail adapter contract (MASTER.md §12).
//
// §12 splits mail in two and the split is load-bearing. **Transactional** mail
// — a receipt, a booking confirmation, a password reset — goes through the
// owner's own address, because deliverability follows reputation and replies
// should land in the inbox they already read. **Bulk** mail — a campaign to
// four hundred people — must not: a personal mailbox that starts sending
// broadcasts loses its reputation and takes every receipt down with it.
//
// So `kind` is on the adapter, and the modules that send check it. An owner
// cannot accidentally broadcast through their own Gmail, because the
// email-marketing module refuses an adapter that is not `bulk` or `both`.

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Always present. HTML is an enhancement, never the only copy. */
  text: string;
  html?: string;
  replyTo?: string;
  /** Overrides the configured sender. Rare, and audited when it happens. */
  from?: string;
}

export interface MailAdapter {
  readonly id: "smtp" | "console" | "gmail" | "outlook" | "resend" | "none";
  readonly kind: "transactional" | "bulk" | "both";
  /**
   * Whether this adapter can actually deliver to a stranger.
   *
   * `console` cannot, and the difference matters: a password reset that
   * "succeeds" into a log file is worse than one that refuses, because the
   * person waiting for the email has no way to tell.
   */
  readonly delivers: boolean;
  send(message: OutboundEmail): Promise<{ providerRef: string }>;
}
