// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SMS carrier seam (MASTER.md §12, §4.14, C7.10).
//
// Consent, quiet hours and who may be messaged stay in core. A vendor only
// transports an already-authorised message, and answers three questions core
// cannot: what can this number do, is it healthy, and what did the carrier say
// happened.
//
// The contract is deliberately larger than "send a string". §4.14 says cost is
// visible per message because "SMS is the one channel where an owner can spend
// real money by accident", and it says an unregistered number silently filtered
// by carriers is the most common way an SMS launch fails. Neither is knowable
// without asking the provider, so both are in the seam.
import type { NotificationChannelAdapter, OutboundNotification } from "../notifications/types";
import type { AdapterStatus, RawProviderRequest } from "../types";

/**
 * What a number can do.
 *
 * Capabilities are per number, not per provider: the same account can hold a
 * long code that cannot send pictures and a toll-free number that can, and
 * offering MMS on the wrong one fails at the carrier rather than at the door.
 */
export interface SmsNumberCapabilities {
  sms: boolean;
  mms: boolean;
  /** Can it receive, or is it send-only? An alphanumeric sender ID cannot. */
  inbound: boolean;
}

export const NUMBER_KINDS = ["long_code", "toll_free", "short_code", "alphanumeric"] as const;

export type SmsNumberKind = (typeof NUMBER_KINDS)[number];

/** One number as the provider describes it. */
export interface SmsNumber {
  /** The provider's own id, so provisioning and health can be re-asked. */
  providerRef: string;
  /** E.164, or the sender ID for an alphanumeric one. */
  e164: string;
  /** ISO-3166-1 alpha-2, because what is legal depends on where it is. */
  country: string | null;
  kind: SmsNumberKind;
  capabilities: SmsNumberCapabilities;
}

/**
 * Whether a number can actually be used right now.
 *
 * Separate from "does it exist", because the failure §4.14 names is a number
 * that exists, looks fine in the console, and is being silently filtered. An
 * adapter that can tell the difference should; one that cannot says so rather
 * than reporting health it did not check.
 */
export interface SmsNumberHealth {
  providerRef: string;
  /** False means do not send: something is wrong the owner must fix. */
  usable: boolean;
  /** What the provider calls its state, verbatim, for support to quote. */
  providerStatus: string | null;
  /** In an owner's words, and actionable, or null when all is well. */
  problem: string | null;
  /** True when the provider could not be asked, so this is not an answer. */
  unknown: boolean;
}

/** What a send actually cost and how far it got. */
export interface SmsSendResult {
  providerRef: string | null;
  delivers: boolean;
  reason?: string;
  /**
   * How many message parts the carrier billed.
   *
   * A GSM-7 text is 160 characters; one emoji makes the whole message UCS-2 at
   * 70. An owner who cannot see that pays three times what they expected and
   * never learns why.
   */
  segments?: number;
  /** Integer minor units (§15.4) with its currency, or neither. */
  costMinor?: number;
  costCurrency?: string;
}

export interface SmsProviderEvent {
  id: string;
  kind: "delivered" | "failed" | "received" | "sent" | "undelivered";
  providerRef: string;
  from?: string;
  to?: string;
  body?: string;
  /** Media the carrier holds, as URLs core will fetch into `core/media`. */
  mediaUrls?: readonly string[];
  /** The provider's own code and words, kept verbatim for support. */
  errorCode?: string;
  errorText?: string;
  segments?: number;
  costMinor?: number;
  costCurrency?: string;
  occurredAt: string;
}

/** What a message to be sent carries beyond the notification contract. */
export interface OutboundSms extends OutboundNotification {
  /** The number to send from, when the business has more than one. */
  from?: string;
  /** Pictures, as URLs the carrier will fetch. MMS only. */
  mediaUrls?: readonly string[];
}

export interface SmsAdapter extends NotificationChannelAdapter {
  readonly channel: "sms";
  readonly status: NotificationChannelAdapter["status"] & AdapterStatus;
  send(message: OutboundSms): Promise<SmsSendResult>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly SmsProviderEvent[]>;
  /**
   * The numbers this account holds.
   *
   * Provisioning is deliberately *listing*, not buying. Buying a number spends
   * the owner's money on a vendor's terms, in a country with its own rules
   * about who may hold one — that belongs in the provider's own console, and a
   * platform that hides it behind one button is a platform that bought
   * somebody the wrong thing.
   */
  listNumbers?(): Promise<readonly SmsNumber[]>;
  /** Whether one number can be used right now, and what is wrong if not. */
  checkNumber?(providerRef: string): Promise<SmsNumberHealth>;
}
