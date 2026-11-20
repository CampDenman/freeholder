<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact scalar CASE replacement source checkpoint

C12.38/C1.08. SOURCE ONLY; no compiler, SQL parser, PG, tests or native run.
Frozen core and783 stage fragments remain byte-identical. Root previously found
a PostgreSQL PL/pgSQL scanner failure on this scalar CASE expression form in
another new migration; these future definitions have NOT been executed here.

The new owned replacement fragment contains seven COMPLETE existing function
bodies, with only parentheses added around the recorded scalar CASE operands in
IF/ELSIF expressions: require_prefix, before_settlement, stage,
require_current_locks, validate_state_event, validate_route, normalized_plans.
All predicates, real returned-bank/namespace/fee/recipient/full-current-parent
checks, real UUID links, partial capacity, legacy defaults and deferred guards
remain identical. Assignment/statement CASE expressions stay unchanged.

The JSON manifest records exact original source files/hashes, full signatures,
complete before/replacement statement SHA256 and each permitted operand delta.
Root must MATERIALIZE the corrected definitions at their ORIGINAL creation
positions in a NEW forward migration, preserving every other statement and all
triggers. Use CREATE for an originally new function. An appended OR REPLACE
cannot rescue a preceding definition if PostgreSQL validates and rejects it.
No check_function_bodies waiver, stub function or trigger disabling is allowed.
Every published0–84 identity and original source/failure artifact remains intact.

Nine PREPARED/UNRUN source preservation controls prove frozen input identity,
seven exact complete-body differences and absence of table/trigger/validation
waivers. Actual normal migration and exact source-to-installed function/guard
parity remain required; no successful SQL parsing is asserted.
