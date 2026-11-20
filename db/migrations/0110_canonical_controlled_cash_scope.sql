-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C11.08: give the controlled cash scope a canonical element order.
--
-- `freeholder_controlled_cash_scope` builds its 32 id arrays with `array_agg`
-- and NOT ONE of those aggregates carries an ORDER BY, so the element order is
-- whatever the plan happened to produce. The scope is semantically a set --
-- `scopeFor` checks each array for duplicates, and the caller already sorts
-- `payments`, `invoices`, `notes` and the namespace keys before taking advisory
-- locks, precisely so the lock order is deterministic. The digest of the scope
-- was the one place that order still mattered.
--
-- `readControlledCashApplicationEvaluation` snapshots the financial parent,
-- does its read-only work, re-reads, and refuses if anything moved. Measured
-- 2026-11-19 under a six-way parallel local run with that comparison
-- instrumented: the parent did NOT move -- same revision, same 404 rows,
-- nothing added, removed or changed -- and the ONLY difference was the scope
-- digest. Same ids, different array order, different digest, and a correct
-- guard refusing a mutation that had not happened:
--
--   {"revision":false,"rowCount":[404,404],"scope":true,
--     "moved":[],"added":[],"removed":[]}
--
-- That is why these suites failed only under load and never in isolation: the
-- width of the window is irrelevant, but contention changes plans, and a
-- changed plan changes `array_agg` order. CI reported it as
-- `controlled-cash-staged-application84` and `controlled-paid-privacy`
-- refusing with "Restore the complete authentic original bank batch ...".
--
-- Fixed at the source rather than in one caller, because there are two
-- TypeScript consumers (`controlled-cash-application-evaluation.ts` and
-- `controlled-provider-paid-bank.ts`) plus SQL callers, and sorting in one of
-- them would have left the others exposed to the same false refusal. The
-- arrays are canonicalised once, at the function's output boundary: every id
-- array ordered, and the namespaces array ordered by its own text. No id is
-- added or removed and no other statement changes, so the scope's MEMBERSHIP
-- is identical -- only its order becomes stable.
DO $migration$
DECLARE source_body text; successor_body text;
 scope_needle text:=$needle$ RETURN jsonb_build_object('subscriptions',to_jsonb(scope_subscriptions),'directInvoices',to_jsonb(scope_direct_invoices),'invoices',to_jsonb(scope_invoices),'payments',to_jsonb(scope_payments),'receipts',to_jsonb(scope_receipts),
  'prorations',to_jsonb(scope_prorations),'funding',to_jsonb(scope_funding),'reservations',to_jsonb(scope_reservations),'applications',to_jsonb(scope_applications),'notes',to_jsonb(scope_notes),
  'resources',to_jsonb(scope_resources),'operations',to_jsonb(scope_operations),'calls',to_jsonb(scope_calls),'quotes',to_jsonb(scope_quotes),'collections',to_jsonb(scope_collections),'refunds',to_jsonb(scope_refunds),
  'requests',to_jsonb(scope_requests),'refundDispatches',to_jsonb(scope_refund_dispatches),'inspections',to_jsonb(scope_inspections),'cashOwners',to_jsonb(scope_cash_owners),'fees',to_jsonb(scope_fees),
  'profiles',to_jsonb(scope_profiles),'contacts',to_jsonb(scope_contacts),'legacyReads',to_jsonb(scope_legacy_reads),'paymentDispatches',to_jsonb(scope_payment_dispatches),'resolutions',to_jsonb(scope_resolutions),
  'dataRequests',to_jsonb(scope_data_requests),'batches',to_jsonb(scope_batches),'receiptProofs',to_jsonb(scope_receipt_proofs),'plans',to_jsonb(scope_plans),'cardReads',to_jsonb(scope_card_reads),'returns',to_jsonb(scope_returns),'namespaces',scope_namespaces);$needle$;
 scope_replacement text:=$replacement$ RETURN jsonb_build_object('subscriptions',to_jsonb(ARRAY(SELECT unnest(scope_subscriptions) ORDER BY 1)),'directInvoices',to_jsonb(ARRAY(SELECT unnest(scope_direct_invoices) ORDER BY 1)),'invoices',to_jsonb(ARRAY(SELECT unnest(scope_invoices) ORDER BY 1)),'payments',to_jsonb(ARRAY(SELECT unnest(scope_payments) ORDER BY 1)),'receipts',to_jsonb(ARRAY(SELECT unnest(scope_receipts) ORDER BY 1)),
  'prorations',to_jsonb(ARRAY(SELECT unnest(scope_prorations) ORDER BY 1)),'funding',to_jsonb(ARRAY(SELECT unnest(scope_funding) ORDER BY 1)),'reservations',to_jsonb(ARRAY(SELECT unnest(scope_reservations) ORDER BY 1)),'applications',to_jsonb(ARRAY(SELECT unnest(scope_applications) ORDER BY 1)),'notes',to_jsonb(ARRAY(SELECT unnest(scope_notes) ORDER BY 1)),
  'resources',to_jsonb(ARRAY(SELECT unnest(scope_resources) ORDER BY 1)),'operations',to_jsonb(ARRAY(SELECT unnest(scope_operations) ORDER BY 1)),'calls',to_jsonb(ARRAY(SELECT unnest(scope_calls) ORDER BY 1)),'quotes',to_jsonb(ARRAY(SELECT unnest(scope_quotes) ORDER BY 1)),'collections',to_jsonb(ARRAY(SELECT unnest(scope_collections) ORDER BY 1)),'refunds',to_jsonb(ARRAY(SELECT unnest(scope_refunds) ORDER BY 1)),
  'requests',to_jsonb(ARRAY(SELECT unnest(scope_requests) ORDER BY 1)),'refundDispatches',to_jsonb(ARRAY(SELECT unnest(scope_refund_dispatches) ORDER BY 1)),'inspections',to_jsonb(ARRAY(SELECT unnest(scope_inspections) ORDER BY 1)),'cashOwners',to_jsonb(ARRAY(SELECT unnest(scope_cash_owners) ORDER BY 1)),'fees',to_jsonb(ARRAY(SELECT unnest(scope_fees) ORDER BY 1)),
  'profiles',to_jsonb(ARRAY(SELECT unnest(scope_profiles) ORDER BY 1)),'contacts',to_jsonb(ARRAY(SELECT unnest(scope_contacts) ORDER BY 1)),'legacyReads',to_jsonb(ARRAY(SELECT unnest(scope_legacy_reads) ORDER BY 1)),'paymentDispatches',to_jsonb(ARRAY(SELECT unnest(scope_payment_dispatches) ORDER BY 1)),'resolutions',to_jsonb(ARRAY(SELECT unnest(scope_resolutions) ORDER BY 1)),
  'dataRequests',to_jsonb(ARRAY(SELECT unnest(scope_data_requests) ORDER BY 1)),'batches',to_jsonb(ARRAY(SELECT unnest(scope_batches) ORDER BY 1)),'receiptProofs',to_jsonb(ARRAY(SELECT unnest(scope_receipt_proofs) ORDER BY 1)),'plans',to_jsonb(ARRAY(SELECT unnest(scope_plans) ORDER BY 1)),'cardReads',to_jsonb(ARRAY(SELECT unnest(scope_card_reads) ORDER BY 1)),'returns',to_jsonb(ARRAY(SELECT unnest(scope_returns) ORDER BY 1)),'namespaces',(SELECT coalesce(jsonb_agg(actual_namespace ORDER BY actual_namespace::text),'[]'::jsonb) FROM jsonb_array_elements(scope_namespaces) actual_namespace));$replacement$;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_controlled_cash_scope(uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'2fcf83d06dd9b39209f208214a6cc40e110b63dd12ac1bcc53fc64ed4b7feb6f' THEN
  RAISE EXCEPTION 'Unexpected controlled cash scope predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,scope_needle,scope_replacement);
 IF successor_body=source_body OR position(scope_needle in successor_body)<>0
  OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'6d586ce4382265c9fda2497f70fdfa21a4aca3426eeb5fffb24366c49597e509' THEN
  RAISE EXCEPTION 'Canonical controlled cash scope composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_controlled_cash_scope(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $body$%s$body$',successor_body);
