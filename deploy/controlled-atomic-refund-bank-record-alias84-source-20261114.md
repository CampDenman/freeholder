<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Atomic bank record alias successor — source only

C12.38/C9.33/C1.08. Frozen dd3 declares `actual_refund refunds%ROWTYPE` and
also uses `actual_refund` as a scalar JSON-array relation alias in one maximal
progressive-state query. A bare whole-value reference can bind the PL/pgSQL
record instead of the JSON value. Source review identified this before root's
original V7 native first result; no runtime failure is asserted here.

The new owned UNAPPLIED suffix copies both complete functions. It renames ONLY
that nested JSON alias/reference to `current_refund_atom`. The complete A-ready
successor changes ONLY the bank helper's corresponding body SHA literal.
All predicates, other record references, signatures, volatility, output types,
physical rows/currentness/budgets and old generic paths remain unchanged. The
manifest stores both whole predecessor statements and exact reversible edits.
Frozen dd3 and all prior owned/published SQL are unchanged; root alone decides
assembly and qualification. No model/column/kind/service/trigger/index change.

Three prepared source controls pin full reverse equality/body hashes and the
original whole fee native/180s. ALL UNRUN. No compiler/lint/parser/model import,
test, PostgreSQL, native, SDK, provider or host command ran. Source construction
and whitespace checking only; no current authority, closure or stable claim.
