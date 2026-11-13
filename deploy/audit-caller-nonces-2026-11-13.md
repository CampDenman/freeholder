<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Caller nonce audit minimization — 2026-11-13

MASTER §43 C11.10/C12.38. Source review found that internal callback inputs use
nonce holder secrets while the shared service audit redactor matched tokens
and credentials but did not match nonce fields. Successful mutations pass
parsed input through that redactor before audit insertion. These secret fields
could therefore be retained by default. This is a source finding; no production
audit payload or account was inspected and no exposure incident is asserted.

The shared redactor now handles nonce names case-insensitively and recursively,
including arrays, using the existing secret-field policy. The regression
requires top-level, nested completion and mixed-case original nonces to be
redacted while call/read identities and ordinal remain intact and the original
input object remains unchanged.

An initial command collected no matching test because the test was briefly in
the main checkout instead of the isolated integration. That hunk was moved and
the main checkout restored exactly; the empty run supplies no assertion proof.
The corrected BEFORE run against unchanged redactor SHA256
`bb0d416f355ede7f8cc5b3338472c4cdfded78be8e09379db924a71f87c97338`
executes the actual regression and fails once. AFTER the one-field-policy fix,
the complete core service file passes29 actual assertions in0.932seconds with
no database. The test SHA256 is identical between actual BEFORE and AFTER:
`031d311d41b2602adcf8d3ad9248d6a297c325494a225edfb4dd4b153a6a0b34`.

Preserved evidence prefixes:
`/tmp/freeholder-audit-nonce-before-v1-20261113` (zero-match classification),
`/tmp/freeholder-audit-nonce-before-v2-20261113` (actual failing BEFORE), and
`/tmp/freeholder-audit-nonce-after-v1-20261113` (complete passing AFTER).
Full source gates and independent C11.10 review remain required. Narrow
callback audit-input whitelists are a separate source repair; they do not
replace this shared regression or rewrite historical audit rows.
