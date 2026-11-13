// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe documents re_ refunds and pyr_ local-payment refund references:
// https://docs.stripe.com/refunds#tracing-refunds
// This shape never proves original account, resource ownership or money.
export const STRIPE_REFUND_REFERENCE = /^(?:re|pyr)_[A-Za-z0-9_]+$/;