END $migration$;
--> statement-breakpoint
-- Re-pin the one dependent that hashes the function rewritten above, and then
-- ASSERT the gate, which is what migration 0091 does and what this migration
-- failed to do in its first form.
--
-- `freeholder_credit_atomic_fee_ready()` pins `freeholder_controlled_cash_scope`'s
-- body hash as one of 68 conjuncts. Rewriting that body therefore turned the
-- gate permanently false, and I shipped exactly that: measured on a database
-- migrated from zero, `ready()` was false with the new body and true with the
-- predecessor restored in a rolled-back transaction, so the delta above was the
-- only variable. Nothing failed loudly, because no test asserts the gate
-- against a migrated database -- it is read at runtime by
-- atomic-credit-fee-partition.ts and atomic-credit-invoice-disposition.ts,
-- where a false gate refuses, and by two partition functions that RETURN with
-- no rows rather than raise. Fail-closed, but a permanent production refusal on
-- the atomic-credit-fee path, and the silent-return pair is the "a gate that
-- can be skipped is not a gate" shape this estate has been bitten by before.
--
-- Exactly one installed object pins it -- verified by scanning `pg_proc` for the
-- predecessor hash: this function, one occurrence, and no trigger. The final
-- RAISE is the part that matters most: had it been here originally, the first
-- form of this migration could not have applied.
DO $migration$
DECLARE source_body text; successor_body text;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_credit_atomic_fee_ready()');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'e34d9d62a18172c8b0a4c9565bc775906115204677ee422b258e547ed0497b12' THEN
  RAISE EXCEPTION 'Unexpected atomic credit fee readiness predecessor' USING ERRCODE='23514';
 END IF;
 IF (length(source_body)-length(replace(source_body,'2fcf83d06dd9b39209f208214a6cc40e110b63dd12ac1bcc53fc64ed4b7feb6f','')))/64<>1 THEN
  RAISE EXCEPTION 'Expected exactly one controlled cash scope hash in the readiness gate' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,'2fcf83d06dd9b39209f208214a6cc40e110b63dd12ac1bcc53fc64ed4b7feb6f','6d586ce4382265c9fda2497f70fdfa21a4aca3426eeb5fffb24366c49597e509');
 IF encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'c148118ad019ae080d0e188275a9a8000ad3895634fe2751b991748faaaa193f' THEN
  RAISE EXCEPTION 'Atomic credit fee readiness re-pin composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_credit_atomic_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
 IF NOT freeholder_credit_atomic_fee_ready() THEN
  RAISE EXCEPTION 'Atomic credit fee readiness did not survive the canonical controlled cash scope' USING ERRCODE='23514';
 END IF;
END $migration$;
