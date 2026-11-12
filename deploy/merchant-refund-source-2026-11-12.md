<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant refund source evidence — C12.38/C12.26

This is unreleased source qualification. The new merchant model stays disabled.
It does not supply actual provider-account acceptance, an independent security
review, full refund integration, or a stable-release sign-off.

## Original cash and provider transport

The Stripe adapter has a separate, optional original-cash refund operation.
Its caller supplies exactly one existing cash owner: a local payment or an
original subscription charge receipt. Scheduled cash can therefore be returned
before a local invoice/payment exists, without manufacturing either object.
All reads and the physical POST preserve the original platform, actual charge
namespace and frozen API version. Destination refunds use the platform charge
namespace; settlement merchant identity does not change that namespace.

Admission freezes the exact URL-encoded body. The adapter compares that body
before any provider request and sends exactly that string and idempotency key.
It commits the actual returned refund reference through a required callback
before parsing monetary/application evidence. A malformed later field cannot
silently erase the physical resource ACK. Customer refunds omit automatic
application-fee and transfer-reversal flags; their separate recovery remains
required. This source method does not authorize a caller or claim that a
physical request may be repeated.

Recovery retains every authenticated original-account refund found on the
original PaymentIntent, including dashboard refunds with no matching metadata.
Those observations remain unassigned; mutable metadata alone does not prove
which original physical caller created them. Exact already-retained resource
ACKs still allow recovery after metadata is removed. Nullable PaymentIntent
linkage and status, raw requires_action/canceled status, and actual bank-return
references are retained alongside the adapter's normalized logical outcome.
No complete empty list proves an unknown refund was absent.

## Capacity evidence

The pure capacity calculation counts physical refund resources once, retains
extra/contradictory money beyond logical invoice caps, reserves unknown and
customer-action outcomes, and retains unfinished-creator debt after a positive
refund. It cannot choose between contradictory monetary facts or treat an
unbound cancellation as released cash. A later refund failure/action after a
success remains recovery debt; this increment does not supply a complete bank
return reconciliation protocol.

## Qualification and limits

On the isolated refund worktree, explicit Node22.23.2 full TypeScript and
changed-file lint pass. The bounded no-database run passes34 controls:
12 capacity cases and22 real Stripe-factory controls using intercepted HTTP.
They prove original direct/destination headers, one POST, body/key binding,
ACK-before-money callback ordering, nullable fields, existing receipt ownership,
dashboard preservation and original-platform refusal. These are simulated HTTP
responses, not Stripe sandbox or live-account acceptance.

The first run stopped at a new scheduled-list fixture that incorrectly returned
a Refund object instead of Stripe's paginated data envelope. Only that fixture
shape changed. Lint also required explicit string narrowing for provider status
and the encoded body. The subsequent34-control run passes; these failures are
not reported as product defects.

The isolated unregistered service/schema drafts are not part of this adapter
checkpoint or the normal80 journal. Return reservation versus ordinary payment
application must share the original-cash advisory lock, with no reverse lock
order against subscription parent retention. The durable caller/finish/stop,
original cash bindings, fee/recipient/dispute debt, atomic applied-versus-returned
disposition, refund UI/API/MCP parity, populated upgrade and full native/browser
qualification remain required before activation. Current qualified v6 SQL80
remains unchanged.

Primary references checked2026-11-12:
[Stripe Refund object](https://docs.stripe.com/api/refunds/object),
[Stripe refund behavior](https://docs.stripe.com/refunds), and
[Stripe refund creation](https://docs.stripe.com/api/refunds/create).
