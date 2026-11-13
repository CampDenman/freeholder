<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# First-paid trial tax calendar repair

C12.38. The unchanged actual manual-trial fixture `f0e7b075`, qualified as part
of exact source `f2e612d2`, failed its first native run in5.600 seconds. Real
shared services requested and approved a synthetic seller-specific exemption
expiring in one day, quoted and accepted a seven-day manual trial with a4000
period and500 setup fee, and retained its original commercial terms. No invoice
or payment was created. The actual dated future tax preview at the real
`trialEndsAt` returned no applicable exemption,225 tax and4725 total; the
accepted first-paid quote incorrectly promised4500 with zero tax.

The failure occurred at the final comparison after the prior real-service
assertions passed. Independent UTC readback confirmed the actual accepted
trial, original business ownership, expiry/calendar ordering, five-percent
synthetic rate, zero invoice/payment/refund/provider-operation/charge-receipt
rows and original three retained quotes. The populated failing state is
preserved in `freeholder_trial_tax_expiry80_populated_before_v10_test_20261113`:
20 table count/SHA witnesses, full81-entry881a migration journal and full
public/drizzle schema (5491 columns,2358 constraints,161 triggers,335 functions)
matched source-before, new clone and source-after. All clients drained. Never
migrate or reset that golden. Reports are
`/tmp/freeholder-trial-tax-f0-before-classification-20261113.json` and
`/tmp/freeholder-trial-tax-f0-before-golden-20261113.json`.

The narrow source repair uses the existing UTC `periodEnd` calendar for the
known first-paid trial boundary and following renewal. Acceptance supplies the
actual locked agreement start to the private quote phase; public callers
cannot choose that internal calendar anchor. Initial amounts use the
current date. Existing accepted records and money remain untouched. Source
qualification and the unchanged native AFTER are pending. No actual tax
certificate, tax-authority decision, provider creation or enabled-provider
acceptance is claimed; complete unknown-start, phase, amendment, invoice and
cash integration remains required.
