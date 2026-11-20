-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED future parent/batch application protocol.
-- AFTER genuine controlled bank evidence and the complete six target families.
-- No current journal/body is changed. This file is not a permission flag.
CREATE TABLE controlled_cash_application_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 collection_id uuid NOT NULL REFERENCES subscription_controlled_collections(id) ON DELETE RESTRICT,
 quote_id uuid NOT NULL REFERENCES subscription_controlled_quotes(id) ON DELETE RESTRICT,
 resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 protocol text NOT NULL,admission_transaction_id text NOT NULL DEFAULT txid_current()::text,
 bank_revision text NOT NULL,parent_revision text NOT NULL,parent_pg_revision text NOT NULL,pre_application_revision text NOT NULL,
 accepted_quote_digest text NOT NULL,canonical_target_digest text NOT NULL,
 before_entries jsonb NOT NULL,mutable_before_rows jsonb NOT NULL,requested_receipt_ids jsonb NOT NULL,raw_bindings jsonb NOT NULL,
 invoice_before_fingerprint text NOT NULL,invoice_before_status text NOT NULL,
 invoice_before_paid_minor bigint NOT NULL,invoice_before_credited_minor bigint NOT NULL,invoice_before_refunded_minor bigint NOT NULL,
 invoice_before_paid_at text,invoice_before_updated_at text NOT NULL,
 expected_cash_minor bigint NOT NULL,expected_fee_minor bigint NOT NULL,currency text NOT NULL,
 digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_batches_protocol CHECK(protocol='controlled_net_gross.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT controlled_cash_batches_digests CHECK(bank_revision ~ '^[a-f0-9]{64}$' AND parent_revision ~ '^[a-f0-9]{64}$' AND parent_pg_revision ~ '^[a-f0-9]{64}$' AND pre_application_revision ~ '^[a-f0-9]{64}$' AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND canonical_target_digest ~ '^[a-f0-9]{64}$' AND invoice_before_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT controlled_cash_batches_arrays CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries) BETWEEN 1 AND 5000 AND jsonb_typeof(mutable_before_rows)='array' AND jsonb_array_length(mutable_before_rows)<=5000 AND jsonb_typeof(requested_receipt_ids)='array' AND jsonb_array_length(requested_receipt_ids) BETWEEN 1 AND 5000 AND jsonb_typeof(raw_bindings)='array' AND jsonb_array_length(raw_bindings)<=5000),
 CONSTRAINT controlled_cash_batches_amounts CHECK(invoice_before_paid_minor BETWEEN 0 AND 9007199254740991 AND invoice_before_credited_minor BETWEEN 0 AND 9007199254740991 AND invoice_before_refunded_minor=0 AND expected_cash_minor BETWEEN 1 AND 9007199254740991 AND expected_fee_minor BETWEEN 0 AND expected_cash_minor AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT controlled_cash_batches_invoice_status CHECK(invoice_before_status IN('sent','viewed','partially_paid','overdue'))
);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_collection_idx ON controlled_cash_application_batches(collection_id,created_at);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_invoice_idx ON controlled_cash_application_batches(invoice_id,created_at);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_subscription_idx ON controlled_cash_application_batches(subscription_id,created_at);
--> statement-breakpoint
CREATE TABLE controlled_cash_application_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES controlled_cash_application_batches(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,ordinal integer NOT NULL,
 original_observation_id uuid NOT NULL REFERENCES subscription_provider_charge_observations(id) ON DELETE RESTRICT,
 origin_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 origin_call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,origin_fact_id uuid NOT NULL REFERENCES subscription_controlled_facts(id) ON DELETE RESTRICT,
 bank_inspection_id uuid NOT NULL REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,bank_observation_id uuid NOT NULL REFERENCES merchant_cash_return_observations(id) ON DELETE RESTRICT,bank_finish_caller_id uuid NOT NULL,
 immutable_bank_revision text NOT NULL,namespace_revision text NOT NULL,receipt_fingerprint text NOT NULL,
 original_observation_ids jsonb NOT NULL,
 amount_minor bigint NOT NULL,currency text NOT NULL,prior_cash_minor bigint NOT NULL,prior_allocated_fee_minor bigint NOT NULL,fee_minor bigint NOT NULL,
 fee_allocation_revision text NOT NULL,payment_evidence_digest text NOT NULL,payment_idempotency_key text NOT NULL,payment_request_hash text NOT NULL,
 processed_at timestamptz NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_receipts_batch_receipt_key UNIQUE(batch_id,receipt_id),
 CONSTRAINT controlled_cash_receipts_batch_ordinal_key UNIQUE(batch_id,ordinal),
 CONSTRAINT controlled_cash_receipts_payment_key_key UNIQUE(payment_idempotency_key),
 CONSTRAINT controlled_cash_receipts_order CHECK(ordinal BETWEEN 1 AND 5000),
 CONSTRAINT controlled_cash_receipts_amounts CHECK(amount_minor BETWEEN 1 AND 9007199254740991 AND prior_cash_minor BETWEEN 0 AND 9007199254740991 AND prior_allocated_fee_minor BETWEEN 0 AND 9007199254740991 AND fee_minor BETWEEN 0 AND amount_minor AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT controlled_cash_receipts_digests CHECK(immutable_bank_revision ~ '^[a-f0-9]{64}$' AND namespace_revision ~ '^[a-f0-9]{64}$' AND receipt_fingerprint ~ '^[a-f0-9]{64}$' AND fee_allocation_revision ~ '^[a-f0-9]{64}$' AND payment_evidence_digest ~ '^[a-f0-9]{64}$' AND payment_request_hash ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT controlled_cash_receipts_inventory CHECK(jsonb_typeof(original_observation_ids)='array' AND jsonb_array_length(original_observation_ids) BETWEEN 1 AND 5000 AND length(payment_idempotency_key) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX controlled_cash_receipts_receipt_idx ON controlled_cash_application_receipts(receipt_id);
--> statement-breakpoint
CREATE INDEX controlled_cash_receipts_inspection_idx ON controlled_cash_application_receipts(bank_inspection_id);
--> statement-breakpoint
CREATE TABLE controlled_cash_application_links (
 receipt_id uuid PRIMARY KEY REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 receipt_proof_id uuid NOT NULL REFERENCES controlled_cash_application_receipts(id) ON DELETE RESTRICT,
 batch_id uuid NOT NULL REFERENCES controlled_cash_application_batches(id) ON DELETE RESTRICT,
 payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 created_payment_fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_links_payment_key UNIQUE(payment_id),CONSTRAINT controlled_cash_links_proof_key UNIQUE(receipt_proof_id),
 CONSTRAINT controlled_cash_links_fingerprint CHECK(created_payment_fingerprint ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX controlled_cash_links_batch_idx ON controlled_cash_application_links(batch_id);
--> statement-breakpoint
-- Exact finite FK closure. It yields identities, never allowed/principalSafe.
-- No account, amount, current email or fabricated provider phase selects a row.
CREATE FUNCTION freeholder_controlled_cash_scope(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 selected_collection subscription_controlled_collections%ROWTYPE; selected_quote subscription_controlled_quotes%ROWTYPE; selected_resource subscription_controlled_resources%ROWTYPE;
 scope_subscriptions uuid[]=ARRAY[]::uuid[]; scope_direct_invoices uuid[]=ARRAY[]::uuid[]; scope_invoices uuid[]=ARRAY[]::uuid[]; scope_payments uuid[]=ARRAY[]::uuid[]; scope_receipts uuid[]=ARRAY[]::uuid[];
 scope_prorations uuid[]=ARRAY[]::uuid[]; scope_funding uuid[]=ARRAY[]::uuid[]; scope_reservations uuid[]=ARRAY[]::uuid[]; scope_applications uuid[]=ARRAY[]::uuid[]; scope_notes uuid[]=ARRAY[]::uuid[];
 scope_resources uuid[]=ARRAY[]::uuid[]; scope_operations uuid[]=ARRAY[]::uuid[]; scope_calls uuid[]=ARRAY[]::uuid[]; scope_quotes uuid[]=ARRAY[]::uuid[]; scope_collections uuid[]=ARRAY[]::uuid[];
 scope_refunds uuid[]=ARRAY[]::uuid[]; scope_requests uuid[]=ARRAY[]::uuid[]; scope_refund_dispatches uuid[]=ARRAY[]::uuid[]; scope_inspections uuid[]=ARRAY[]::uuid[];
 scope_cash_owners uuid[]=ARRAY[]::uuid[]; scope_fees uuid[]=ARRAY[]::uuid[]; scope_profiles uuid[]=ARRAY[]::uuid[]; scope_contacts uuid[]=ARRAY[]::uuid[]; scope_legacy_reads uuid[]=ARRAY[]::uuid[];
 scope_payment_dispatches uuid[]=ARRAY[]::uuid[]; scope_resolutions uuid[]=ARRAY[]::uuid[]; scope_data_requests uuid[]=ARRAY[]::uuid[]; scope_batches uuid[]=ARRAY[]::uuid[]; scope_receipt_proofs uuid[]=ARRAY[]::uuid[];
 scope_plans uuid[]=ARRAY[]::uuid[]; scope_card_reads uuid[]=ARRAY[]::uuid[]; scope_returns uuid[]=ARRAY[]::uuid[]; scope_namespaces jsonb='[]'::jsonb;
 prior_size integer=-1; current_size integer=0; rounds integer=0; original_funding_uuid uuid; next_funding_uuid uuid; seen_funding uuid[];
BEGIN
 SELECT * INTO selected_collection FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO selected_quote FROM subscription_controlled_quotes WHERE id=selected_collection.quote_id;
 SELECT * INTO selected_resource FROM subscription_controlled_resources WHERE id=selected_quote.resource_id;
 IF selected_collection.id IS NULL OR selected_quote.id IS NULL OR selected_resource.id IS NULL OR selected_collection.invoice_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM subscription_commercial_terms actual_terms WHERE actual_terms.id=selected_collection.terms_id AND actual_terms.subscription_id=selected_resource.subscription_id) THEN
  RAISE EXCEPTION 'Restore the actual accepted target and original resource before discovering cash-application ancestry' USING ERRCODE='23514';END IF;
 scope_subscriptions=ARRAY[selected_resource.subscription_id];
 LOOP
  rounds=rounds+1;IF rounds>5001 THEN RAISE EXCEPTION 'Original financial ancestry exceeds its finite complete bound' USING ERRCODE='23514';END IF;
  SELECT coalesce(array_agg(DISTINCT identities.invoice_id) FILTER(WHERE identities.invoice_id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_direct_invoices FROM(
   SELECT source_event.invoice_id FROM subscription_events source_event WHERE source_event.subscription_id=ANY(scope_subscriptions)
   UNION SELECT original_proration.debit_invoice_id FROM subscription_prorations original_proration WHERE original_proration.subscription_id=ANY(scope_subscriptions)
   UNION SELECT target.invoice_id FROM subscription_controlled_collections target JOIN subscription_controlled_quotes quote_owner ON quote_owner.id=target.quote_id JOIN subscription_controlled_resources resource_owner ON resource_owner.id=quote_owner.resource_id WHERE resource_owner.subscription_id=ANY(scope_subscriptions)
   UNION SELECT actual_payment.invoice_id FROM merchant_agreement_payment_routes actual_route JOIN payments actual_payment ON actual_payment.id=actual_route.payment_id WHERE actual_route.subscription_id=ANY(scope_subscriptions)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_prorations FROM(
   SELECT unnest(scope_prorations) AS id UNION SELECT actual_proration.id FROM subscription_prorations actual_proration WHERE actual_proration.subscription_id=ANY(scope_subscriptions)
   UNION SELECT original_funding.proration_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT target.id FROM invoice_credit_reservations actual_reservation JOIN subscription_prorations target ON actual_reservation.target_source_id=target.subscription_id::text||':proration:'||target.id::text WHERE actual_reservation.id=ANY(scope_reservations)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_notes FROM(
   SELECT unnest(scope_notes) AS id UNION SELECT actual_note.id FROM credit_notes actual_note WHERE actual_note.invoice_id=ANY(scope_direct_invoices)
   UNION SELECT actual_proration.credit_note_id FROM subscription_prorations actual_proration WHERE actual_proration.id=ANY(scope_prorations)
   UNION SELECT original_funding.credit_note_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT selected_collection.credit_note_id
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_funding FROM(
   SELECT unnest(scope_funding) AS id UNION SELECT original_funding.id FROM invoice_credit_funding original_funding WHERE original_funding.proration_id=ANY(scope_prorations) OR original_funding.credit_note_id=ANY(scope_notes)
   UNION SELECT actual_reservation.funding_id FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.id=ANY(scope_reservations) OR actual_reservation.id=ANY(scope_applications)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_reservations FROM(
   SELECT unnest(scope_reservations) AS id UNION SELECT actual_reservation.id FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.funding_id=ANY(scope_funding)
   UNION SELECT original_funding.source_application_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT actual_application.reservation_id),ARRAY[]::uuid[]) INTO scope_applications FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=ANY(scope_reservations);
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_payments FROM(
   SELECT actual_payment.id FROM payments actual_payment WHERE actual_payment.invoice_id=ANY(scope_direct_invoices)
   UNION SELECT original_funding.source_payment_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT principal_part.source_payment_id FROM subscription_proration_principal principal_part WHERE principal_part.proration_id=ANY(scope_prorations)
   UNION SELECT original_attestation.payment_id FROM commercial_payment_attestations original_attestation JOIN subscription_prorations owner_proration
    ON original_attestation.invoice_id IN(owner_proration.original_invoice_id,owner_proration.debit_invoice_id) AND original_attestation.merchant_profile_id=owner_proration.profile_id WHERE owner_proration.id=ANY(scope_prorations)
   UNION SELECT actual_route.payment_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.original_charge_receipt_id=ANY(scope_receipts)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_receipts FROM(
   SELECT actual_receipt.id FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.subscription_id=ANY(scope_subscriptions)
   UNION SELECT actual_route.original_charge_receipt_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=ANY(scope_payments)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_subscriptions FROM(
   SELECT unnest(scope_subscriptions) AS id UNION SELECT actual_receipt.subscription_id FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.id=ANY(scope_receipts)
   UNION SELECT actual_route.subscription_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=ANY(scope_payments)
   UNION SELECT actual_proration.subscription_id FROM subscription_prorations actual_proration WHERE actual_proration.id=ANY(scope_prorations)
  ) identities;
  current_size=cardinality(scope_subscriptions)+cardinality(scope_direct_invoices)+cardinality(scope_payments)+cardinality(scope_receipts)+cardinality(scope_prorations)+cardinality(scope_funding)+cardinality(scope_reservations)+cardinality(scope_applications)+cardinality(scope_notes);
  IF current_size>5000 THEN RAISE EXCEPTION 'Retain complete financial ancestry as review debt instead of truncating its identities' USING ERRCODE='23514';END IF;
  EXIT WHEN current_size=prior_size;prior_size=current_size;
 END LOOP;
 IF EXISTS(SELECT 1 FROM invoice_credit_funding original_funding LEFT JOIN subscription_prorations original_proration ON original_proration.id=original_funding.proration_id
  LEFT JOIN credit_notes actual_note ON actual_note.id=original_funding.credit_note_id LEFT JOIN credit_note_lines actual_line ON actual_line.id=original_funding.credit_note_line_id
  LEFT JOIN payments actual_principal ON actual_principal.id=original_funding.source_payment_id WHERE original_funding.id=ANY(scope_funding) AND(
   original_proration.id IS NULL OR original_proration.credit_note_id IS DISTINCT FROM original_funding.credit_note_id OR original_proration.original_invoice_id IS DISTINCT FROM original_funding.source_invoice_id
   OR actual_note.invoice_id IS DISTINCT FROM original_funding.source_invoice_id OR actual_line.credit_note_id IS DISTINCT FROM actual_note.id OR actual_principal.id IS NULL
   OR(original_funding.source_application_id IS NULL AND actual_principal.invoice_id IS DISTINCT FROM original_funding.source_invoice_id)
   OR EXISTS(SELECT 1 FROM return_requests return_owner WHERE return_owner.credit_note_id=original_funding.credit_note_id))) THEN
  RAISE EXCEPTION 'The original issued credit lines and real principal must retain their exact proration ownership, not a second RMA refund promise' USING ERRCODE='23514';END IF;
 FOREACH original_funding_uuid IN ARRAY scope_funding LOOP
  next_funding_uuid=original_funding_uuid;seen_funding=ARRAY[]::uuid[];
  WHILE next_funding_uuid IS NOT NULL LOOP
   IF next_funding_uuid=ANY(seen_funding) OR cardinality(seen_funding)>5000 THEN RAISE EXCEPTION 'A cyclic credit lineage supplies no principal' USING ERRCODE='23514';END IF;
   seen_funding=array_append(seen_funding,next_funding_uuid);
   SELECT previous_reservation.funding_id INTO next_funding_uuid FROM invoice_credit_funding original_funding
    JOIN invoice_credit_applications previous_application ON previous_application.reservation_id=original_funding.source_application_id
    JOIN invoice_credit_reservations previous_reservation ON previous_reservation.id=previous_application.reservation_id WHERE original_funding.id=next_funding_uuid;
  END LOOP;
 END LOOP;
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_invoices FROM(
  SELECT unnest(scope_direct_invoices) AS id UNION SELECT actual_payment.invoice_id FROM payments actual_payment WHERE actual_payment.id=ANY(scope_payments)
  UNION SELECT original_proration.original_invoice_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
  UNION SELECT original_proration.debit_invoice_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
  UNION SELECT original_funding.source_invoice_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
  UNION SELECT actual_application.invoice_id FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=ANY(scope_applications)
 ) identities;
 SELECT coalesce(array_agg(actual_resource.id),ARRAY[]::uuid[]) INTO scope_resources FROM subscription_controlled_resources actual_resource WHERE actual_resource.subscription_id=ANY(scope_subscriptions);
 SELECT coalesce(array_agg(actual_operation.id),ARRAY[]::uuid[]) INTO scope_operations FROM subscription_controlled_operations actual_operation WHERE actual_operation.resource_id=ANY(scope_resources);
 SELECT coalesce(array_agg(actual_call.id),ARRAY[]::uuid[]) INTO scope_calls FROM subscription_controlled_calls actual_call WHERE actual_call.operation_id=ANY(scope_operations);
 SELECT coalesce(array_agg(actual_quote.id),ARRAY[]::uuid[]) INTO scope_quotes FROM subscription_controlled_quotes actual_quote WHERE actual_quote.resource_id=ANY(scope_resources);
 SELECT coalesce(array_agg(actual_collection.id),ARRAY[]::uuid[]) INTO scope_collections FROM subscription_controlled_collections actual_collection WHERE actual_collection.quote_id=ANY(scope_quotes);
 SELECT coalesce(jsonb_agg(DISTINCT namespace_value), '[]'::jsonb) INTO scope_namespaces FROM(
  SELECT jsonb_build_object('platform',actual_receipt.provider_platform_account_id,'account',actual_receipt.charge_account_id,'intent',actual_receipt.provider_payment_intent_ref,'charge',actual_receipt.provider_charge_ref) AS namespace_value
   FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.id=ANY(scope_receipts)
  UNION SELECT jsonb_build_object('platform',actual_observation.provider_platform_account_id,'account',actual_observation.charge_account_id,'intent',actual_observation.provider_ref,'charge',actual_observation.provider_charge_ref)
   FROM merchant_payment_observations actual_observation WHERE actual_observation.payment_id=ANY(scope_payments)
 ) actual_namespaces;
 SELECT coalesce(array_agg(actual_refund.id),ARRAY[]::uuid[]) INTO scope_refunds FROM refunds actual_refund WHERE actual_refund.payment_id=ANY(scope_payments);
 SELECT coalesce(array_agg(actual_request.id),ARRAY[]::uuid[]) INTO scope_requests FROM merchant_refund_requests actual_request WHERE actual_request.payment_id=ANY(scope_payments) OR actual_request.subscription_charge_receipt_id=ANY(scope_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_namespaces) namespace_value WHERE namespace_value->>'platform'=actual_request.provider_platform_account_id AND namespace_value->>'account' IS NOT DISTINCT FROM actual_request.charge_account_id AND namespace_value->>'intent'=actual_request.original_payment_ref);
 SELECT coalesce(array_agg(actual_dispatch.id),ARRAY[]::uuid[]) INTO scope_refund_dispatches FROM merchant_refund_dispatches actual_dispatch WHERE actual_dispatch.request_id=ANY(scope_requests);
 SELECT coalesce(array_agg(actual_inspection.id),ARRAY[]::uuid[]) INTO scope_inspections FROM merchant_cash_return_inspections actual_inspection WHERE actual_inspection.payment_id=ANY(scope_payments) OR actual_inspection.subscription_charge_receipt_id=ANY(scope_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_namespaces) namespace_value WHERE namespace_value->>'platform'=actual_inspection.provider_platform_account_id AND namespace_value->>'account' IS NOT DISTINCT FROM actual_inspection.charge_account_id AND namespace_value->>'intent'=actual_inspection.original_payment_ref);
 SELECT coalesce(array_agg(actual_owner.id),ARRAY[]::uuid[]) INTO scope_cash_owners FROM original_cash_recoveries actual_owner WHERE actual_owner.payment_id=ANY(scope_payments) OR actual_owner.subscription_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_fee.id),ARRAY[]::uuid[]) INTO scope_fees FROM merchant_fee_refunds actual_fee WHERE actual_fee.payment_id=ANY(scope_payments) OR actual_fee.original_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_profiles FROM(
  SELECT original_terms.profile_id AS id FROM subscription_commercial_terms original_terms WHERE original_terms.subscription_id=ANY(scope_subscriptions)
  UNION SELECT actual_quote.profile_id FROM subscription_controlled_quotes actual_quote WHERE actual_quote.id=ANY(scope_quotes)
  UNION SELECT original_proration.profile_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
 ) identities;
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_contacts FROM(
  SELECT actual_parent.contact_id AS id FROM subscriptions actual_parent WHERE actual_parent.id=ANY(scope_subscriptions)
  UNION SELECT actual_invoice.contact_id FROM invoices actual_invoice WHERE actual_invoice.id=ANY(scope_invoices)
  UNION SELECT actual_profile.contact_id FROM merchant_tax_profiles actual_profile WHERE actual_profile.id=ANY(scope_profiles)
  UNION SELECT actual_policy.merchant_contact_id FROM subscription_market_policies actual_policy WHERE actual_policy.subscription_id=ANY(scope_subscriptions)
 ) identities;
 SELECT coalesce(array_agg(actual_read.id),ARRAY[]::uuid[]) INTO scope_legacy_reads FROM legacy_bank_reads actual_read WHERE actual_read.refund_id=ANY(scope_refunds);
 SELECT coalesce(array_agg(actual_dispatch.id),ARRAY[]::uuid[]) INTO scope_payment_dispatches FROM merchant_payment_dispatches actual_dispatch WHERE actual_dispatch.payment_id=ANY(scope_payments);
 SELECT coalesce(array_agg(actual_resolution.id),ARRAY[]::uuid[]) INTO scope_resolutions FROM merchant_unapplied_charge_resolutions actual_resolution WHERE actual_resolution.payment_id=ANY(scope_payments) OR actual_resolution.subscription_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_request.id),ARRAY[]::uuid[]) INTO scope_data_requests FROM data_requests actual_request WHERE actual_request.contact_id=ANY(scope_contacts);
 SELECT coalesce(array_agg(actual_batch.id),ARRAY[]::uuid[]) INTO scope_batches FROM controlled_cash_application_batches actual_batch WHERE actual_batch.subscription_id=ANY(scope_subscriptions) OR actual_batch.invoice_id=ANY(scope_invoices);
 SELECT coalesce(array_agg(actual_proof.id),ARRAY[]::uuid[]) INTO scope_receipt_proofs FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=ANY(scope_batches) OR actual_proof.receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_plan.id),ARRAY[]::uuid[]) INTO scope_plans FROM payment_plans actual_plan WHERE actual_plan.invoice_id=ANY(scope_invoices);
 SELECT coalesce(array_agg(actual_read.id),ARRAY[]::uuid[]) INTO scope_card_reads FROM subscription_proration_card_reads actual_read WHERE actual_read.payment_id=ANY(scope_payments) OR EXISTS(SELECT 1 FROM subscription_proration_payment_protocols original_protocol WHERE original_protocol.payment_id=actual_read.payment_id AND original_protocol.proration_id=ANY(scope_prorations));
 SELECT coalesce(array_agg(actual_return.id),ARRAY[]::uuid[]) INTO scope_returns FROM return_requests actual_return WHERE actual_return.credit_note_id=ANY(scope_notes) OR actual_return.refund_id=ANY(scope_refunds)
  OR EXISTS(SELECT 1 FROM return_refund_allocations original_allocation WHERE original_allocation.return_id=actual_return.id AND original_allocation.payment_id=ANY(scope_payments));
 RETURN jsonb_build_object('subscriptions',to_jsonb(scope_subscriptions),'directInvoices',to_jsonb(scope_direct_invoices),'invoices',to_jsonb(scope_invoices),'payments',to_jsonb(scope_payments),'receipts',to_jsonb(scope_receipts),
  'prorations',to_jsonb(scope_prorations),'funding',to_jsonb(scope_funding),'reservations',to_jsonb(scope_reservations),'applications',to_jsonb(scope_applications),'notes',to_jsonb(scope_notes),
  'resources',to_jsonb(scope_resources),'operations',to_jsonb(scope_operations),'calls',to_jsonb(scope_calls),'quotes',to_jsonb(scope_quotes),'collections',to_jsonb(scope_collections),'refunds',to_jsonb(scope_refunds),
  'requests',to_jsonb(scope_requests),'refundDispatches',to_jsonb(scope_refund_dispatches),'inspections',to_jsonb(scope_inspections),'cashOwners',to_jsonb(scope_cash_owners),'fees',to_jsonb(scope_fees),
  'profiles',to_jsonb(scope_profiles),'contacts',to_jsonb(scope_contacts),'legacyReads',to_jsonb(scope_legacy_reads),'paymentDispatches',to_jsonb(scope_payment_dispatches),'resolutions',to_jsonb(scope_resolutions),
  'dataRequests',to_jsonb(scope_data_requests),'batches',to_jsonb(scope_batches),'receiptProofs',to_jsonb(scope_receipt_proofs),'plans',to_jsonb(scope_plans),'cardReads',to_jsonb(scope_card_reads),'returns',to_jsonb(scope_returns),'namespaces',scope_namespaces);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_scope_ids(actual_scope jsonb,scope_key text) RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE ids uuid[];
BEGIN
 IF jsonb_typeof(actual_scope->scope_key) IS DISTINCT FROM 'array' OR jsonb_array_length(actual_scope->scope_key)>5000 THEN RAISE EXCEPTION 'Restore a complete exact financial identity array' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid),ARRAY[]::uuid[]) INTO ids FROM jsonb_array_elements_text(actual_scope->scope_key);
 IF cardinality(ids)<>(SELECT count(DISTINCT value) FROM unnest(ids) value) THEN RAISE EXCEPTION 'Repeated financial identities cannot hide missing rows' USING ERRCODE='23514';END IF;
 RETURN ids;
END $$;
--> statement-breakpoint
-- Independent complete PostgreSQL row-SHA snapshot. Every selector below is a
-- source-owned literal over the actual FK closure; neither caller input nor a
-- JSON before-image can invent a table, amount owner, account or SQL predicate.
CREATE FUNCTION freeholder_controlled_cash_parent_entries(target_collection_uuid uuid)
RETURNS TABLE(family text,identity text,fingerprint text) LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_scope jsonb; descriptor record; returned_count integer; total_count integer=0;
BEGIN
 actual_scope=freeholder_controlled_cash_scope(target_collection_uuid);
 FOR descriptor IN SELECT * FROM(VALUES
  ('subscriptions','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_commercial_terms','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_merchant_scopes','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_market_policies','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_events','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_resources','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_operations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_erasures','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')) OR observed.profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('subscription_commercial_amendments','observed.terms_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_commercial_resumptions','observed.terms_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_generations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_charge_receipts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('subscription_provider_charge_observations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_invoice_observations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_invoice_lines','observed.id','EXISTS(SELECT 1 FROM subscription_provider_invoice_observations owner_observation WHERE owner_observation.id=observed.observation_id AND owner_observation.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')))'),
  ('subscription_provider_read_tickets','observed.read_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_read_finishes','observed.read_id','EXISTS(SELECT 1 FROM subscription_provider_read_tickets actual_ticket WHERE actual_ticket.read_id=observed.read_id AND actual_ticket.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')))'),
  ('subscription_provider_read_stops','observed.read_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_controlled_resources','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('subscription_controlled_operations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''operations''))'),
  ('subscription_controlled_calls','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_facts','observed.id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_finishes','observed.call_id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_stops','observed.call_id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_verifications','observed.operation_id','observed.operation_id=ANY(freeholder_controlled_cash_scope_ids($1,''operations''))'),
  ('subscription_controlled_charge_origins','observed.receipt_id','observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('subscription_controlled_closures','observed.resource_id','observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('subscription_controlled_quotes','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''quotes''))'),
  ('subscription_controlled_collections','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_components','observed.id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_invoice_bindings','observed.collection_id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_item_receipts','observed.component_id','EXISTS(SELECT 1 FROM subscription_controlled_components actual_component WHERE actual_component.id=observed.component_id AND actual_component.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections'')))'),
  ('subscription_controlled_invoice_proofs','observed.id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('invoices','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_lines','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_market_policies','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_merchant_tax_quotes','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_merchant_tax_quote_lines','observed.invoice_line_id','EXISTS(SELECT 1 FROM invoice_lines original_line WHERE original_line.id=observed.invoice_line_id AND original_line.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices'')))'),
  ('tax_lines','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('credit_notes','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''notes''))'),
  ('credit_note_lines','observed.id','observed.credit_note_id=ANY(freeholder_controlled_cash_scope_ids($1,''notes''))'),
  ('payments','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('payment_disputes','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('refunds','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds''))'),
  ('money_state_events','observed.id','(observed.subject_type=''payment'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))) OR(observed.subject_type=''invoice'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))) OR(observed.subject_type=''refund'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds''))) OR(observed.subject_type=''payment_plan'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans'')))'),
  ('merchant_agreement_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR observed.original_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('merchant_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('payment_merchant_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_invoice_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('invoice_merchant_allocations','observed.id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_allocation_lines','observed.invoice_line_id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.allocation_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_collections','observed.allocation_id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.allocation_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_scopes','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''directInvoices'')) OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes actual_route WHERE actual_route.invoice_id=observed.invoice_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('merchant_payment_observations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND namespace_value->>''intent''=observed.provider_ref)'),
  ('merchant_payment_event_receipts','observed.id','observed.claimed_payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND(observed.evidence->>''providerRef''=namespace_value->>''intent'' OR(namespace_value->>''charge'' IS NOT NULL AND observed.evidence->>''providerChargeRef''=namespace_value->>''charge'')))'),
  ('merchant_payment_requests','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_dispatches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_dispatch_finishes','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_dispatch_stops','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_resource_bindings','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_creation_refusals','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_retirement_acks','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_terminal_receipts','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_fee_refunds','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''fees''))'),
  ('merchant_fee_observations','observed.id','observed.operation_id=ANY(freeholder_controlled_cash_scope_ids($1,''fees''))'),
  ('merchant_refund_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_reservation_retirements','observed.request_id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_dispatches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_dispatch_finishes','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_dispatch_stops','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_creation_refusals','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_terminal_receipts','observed.request_id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_resource_bindings','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_observations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR observed.subscription_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND namespace_value->>''intent''=observed.payment_provider_ref)'),
  ('merchant_refund_observation_captures','observed.id','EXISTS(SELECT 1 FROM merchant_refund_observations owner_observation WHERE owner_observation.id=observed.observation_id AND(owner_observation.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR owner_observation.subscription_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR owner_observation.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=owner_observation.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM owner_observation.charge_account_id AND namespace_value->>''intent''=owner_observation.payment_provider_ref)))'),
  ('merchant_refund_state_reads','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_state_read_finishes','observed.read_id','EXISTS(SELECT 1 FROM merchant_refund_state_reads actual_read WHERE actual_read.id=observed.read_id AND actual_read.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')))'),
  ('merchant_refund_current_receipts','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_cash_return_inspections','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('subscription_controlled_cash_inspection_lineages','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('merchant_cash_return_inspection_finishes','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_inspection_stops','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_primary_observations','observed.id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_observations','observed.id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_unapplied_charge_resolutions','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''resolutions''))'),
  ('merchant_unapplied_charge_resolution_refunds','observed.resolution_id::text||'':''||observed.observation_id::text','observed.resolution_id=ANY(freeholder_controlled_cash_scope_ids($1,''resolutions''))'),
  ('original_cash_recoveries','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_operations','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_facts','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_closures','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('legacy_bank_reads','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_facts','observed.id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_finishes','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_current_receipts','observed.id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_stops','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_feedback','observed.id','EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE observed.evidence->>''observedChargeAccountId'' IS NOT DISTINCT FROM namespace_value->>''account'' AND(observed.evidence->>''observedPlatformAccountId'' IS NULL OR observed.evidence->>''observedPlatformAccountId''=namespace_value->>''platform'') AND(observed.evidence->>''observedPaymentRef''=namespace_value->>''intent'' OR(observed.evidence->>''observedPaymentRef'' IS NULL AND namespace_value->>''charge'' IS NOT NULL AND observed.evidence->>''observedChargeRef''=namespace_value->>''charge''))) OR EXISTS(SELECT 1 FROM refunds original_refund JOIN payments original_payment ON original_payment.id=original_refund.payment_id WHERE original_refund.id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds'')) AND original_refund.provider_ref=observed.evidence->>''observedRefundRef'')'),
  ('commercial_payment_attestations','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('commercial_refund_attestations','observed.refund_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('commercial_fee_attestations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('invoice_credit_funding','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''funding''))'),
  ('invoice_credit_reservations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''reservations''))'),
  ('invoice_credit_applications','observed.reservation_id','observed.reservation_id=ANY(freeholder_controlled_cash_scope_ids($1,''applications''))'),
  ('invoice_credit_releases','observed.reservation_id','observed.reservation_id=ANY(freeholder_controlled_cash_scope_ids($1,''reservations''))'),
  ('subscription_prorations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_principal','observed.id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_credit_uses','observed.id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('agreement_fee_duties','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_credit_assignments','observed.application_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_cash_assignments','observed.payment_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_eligibility','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_remittances','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('subscription_proration_cash_confirmations','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_credit_confirmations','observed.application_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_payment_protocols','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) OR observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('subscription_proration_card_mandates','observed.proration_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_card_attempts','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) OR observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('subscription_proration_card_jobs','observed.proration_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_card_reads','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('subscription_proration_card_read_finishes','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('subscription_proration_card_read_stops','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('payment_methods','observed.id','EXISTS(SELECT 1 FROM subscriptions actual_parent WHERE actual_parent.id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')) AND actual_parent.payment_method_id=observed.id) OR EXISTS(SELECT 1 FROM subscription_proration_card_mandates actual_mandate WHERE actual_mandate.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) AND actual_mandate.payment_method_id=observed.id)'),
  ('merchant_tax_profiles','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('merchant_tax_profile_versions','observed.id','observed.profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('tax_registrations','observed.id','observed.merchant_profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('contacts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''contacts''))'),
  ('data_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''dataRequests''))'),
  ('privacy_retention_exceptions','observed.id','observed.data_request_id=ANY(freeholder_controlled_cash_scope_ids($1,''dataRequests''))'),
  ('return_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('return_items','observed.id','observed.return_id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('return_refund_allocations','observed.id','observed.return_id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('payment_plans','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''plans''))'),
  ('payment_plan_installments','observed.id','observed.plan_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans''))'),
  ('payment_allocations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM payment_plan_installments actual_installment WHERE actual_installment.id=observed.installment_id AND actual_installment.plan_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans'')))'),
  ('controlled_cash_application_batches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''batches''))'),
  ('controlled_cash_application_receipts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''receiptProofs''))'),
  ('controlled_cash_application_links','observed.receipt_id','observed.batch_id=ANY(freeholder_controlled_cash_scope_ids($1,''batches'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))')
 ) AS declared_family(table_name,identity_sql,scope_sql) LOOP
  RETURN QUERY EXECUTE format('SELECT %L::text,(%s)::text,encode(sha256(convert_to(to_jsonb(observed)::text,''UTF8'')),''hex'') FROM %I observed WHERE %s ORDER BY 2 LIMIT 5001',descriptor.table_name,descriptor.identity_sql,descriptor.table_name,descriptor.scope_sql) USING actual_scope;
  GET DIAGNOSTICS returned_count=ROW_COUNT;total_count=total_count+returned_count;
  IF total_count>5000 THEN RAISE EXCEPTION 'Retain complete financial parent/source rows as review debt; no truncated proof can admit money' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_parent_snapshot(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_entries jsonb; actual_count integer; actual_revision text;
BEGIN
 SELECT count(*),jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_count,actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(target_collection_uuid) actual_entry;
 IF actual_count NOT BETWEEN 1 AND 5000 OR actual_revision IS NULL THEN RAISE EXCEPTION 'The complete actual financial parent cannot be an empty or truncated proof' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('entries',actual_entries,'revision',actual_revision,'physicalRowCount',actual_count);
END $$;
--> statement-breakpoint
-- Normalize ONLY the shared money spine's explicitly proved invoice columns.
-- Every other live column remains in the full PostgreSQL row SHA, including
-- actual buyer/source/tax/legal fields; no billing before-image is duplicated.
CREATE FUNCTION freeholder_controlled_cash_normalized_invoice(target_batch_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_invoice invoices%ROWTYPE; settled_cash numeric; settled_count integer; planned_count integer; actual_status text; actual_paid_at timestamptz; restored_fingerprint text;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_invoice.id IS NULL THEN RAISE EXCEPTION 'Normalize only this actual transaction and original canonical invoice' USING ERRCODE='23514';END IF;
 SELECT count(*),coalesce(sum(actual_payment.amount_minor),0) INTO settled_count,settled_cash
 FROM controlled_cash_application_links actual_link JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.batch_id=actual_link.batch_id AND receipt_proof.receipt_id=actual_link.receipt_id
 JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE actual_link.batch_id=admitted_batch.id AND actual_payment.status='succeeded';
 SELECT count(*) INTO planned_count FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF settled_count>planned_count OR settled_cash>admitted_batch.expected_cash_minor OR actual_invoice.paid_minor::numeric IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric+settled_cash
  OR actual_invoice.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_invoice.refunded_minor IS DISTINCT FROM admitted_batch.invoice_before_refunded_minor
  OR actual_invoice.currency IS DISTINCT FROM admitted_batch.currency OR actual_invoice.paid_minor::numeric+actual_invoice.credited_minor>actual_invoice.total_minor::numeric THEN
  RAISE EXCEPTION 'Actual settled receipts must conserve the exact prior cash, issued credit and unpaid remainder' USING ERRCODE='23514';END IF;
 actual_status=CASE WHEN settled_count=0 THEN admitted_batch.invoice_before_status WHEN actual_invoice.paid_minor+actual_invoice.credited_minor=actual_invoice.total_minor THEN 'paid' ELSE 'partially_paid' END;
 IF actual_invoice.status IS DISTINCT FROM actual_status THEN RAISE EXCEPTION 'A partial receipt cannot become a paid invoice or erase its remainder' USING ERRCODE='23514';END IF;
 IF actual_status='paid' THEN
  SELECT receipt_proof.processed_at INTO actual_paid_at FROM controlled_cash_application_receipts receipt_proof JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=receipt_proof.batch_id AND actual_link.receipt_id=receipt_proof.receipt_id
   JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE receipt_proof.batch_id=admitted_batch.id AND actual_payment.status='succeeded' ORDER BY receipt_proof.ordinal DESC LIMIT 1;
 ELSE actual_paid_at=admitted_batch.invoice_before_paid_at::timestamptz;END IF;
 IF actual_invoice.paid_at IS DISTINCT FROM actual_paid_at THEN RAISE EXCEPTION 'Preserve the actual shared settlement date; no fabricated paid time supplies access' USING ERRCODE='23514';END IF;
 restored_fingerprint=encode(sha256(convert_to((to_jsonb(actual_invoice)||jsonb_build_object('status',admitted_batch.invoice_before_status,'paid_minor',admitted_batch.invoice_before_paid_minor,
  'paid_at',admitted_batch.invoice_before_paid_at::timestamptz,'updated_at',admitted_batch.invoice_before_updated_at::timestamptz))::text,'UTF8')),'hex');
 IF restored_fingerprint IS DISTINCT FROM admitted_batch.invoice_before_fingerprint THEN RAISE EXCEPTION 'Only exact own cash/status/date columns may differ from the original complete invoice row' USING ERRCODE='23514';END IF;
 RETURN restored_fingerprint;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_normalized_payment(target_payment_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_payment payments%ROWTYPE; actual_link controlled_cash_application_links%ROWTYPE; admitted_receipt controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; restored_fingerprint text; expected_hash text;
BEGIN
 SELECT * INTO actual_payment FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO actual_link FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO admitted_receipt FROM controlled_cash_application_receipts WHERE id=actual_link.receipt_proof_id;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=actual_link.batch_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=actual_link.receipt_id;
 IF actual_payment.id IS NULL OR actual_link.receipt_id IS NULL OR admitted_receipt.id IS NULL OR admitted_batch.id IS NULL OR original_receipt.id IS NULL
  OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR admitted_receipt.batch_id IS DISTINCT FROM admitted_batch.id OR admitted_receipt.receipt_id IS DISTINCT FROM actual_link.receipt_id
  OR actual_payment.invoice_id IS DISTINCT FROM admitted_batch.invoice_id OR actual_payment.provider IS DISTINCT FROM 'stripe' OR actual_payment.method IS DISTINCT FROM 'provider_schedule'
  OR actual_payment.amount_minor IS DISTINCT FROM admitted_receipt.amount_minor OR actual_payment.currency IS DISTINCT FROM admitted_receipt.currency
  OR actual_payment.idempotency_key IS DISTINCT FROM admitted_receipt.payment_idempotency_key OR actual_payment.request_hash IS DISTINCT FROM admitted_receipt.payment_request_hash
  OR actual_payment.refunded_minor<>0 OR actual_payment.provider_checkout_ref IS NOT NULL OR actual_payment.failure_code IS NOT NULL OR actual_payment.failure_message IS NOT NULL OR actual_payment.failed_at IS NOT NULL
  OR actual_payment.metadata IS DISTINCT FROM '{}'::jsonb OR actual_payment.status NOT IN('created','processing','succeeded')
  OR actual_payment.provider_ref IS NOT NULL AND actual_payment.provider_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_payment.status='created' AND actual_payment.provider_ref IS NOT NULL
  OR actual_payment.status='succeeded' AND(actual_payment.provider_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref OR actual_payment.processed_at IS DISTINCT FROM admitted_receipt.processed_at)
  OR actual_payment.status<>'succeeded' AND actual_payment.processed_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(admitted_batch.before_entries) original_entry WHERE original_entry->>'table'='payments' AND original_entry->>'id'=actual_payment.id::text) THEN
  RAISE EXCEPTION 'Only the genuine new exact receipt-owned payment may cross this canonical stage; never reuse an equal or historical payment' USING ERRCODE='23514';END IF;
 IF admitted_receipt.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||original_receipt.id::text THEN
  RAISE EXCEPTION 'Bind actual receipt identity to its canonical request, not to amount equality' USING ERRCODE='23514';END IF;
 -- This exact shared payment DTO has only ASCII UUID/constants and an integer
 -- <=MAX_SAFE_INTEGER. Reproduce its canonical key order, not jsonb spacing.
 expected_hash=encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
  admitted_receipt.amount_minor,admitted_receipt.payment_idempotency_key,admitted_batch.invoice_id,original_receipt.id),'UTF8')),'hex');
 IF actual_payment.request_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'The complete real shared createPayment input must match the original exact receipt proof' USING ERRCODE='23514';END IF;
 restored_fingerprint=encode(sha256(convert_to((to_jsonb(actual_payment)||jsonb_build_object('status','created','provider_ref',null,'processed_at',null,'failure_code',null,'failure_message',null,'updated_at',actual_payment.created_at))::text,'UTF8')),'hex');
 IF restored_fingerprint IS DISTINCT FROM actual_link.created_payment_fingerprint THEN RAISE EXCEPTION 'Only the exact shared created-to-processing-to-settled fields may change the actual newly linked payment row' USING ERRCODE='23514';END IF;
 RETURN restored_fingerprint;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_ref(actual_ref jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(actual_ref)='string' THEN actual_ref#>>'{}' WHEN jsonb_typeof(actual_ref)='object' AND jsonb_typeof(actual_ref->'id')='string' THEN actual_ref->>'id' ELSE null END
$$;
--> statement-breakpoint
-- Current complete bank invoice inventory remains observational. Real captured
-- sources are selected by their ACTUAL PI/namespace/creator FKs before amounts
-- are checked; no sum or balance creates ownership of an unassigned receipt.
CREATE FUNCTION freeholder_controlled_cash_bank_invoice(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_resource subscription_controlled_resources%ROWTYPE;
 actual_binding subscription_controlled_invoice_bindings%ROWTYPE; actual_proof subscription_controlled_invoice_proofs%ROWTYPE; actual_operation subscription_controlled_operations%ROWTYPE; actual_verification subscription_controlled_verifications%ROWTYPE;
 actual_inventory jsonb; actual_manifest jsonb; actual_invoice jsonb; intent_atom jsonb; intent_ref text; seen_intents text[]=ARRAY[]::text[]; received_minor bigint; total_received numeric=0;
 payment_atom jsonb; payment_ref text; seen_payments text[]=ARRAY[]::text[]; payment_minor bigint; payment_sum numeric; cash_atom jsonb; cash_count integer=0; seen_cash text[]=ARRAY[]::text[];
 actual_receipt subscription_provider_charge_receipts%ROWTYPE; positive_receipts uuid[]=ARRAY[]::uuid[]; total_minor bigint; paid_minor bigint; remaining_minor bigint;
BEGIN
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_resource FROM subscription_controlled_resources WHERE id=actual_quote.resource_id;
 SELECT * INTO actual_binding FROM subscription_controlled_invoice_bindings WHERE collection_id=actual_collection.id;
 SELECT proof_row.* INTO actual_proof FROM subscription_controlled_invoice_proofs proof_row JOIN subscription_controlled_operations operation_row ON operation_row.id=proof_row.operation_id
  WHERE proof_row.collection_id=actual_collection.id ORDER BY operation_row.ordinal DESC LIMIT 1;
 SELECT * INTO actual_operation FROM subscription_controlled_operations WHERE id=actual_proof.operation_id;
 SELECT * INTO actual_verification FROM subscription_controlled_verifications WHERE operation_id=actual_proof.operation_id AND call_id=actual_proof.call_id;
 IF actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_resource.id IS NULL OR actual_binding.collection_id IS NULL OR actual_proof.id IS NULL
  OR actual_operation.id IS NULL OR actual_verification.operation_id IS NULL OR actual_operation.kind IS DISTINCT FROM 'read_manifest' OR actual_operation.resource_id IS DISTINCT FROM actual_resource.id
  OR actual_binding.resource_id IS DISTINCT FROM actual_resource.id OR actual_proof.canonical_target_digest IS DISTINCT FROM actual_collection.canonical_target_digest
  OR actual_verification.actual_result_digest IS DISTINCT FROM actual_proof.result_digest
  OR actual_verification.actual_result->>'providerInvoiceRef' IS DISTINCT FROM actual_binding.provider_invoice_ref
  OR actual_verification.actual_result->'exactManifest' IS DISTINCT FROM 'true'::jsonb OR actual_verification.actual_result->'suppliesPaidAuthority' IS DISTINCT FROM 'false'::jsonb
  OR actual_verification.actual_result->>'customerFinancialDigest' IS DISTINCT FROM actual_proof.customer_financial_digest
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_calls actual_call JOIN subscription_controlled_finishes actual_finish ON actual_finish.call_id=actual_call.id
   WHERE actual_call.id=actual_proof.call_id AND actual_call.operation_id=actual_operation.id AND actual_finish.actual_result->>'outcome'='returned'
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_stops actual_stop WHERE actual_stop.call_id=actual_call.id)) THEN
  RAISE EXCEPTION 'Restore the actual latest complete returned manifest/customer inventory; a planned or stopped caller is not bank evidence' USING ERRCODE='23514';END IF;
 actual_manifest=actual_operation.original_request->'payload'->'manifest';actual_inventory=actual_verification.actual_result->'inventory';actual_invoice=actual_inventory->'actualInvoice';
 IF jsonb_typeof(actual_manifest) IS DISTINCT FROM 'object' OR jsonb_typeof(actual_inventory) IS DISTINCT FROM 'object'
  OR actual_manifest->>'collectionId' IS DISTINCT FROM actual_collection.id::text OR actual_manifest->>'quoteId' IS DISTINCT FROM actual_quote.id::text
  OR actual_manifest->>'canonicalInvoiceId' IS DISTINCT FROM actual_collection.invoice_id::text OR actual_manifest->>'termsId' IS DISTINCT FROM actual_collection.terms_id::text
  OR actual_manifest->>'acceptedQuoteDigest' IS DISTINCT FROM actual_collection.accepted_quote_digest OR actual_manifest->>'canonicalTargetDigest' IS DISTINCT FROM actual_collection.canonical_target_digest
  OR actual_inventory->>'providerInvoiceRef' IS DISTINCT FROM actual_binding.provider_invoice_ref OR actual_inventory->>'providerCustomerRef' IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
  OR actual_inventory->>'providerSubscriptionRef' IS DISTINCT FROM actual_operation.original_request->'payload'->>'providerSubscriptionRef'
  OR actual_inventory->>'currency' IS DISTINCT FROM actual_resource.original_scope->>'currency'
  OR actual_inventory->'completePayments' IS DISTINCT FROM 'true'::jsonb OR actual_inventory->'completeLines' IS DISTINCT FROM 'true'::jsonb
  OR actual_inventory->'suppliesPaidAuthority' IS DISTINCT FROM 'false'::jsonb OR actual_inventory->'financiallyQuiesced' IS DISTINCT FROM 'false'::jsonb
  OR actual_inventory->>'status' IS NULL OR actual_inventory->>'status' NOT IN('open','paid') OR actual_inventory->'autoAdvance' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(actual_invoice) IS DISTINCT FROM 'object' OR actual_invoice->'auto_advance' IS DISTINCT FROM 'false'::jsonb
  OR actual_invoice->>'id' IS DISTINCT FROM actual_binding.provider_invoice_ref OR freeholder_controlled_cash_ref(actual_invoice->'customer') IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_cash_ref(actual_invoice->'subscription'),freeholder_controlled_cash_ref(actual_invoice->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM actual_inventory->>'providerSubscriptionRef'
  OR actual_invoice->'starting_balance' IS DISTINCT FROM '0'::jsonb OR actual_invoice->'ending_balance' IS DISTINCT FROM '0'::jsonb
  OR actual_invoice->'pre_payment_credit_notes_amount' IS DISTINCT FROM '0'::jsonb OR actual_invoice->'post_payment_credit_notes_amount' IS DISTINCT FROM '0'::jsonb
  OR jsonb_typeof(actual_inventory->'actualIntents') IS DISTINCT FROM 'array' OR jsonb_typeof(actual_inventory->'actualPayments') IS DISTINCT FROM 'array' OR jsonb_typeof(actual_inventory->'actualCash') IS DISTINCT FROM 'array'
  OR jsonb_array_length(actual_inventory->'actualIntents')+jsonb_array_length(actual_inventory->'actualPayments')+jsonb_array_length(actual_inventory->'actualCash')>5000
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later_operation JOIN subscription_controlled_calls later_call ON later_call.operation_id=later_operation.id
   WHERE later_operation.resource_id=actual_resource.id AND later_operation.ordinal>actual_operation.ordinal
    AND later_operation.kind NOT IN('read_product','discover_bootstrap','read_bootstrap','read_calendar','preview_proration','preview_update','read_manifest','read_invoice','read_customer_financials','list_invoices')) THEN
  RAISE EXCEPTION 'Keep actual partial/contradictory/unknown bank data for review; no invented complete inventory or canonical target is admitted' USING ERRCODE='23514';END IF;
 total_minor=freeholder_controlled_bank_minor(actual_inventory->'totalMinor',false);paid_minor=freeholder_controlled_bank_minor(actual_inventory->'paidMinor',false);remaining_minor=freeholder_controlled_bank_minor(actual_inventory->'remainingMinor',false);
 IF total_minor IS NULL OR paid_minor IS NULL OR remaining_minor IS NULL OR total_minor IS DISTINCT FROM freeholder_controlled_bank_minor(actual_manifest->'cashDueMinor',false)
  OR paid_minor::numeric+remaining_minor::numeric IS DISTINCT FROM total_minor::numeric OR actual_inventory->>'status'='paid' AND remaining_minor<>0 OR actual_inventory->>'status'='open' AND remaining_minor=0
  OR actual_invoice->'amount_paid' IS DISTINCT FROM to_jsonb(paid_minor) OR actual_invoice->'amount_remaining' IS DISTINCT FROM to_jsonb(remaining_minor) THEN
  RAISE EXCEPTION 'Actual paid and remaining consideration must conserve the frozen gross-minus-locked-credit bank total without clipping' USING ERRCODE='23514';END IF;
 FOR intent_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualIntents') LOOP
  intent_ref=freeholder_controlled_cash_ref(intent_atom->'id');received_minor=freeholder_controlled_bank_minor(intent_atom->'amount_received',false);
  IF intent_ref IS NULL OR intent_ref !~ '^pi_[A-Za-z0-9_]+$' OR intent_ref=ANY(seen_intents) OR received_minor IS NULL THEN RAISE EXCEPTION 'Complete actual PI identity and precise received cash are required for each bank atom' USING ERRCODE='23514';END IF;
  seen_intents=array_append(seen_intents,intent_ref);
  IF received_minor=0 THEN
   IF intent_atom->>'status' IS DISTINCT FROM 'canceled' AND NOT(intent_atom->>'status'='succeeded' AND intent_atom->'amount'='0'::jsonb) THEN RAISE EXCEPTION 'An unsettled zero-received intent remains a genuine caller/collection liability' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  IF intent_atom->>'status' IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Positive received cash remains retained review unless actual intent completion is proved' USING ERRCODE='23514';END IF;
  SELECT receipt_row.* INTO actual_receipt FROM subscription_provider_charge_receipts receipt_row
   JOIN subscription_controlled_charge_origins original_origin ON original_origin.receipt_id=receipt_row.id AND original_origin.resource_id=actual_resource.id
   WHERE receipt_row.subscription_id=actual_resource.subscription_id AND receipt_row.provider_platform_account_id=actual_resource.original_scope->>'providerPlatformAccountId'
    AND receipt_row.charge_account_id IS NOT DISTINCT FROM actual_resource.original_scope->>'providerAccountId'
    AND receipt_row.provider_invoice_ref=actual_binding.provider_invoice_ref AND receipt_row.provider_payment_intent_ref=intent_ref;
  IF actual_receipt.id IS NULL OR actual_receipt.provider_api_version IS DISTINCT FROM actual_resource.original_scope->>'providerApiVersion'
   OR actual_receipt.amount_minor IS DISTINCT FROM received_minor OR actual_receipt.currency IS DISTINCT FROM upper(intent_atom->>'currency')
   OR actual_receipt.currency IS DISTINCT FROM actual_inventory->>'currency' OR freeholder_controlled_cash_ref(intent_atom->'customer') IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef'
   OR actual_receipt.provider_charge_ref IS NOT NULL AND freeholder_controlled_cash_ref(intent_atom->'latest_charge') IS DISTINCT FROM actual_receipt.provider_charge_ref THEN
   RAISE EXCEPTION 'Retain every actual unmatched/foreign/contradictory captured PI; value equality cannot supply its canonical receipt' USING ERRCODE='23514';END IF;
  payment_sum=0;
  FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') WHERE freeholder_controlled_cash_ref(value->'payment'->'payment_intent')=intent_ref LOOP
   IF freeholder_controlled_cash_ref(payment_atom->'invoice') IS DISTINCT FROM actual_binding.provider_invoice_ref OR payment_atom->'payment'->>'type' IS DISTINCT FROM 'payment_intent'
    OR upper(payment_atom->>'currency') IS DISTINCT FROM actual_receipt.currency OR payment_atom->>'status' IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Actual invoice-payment identities and status must bind the same exact bank PI and invoice' USING ERRCODE='23514';END IF;
   payment_minor=freeholder_controlled_bank_minor(payment_atom->'amount_paid',false);IF payment_minor IS NULL THEN RAISE EXCEPTION 'Retain imprecise invoice-payment amounts as review' USING ERRCODE='23514';END IF;
   payment_sum=payment_sum+payment_minor;
  END LOOP;
  IF payment_sum IS DISTINCT FROM received_minor::numeric THEN RAISE EXCEPTION 'Complete actual invoice-payment atoms must account for the exact original captured PI, never aggregate amount adoption' USING ERRCODE='23514';END IF;
  positive_receipts=array_append(positive_receipts,actual_receipt.id);total_received=total_received+received_minor;
 END LOOP;
 FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') LOOP
  payment_ref=freeholder_controlled_cash_ref(payment_atom->'id');payment_minor=freeholder_controlled_bank_minor(payment_atom->'amount_paid',false);intent_ref=freeholder_controlled_cash_ref(payment_atom->'payment'->'payment_intent');
  IF payment_ref IS NULL OR payment_ref=ANY(seen_payments) OR payment_minor IS NULL OR intent_ref IS NULL OR NOT(intent_ref=ANY(seen_intents))
   OR freeholder_controlled_cash_ref(payment_atom->'invoice') IS DISTINCT FROM actual_binding.provider_invoice_ref OR payment_atom->'payment'->>'type' IS DISTINCT FROM 'payment_intent'
   OR upper(payment_atom->>'currency') IS DISTINCT FROM actual_inventory->>'currency'
   OR payment_minor>0 AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(positive_receipts) AND original_receipt.provider_payment_intent_ref=intent_ref) THEN
   RAISE EXCEPTION 'Every complete invoice-payment atom must retain a unique real identity and exact original PI owner' USING ERRCODE='23514';END IF;
  seen_payments=array_append(seen_payments,payment_ref);
 END LOOP;
 FOR cash_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualCash') LOOP
  intent_ref=cash_atom->>'providerPaymentIntentRef';SELECT * INTO actual_receipt FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(positive_receipts) AND original_receipt.provider_payment_intent_ref=intent_ref;
  IF actual_receipt.id IS NULL OR intent_ref=ANY(seen_cash) OR cash_atom->>'subscriptionId' IS DISTINCT FROM actual_receipt.subscription_id::text
   OR cash_atom->>'providerInvoiceRef' IS DISTINCT FROM actual_receipt.provider_invoice_ref OR cash_atom->>'providerSubscriptionRef' IS DISTINCT FROM actual_receipt.provider_subscription_ref
   OR cash_atom->>'providerCustomerRef' IS DISTINCT FROM actual_resource.original_scope->>'providerCustomerRef' OR cash_atom->>'providerPlatformAccountId' IS DISTINCT FROM actual_receipt.provider_platform_account_id
   OR cash_atom->>'providerAccountId' IS DISTINCT FROM actual_receipt.charge_account_id OR cash_atom->>'providerChargeRef' IS DISTINCT FROM actual_receipt.provider_charge_ref
   OR cash_atom->'amountMinor' IS DISTINCT FROM to_jsonb(actual_receipt.amount_minor) OR cash_atom->>'currency' IS DISTINCT FROM actual_receipt.currency
   OR cash_atom->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR cash_atom->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'Every actual retained bank-cash atom must bind its exact original receipt/customer/route and verified current charge' USING ERRCODE='23514';END IF;
  seen_cash=array_append(seen_cash,intent_ref);cash_count=cash_count+1;
 END LOOP;
 IF total_received IS DISTINCT FROM paid_minor::numeric OR cash_count<>cardinality(positive_receipts) OR cardinality(positive_receipts)>5000 OR EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt_row
  JOIN subscription_controlled_charge_origins original_origin ON original_origin.receipt_id=receipt_row.id AND original_origin.resource_id=actual_resource.id
  WHERE receipt_row.subscription_id=actual_resource.subscription_id AND receipt_row.provider_platform_account_id=actual_resource.original_scope->>'providerPlatformAccountId'
   AND receipt_row.charge_account_id IS NOT DISTINCT FROM actual_resource.original_scope->>'providerAccountId' AND receipt_row.provider_invoice_ref=actual_binding.provider_invoice_ref AND NOT(receipt_row.id=ANY(positive_receipts))) THEN
  RAISE EXCEPTION 'The actual complete bank inventory must account for every real positive receipt occurrence, including late cash; no sum-only adoption' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value ORDER BY value),ARRAY[]::uuid[]) INTO positive_receipts FROM unnest(positive_receipts) value;
 RETURN jsonb_build_object('providerInvoiceRef',actual_binding.provider_invoice_ref,'providerSubscriptionRef',actual_inventory->>'providerSubscriptionRef','providerCustomerRef',actual_inventory->>'providerCustomerRef','currency',actual_inventory->>'currency','status',actual_inventory->>'status',
  'totalMinor',total_minor,'paidMinor',paid_minor,'remainingMinor',remaining_minor,'positiveReceiptIds',to_jsonb(positive_receipts),'manifestOperationId',actual_operation.id,'manifestCallId',actual_proof.call_id,
  'manifestResultDigest',actual_proof.result_digest,'manifestDigest',actual_verification.actual_result->>'manifestDigest',
  'zeroWalletProofDigest',encode(sha256(convert_to(format('{"customerFinancialDigest":"%s","endingBalance":0,"postPaymentCreditNotes":0,"prePaymentCreditNotes":0,"startingBalance":0}',actual_proof.customer_financial_digest),'UTF8')),'hex'));
END $$;
--> statement-breakpoint
-- An alternate SQL writer may RECHECK an already held prefix, never acquire a
-- resource after it has acquired an invoice lock. These are actual backend
-- locks, not a caller-supplied flag. Transaction IDs below bind own writes only;
-- the genuine admission lineage, never transaction time/ID, orders bank reads.
CREATE FUNCTION freeholder_controlled_cash_require_prefix(target_resource_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
  AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
  AND actual_lock.classid::bigint=CASE WHEN hashtext('controlled-provider:'||target_resource_uuid::text)<0 THEN 4294967295::bigint ELSE 0::bigint END
  AND actual_lock.objid::bigint=(hashtext('controlled-provider:'||target_resource_uuid::text)::bigint & 4294967295::bigint))
 OR NOT EXISTS(SELECT 1 FROM pg_locks identity_lock WHERE identity_lock.pid=pg_backend_pid() AND identity_lock.locktype='advisory' AND identity_lock.granted
  AND identity_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND identity_lock.mode IN('ShareLock','ExclusiveLock') AND identity_lock.objsubid=1
  AND ((identity_lock.classid::bigint << 32) | identity_lock.objid::bigint)=hashtext('contact-identity-privacy')::bigint) THEN
  RAISE EXCEPTION 'The actual contact/resource prefix must already be held before canonical application; never acquire it in reverse' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
-- The full original PG preimage is retained ONCE. Only this new batch and its
-- newborn immutable receipt admissions may exist between the snapshot and the
-- first payment insert. An unexpected callback, bare read, source-credit change
-- or even an unrelated state-event append makes the complete comparison fail.
CREATE FUNCTION freeholder_controlled_cash_prewrite(target_batch_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_entries jsonb; actual_revision text; actual_count integer;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=admitted_batch.id) THEN
  RAISE EXCEPTION 'The first-write preimage cannot be reused after a canonical receipt mutation' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(admitted_batch.resource_id);
 SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),'[]'::jsonb),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_count,actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(admitted_batch.collection_id) actual_entry
 WHERE NOT(actual_entry.family='controlled_cash_application_batches' AND actual_entry.identity=admitted_batch.id::text)
  AND NOT(actual_entry.family='controlled_cash_application_receipts' AND EXISTS(SELECT 1 FROM controlled_cash_application_receipts own_proof WHERE own_proof.batch_id=admitted_batch.id AND own_proof.id::text=actual_entry.identity));
 IF actual_count NOT BETWEEN 1 AND 5000 OR actual_entries IS DISTINCT FROM admitted_batch.before_entries OR actual_revision IS DISTINCT FROM admitted_batch.parent_pg_revision THEN
  RAISE EXCEPTION 'Every current physical parent/source/raw occurrence must still match the immutable original prewrite graph' USING ERRCODE='23514';END IF;
 RETURN actual_revision;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_invoice invoices%ROWTYPE;
 actual_snapshot jsonb; actual_bank jsonb; selected_ids uuid[]; expected_cash numeric; actual_mutable jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original controlled cash application admissions are immutable financial evidence' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=NEW.collection_id;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_invoice FROM invoices WHERE id=actual_collection.invoice_id;
 PERFORM freeholder_controlled_cash_require_prefix(NEW.resource_id);
 IF actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_invoice.id IS NULL OR NEW.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR actual_collection.quote_id IS DISTINCT FROM NEW.quote_id OR actual_quote.resource_id IS DISTINCT FROM NEW.resource_id
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_resources original_resource WHERE original_resource.id=NEW.resource_id AND original_resource.subscription_id=NEW.subscription_id)
  OR actual_collection.invoice_id IS DISTINCT FROM NEW.invoice_id OR actual_collection.terms_id IS DISTINCT FROM NEW.terms_id
  OR actual_collection.accepted_quote_digest IS DISTINCT FROM NEW.accepted_quote_digest OR actual_collection.canonical_target_digest IS DISTINCT FROM NEW.canonical_target_digest
  OR actual_invoice.currency IS DISTINCT FROM NEW.currency OR actual_invoice.status IS DISTINCT FROM NEW.invoice_before_status
  OR actual_invoice.paid_minor IS DISTINCT FROM NEW.invoice_before_paid_minor OR actual_invoice.credited_minor IS DISTINCT FROM NEW.invoice_before_credited_minor OR actual_invoice.refunded_minor<>0
  OR to_jsonb(actual_invoice)->>'paid_at' IS DISTINCT FROM NEW.invoice_before_paid_at OR to_jsonb(actual_invoice)->>'updated_at' IS DISTINCT FROM NEW.invoice_before_updated_at
  OR encode(sha256(convert_to(to_jsonb(actual_invoice)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.invoice_before_fingerprint THEN
  RAISE EXCEPTION 'The immutable application admission must bind the exact real accepted collection and complete current canonical invoice' USING ERRCODE='23514';END IF;
 actual_snapshot=freeholder_controlled_cash_parent_snapshot(NEW.collection_id);
 IF actual_snapshot->'entries' IS DISTINCT FROM NEW.before_entries OR actual_snapshot->>'revision' IS DISTINCT FROM NEW.parent_pg_revision THEN
  RAISE EXCEPTION 'A parent admission cannot omit or rewrite any physical current source family or raw occurrence' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO selected_ids FROM jsonb_array_elements_text(NEW.requested_receipt_ids);
 IF cardinality(selected_ids) NOT BETWEEN 1 AND 5000 OR cardinality(selected_ids)<>(SELECT count(DISTINCT value) FROM unnest(selected_ids) value)
  OR NEW.requested_receipt_ids IS DISTINCT FROM to_jsonb(selected_ids) THEN RAISE EXCEPTION 'Freeze the exact sorted unique retained receipt UUID batch' USING ERRCODE='23514';END IF;
 actual_bank=freeholder_controlled_cash_bank_invoice(NEW.collection_id);
 IF EXISTS(SELECT 1 FROM unnest(selected_ids) selected_id WHERE NOT(actual_bank->'positiveReceiptIds' @> to_jsonb(ARRAY[selected_id])))
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes prior_route WHERE prior_route.original_charge_receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual_bank->'positiveReceiptIds') bank_id WHERE NOT(bank_id::uuid=ANY(selected_ids)) AND NOT EXISTS(
   SELECT 1 FROM merchant_agreement_payment_routes original_route JOIN payments original_payment ON original_payment.id=original_route.payment_id
   WHERE original_route.original_charge_receipt_id=bank_id::uuid AND original_payment.invoice_id=NEW.invoice_id AND original_payment.status='succeeded'
    AND original_payment.refunded_minor=0 AND original_payment.provider='stripe' AND original_payment.method='provider_schedule')) THEN
  RAISE EXCEPTION 'Every actual positive bank receipt must be either exact already canonical cash or explicitly admitted new cash; no receipt reuse or value adoption' USING ERRCODE='23514';END IF;
 SELECT sum(original_receipt.amount_minor) INTO expected_cash FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(selected_ids) AND original_receipt.currency=NEW.currency;
 IF expected_cash IS DISTINCT FROM NEW.expected_cash_minor::numeric OR NEW.invoice_before_paid_minor::numeric+expected_cash+NEW.invoice_before_credited_minor>actual_invoice.total_minor::numeric
  OR NEW.invoice_before_paid_minor::numeric+expected_cash IS DISTINCT FROM (actual_bank->>'paidMinor')::numeric THEN
  RAISE EXCEPTION 'Preserve actual partial bank cash and unpaid remainder; never clip an overage or invent a second principal' USING ERRCODE='23514';END IF;
 -- Freeze only the exact shared plan columns that settlement may mutate, with
 -- original PG timestamp precision and full-row SHA for every affected row.
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',candidate.family,'id',candidate.identity,'fingerprint',candidate.fingerprint,'fields',candidate.fields) ORDER BY candidate.family,candidate.identity),'[]'::jsonb)
 INTO actual_mutable FROM(
  SELECT 'payment_plans'::text family,actual_plan.id::text identity,encode(sha256(convert_to(to_jsonb(actual_plan)::text,'UTF8')),'hex') fingerprint,
   jsonb_build_object('paid_minor',actual_plan.paid_minor,'status',actual_plan.status,'updated_at',to_jsonb(actual_plan)->>'updated_at') fields FROM payment_plans actual_plan WHERE actual_plan.invoice_id=NEW.invoice_id
  UNION ALL SELECT 'payment_plan_installments',actual_installment.id::text,encode(sha256(convert_to(to_jsonb(actual_installment)::text,'UTF8')),'hex'),
   jsonb_build_object('paid_minor',actual_installment.paid_minor,'status',actual_installment.status,'updated_at',to_jsonb(actual_installment)->>'updated_at')
   FROM payment_plan_installments actual_installment JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id WHERE actual_plan.invoice_id=NEW.invoice_id
 ) candidate;
 IF NEW.mutable_before_rows IS DISTINCT FROM actual_mutable THEN RAISE EXCEPTION 'The full exact original payment-plan preimage must be complete; no plan-row backfill or partial selector' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_batches_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_batches FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_batch();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; original_origin subscription_controlled_charge_origins%ROWTYPE;
 actual_bank record; actual_observation subscription_provider_charge_observations%ROWTYPE; actual_inspection merchant_cash_return_inspections%ROWTYPE; exact_observation_ids uuid[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original exact receipt/bank admissions are immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Receipt admission belongs to the same actual original application transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_prewrite(admitted_batch.id);
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO original_origin FROM subscription_controlled_charge_origins WHERE receipt_id=NEW.receipt_id;
 SELECT * INTO actual_inspection FROM merchant_cash_return_inspections WHERE id=NEW.bank_inspection_id;
 SELECT * INTO actual_observation FROM subscription_provider_charge_observations WHERE id=NEW.original_observation_id;
 SELECT * INTO actual_bank FROM freeholder_controlled_receipt_bank_observation(admitted_batch.collection_id,NEW.receipt_id);
 IF original_receipt.id IS NULL OR original_origin.receipt_id IS NULL OR actual_inspection.id IS NULL OR actual_observation.id IS NULL OR actual_bank.actual_inspection_id IS NULL
  OR NOT(admitted_batch.requested_receipt_ids @> to_jsonb(ARRAY[NEW.receipt_id])) OR original_receipt.subscription_id IS DISTINCT FROM admitted_batch.subscription_id
  OR NEW.ordinal IS DISTINCT FROM(SELECT ordinal::integer FROM jsonb_array_elements_text(admitted_batch.requested_receipt_ids) WITH ORDINALITY selected_id(value,ordinal) WHERE value=NEW.receipt_id::text)
  OR original_origin.resource_id IS DISTINCT FROM admitted_batch.resource_id OR original_origin.operation_id IS DISTINCT FROM NEW.origin_operation_id OR original_origin.call_id IS DISTINCT FROM NEW.origin_call_id OR original_origin.fact_id IS DISTINCT FROM NEW.origin_fact_id
  OR original_receipt.amount_minor IS DISTINCT FROM NEW.amount_minor OR original_receipt.currency IS DISTINCT FROM NEW.currency OR NEW.currency IS DISTINCT FROM admitted_batch.currency
  OR encode(sha256(convert_to(to_jsonb(original_receipt)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.receipt_fingerprint
  OR actual_inspection.payment_id IS NOT NULL OR actual_inspection.subscription_charge_receipt_id IS DISTINCT FROM NEW.receipt_id OR actual_inspection.subscription_charge_observation_id IS DISTINCT FROM NEW.original_observation_id
  OR actual_inspection.caller->>'id' IS DISTINCT FROM NEW.bank_finish_caller_id::text OR actual_bank.actual_inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR actual_bank.actual_observation_id IS DISTINCT FROM NEW.bank_observation_id
  OR NEW.processed_at IS DISTINCT FROM(SELECT date_trunc('milliseconds',original_bank.created_at) FROM merchant_cash_return_observations original_bank WHERE original_bank.id=NEW.bank_observation_id AND original_bank.inspection_id=NEW.bank_inspection_id)
  OR actual_bank.immutable_bank_fingerprint IS DISTINCT FROM NEW.immutable_bank_revision OR actual_bank.bank_fingerprint IS DISTINCT FROM NEW.namespace_revision
  OR actual_observation.subscription_id IS DISTINCT FROM original_receipt.subscription_id OR actual_observation.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_observation.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR actual_observation.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR actual_observation.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR actual_observation.currency IS DISTINCT FROM original_receipt.currency
  OR actual_observation.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR actual_observation.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR actual_observation.provider_charge_ref IS NOT NULL AND actual_observation.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR NOT actual_observation.customer_charge_verified OR NOT actual_observation.merchant_route_verified THEN
  RAISE EXCEPTION 'Only genuine original receipt/caller/returned bank lineage in the exact platform/account/PI namespace can supply a prospective cash admission' USING ERRCODE='23514';END IF;
 -- Match the existing authenticated source's retained display order. This is
 -- array identity only: genuine bank chronology uses the separate lineage.
 SELECT coalesce(array_agg(observed.id ORDER BY observed.created_at,observed.id),ARRAY[]::uuid[]) INTO exact_observation_ids FROM subscription_provider_charge_observations observed
  WHERE observed.subscription_id=original_receipt.subscription_id AND observed.provider_platform_account_id=original_receipt.provider_platform_account_id
   AND observed.charge_account_id IS NOT DISTINCT FROM original_receipt.charge_account_id AND observed.provider_payment_intent_ref=original_receipt.provider_payment_intent_ref;
 IF NEW.original_observation_ids IS DISTINCT FROM to_jsonb(exact_observation_ids)
  OR EXISTS(SELECT 1 FROM subscription_provider_charge_observations observed WHERE observed.id=ANY(exact_observation_ids) AND(
   observed.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version OR observed.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
   OR observed.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR observed.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR observed.currency IS DISTINCT FROM original_receipt.currency
   OR observed.provider_charge_ref IS NOT NULL AND observed.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
   OR observed.actual_destination_account_id IS DISTINCT FROM original_receipt.actual_destination_account_id OR observed.actual_settlement_merchant_account_id IS DISTINCT FROM original_receipt.actual_settlement_merchant_account_id
   OR NOT observed.customer_charge_verified OR NOT observed.merchant_route_verified))
  OR NOT freeholder_controlled_bank_unreturned(actual_bank.original_expectation||jsonb_build_object('feeMinor',NEW.fee_minor),actual_bank.current_evidence)
  OR NEW.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||NEW.receipt_id::text
  OR NEW.payment_request_hash IS DISTINCT FROM encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
   NEW.amount_minor,NEW.payment_idempotency_key,admitted_batch.invoice_id,NEW.receipt_id),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Keep every original observation and exact real shared request; current fee/recipient/refund/dispute facts cannot be waived by a marker' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_receipts_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_receipt();
--> statement-breakpoint
-- A complete actual receipt prefix is required before FIRST write. Merely
-- inserting one signed-looking row cannot hide an omitted second bank PI.
CREATE FUNCTION freeholder_controlled_cash_receipts_complete(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; proof_count integer; actual_ids jsonb; actual_cash numeric; actual_fee numeric;
 actual_invoice invoices%ROWTYPE; original_policy invoice_market_policies%ROWTYPE; actual_duty agreement_fee_duties%ROWTYPE;
 original_paid numeric; original_fee numeric; carried_fee numeric; cash_principal numeric; fee_target numeric; receipt_record controlled_cash_application_receipts%ROWTYPE;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Use only the same real immutable application transaction' USING ERRCODE='23514';END IF;
 SELECT count(*),jsonb_agg(receipt_proof.receipt_id ORDER BY receipt_proof.ordinal),sum(receipt_proof.amount_minor),sum(receipt_proof.fee_minor)
 INTO proof_count,actual_ids,actual_cash,actual_fee FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF proof_count NOT BETWEEN 1 AND 5000 OR actual_ids IS DISTINCT FROM admitted_batch.requested_receipt_ids OR actual_cash IS DISTINCT FROM admitted_batch.expected_cash_minor::numeric OR actual_fee IS DISTINCT FROM admitted_batch.expected_fee_minor::numeric
  OR EXISTS(SELECT 1 FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id AND receipt_proof.ordinal<1)
  OR(SELECT max(receipt_proof.ordinal) FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id)<>proof_count THEN
  RAISE EXCEPTION 'The exact complete UUID batch and contiguous receipt/fee prefix must exist before any payment mutation' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 SELECT * INTO original_policy FROM invoice_market_policies WHERE invoice_id=admitted_batch.invoice_id;
 SELECT * INTO actual_duty FROM agreement_fee_duties WHERE invoice_id=admitted_batch.invoice_id;
 -- Original real payments only. New actual links in this batch are accounted
 -- separately by the exact staged delta; they never rewrite original paid cash.
 SELECT coalesce(sum(actual_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0)
 INTO original_paid,original_fee FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
 WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND actual_payment.status='succeeded'
  AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id);
 IF original_policy.invoice_id IS NULL OR original_paid IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric
  OR EXISTS(SELECT 1 FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
   WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id)
    AND(actual_payment.status IN('created','processing') OR actual_payment.status='succeeded' AND(original_route.payment_id IS NULL OR actual_payment.refunded_minor<>0))) THEN
  RAISE EXCEPTION 'Keep complete real prior principal, original fee routes and every pending/refunded attempt; no virtual prefix or missing original fee owner' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_application.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id;
 IF(SELECT coalesce(sum(actual_reservation.amount_minor),0) FROM invoice_credit_applications actual_application JOIN invoice_credit_reservations actual_reservation ON actual_reservation.id=actual_application.reservation_id WHERE actual_application.invoice_id=admitted_batch.invoice_id) IS DISTINCT FROM admitted_batch.invoice_before_credited_minor::numeric
  OR EXISTS(SELECT 1 FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id AND actual_application.fee_evidence_digest IS NULL) THEN
  RAISE EXCEPTION 'Retain every actual original noncash credit and its fee assignment before physical cash application' USING ERRCODE='23514';END IF;
 cash_principal=actual_invoice.total_minor::numeric-admitted_batch.invoice_before_credited_minor::numeric;
 fee_target=greatest(0,original_policy.fee_minor::numeric-carried_fee);
 IF actual_duty.invoice_id IS NOT NULL THEN
  IF actual_duty.total_minor IS DISTINCT FROM actual_invoice.total_minor OR actual_duty.target_fee_minor IS DISTINCT FROM original_policy.fee_minor
   OR actual_duty.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_duty.carried_fee_minor::numeric IS DISTINCT FROM carried_fee OR actual_duty.cash_principal_minor::numeric IS DISTINCT FROM cash_principal THEN
   RAISE EXCEPTION 'Preserve the frozen gross target fee duty and exact carried credit epoch' USING ERRCODE='23514';END IF;
  fee_target=actual_duty.cash_fee_target_minor;
 END IF;
 IF cash_principal<=0 OR fee_target>cash_principal OR original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Restore the exact original cumulative cash commission; never silently reprice historical fee allocations' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.prior_cash_minor::numeric IS DISTINCT FROM original_paid OR receipt_record.prior_allocated_fee_minor::numeric IS DISTINCT FROM original_fee
   OR receipt_record.fee_minor::numeric IS DISTINCT FROM floor(fee_target*(original_paid+receipt_record.amount_minor::numeric)/cash_principal)-original_fee THEN
   RAISE EXCEPTION 'Every later fee plan must bind its exact preceding real receipt prefix and deterministic residual' USING ERRCODE='23514';END IF;
  original_paid=original_paid+receipt_record.amount_minor;original_fee=original_fee+receipt_record.fee_minor;
 END LOOP;
END $$;
--> statement-breakpoint
-- This function captures only a genuine NEW UUID emitted by the existing
-- payments INSERT. It does not allocate a guessed UUID or route money itself.
-- The complete later canonical/deferred-stage validator must qualify before
-- the existing closed route/settlement guards can be extended or activated.
CREATE FUNCTION freeholder_controlled_cash_link_created_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_proof controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE;
 actual_entries jsonb; actual_revision text;
BEGIN
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE payment_idempotency_key=NEW.idempotency_key;
 IF receipt_proof.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=receipt_proof.batch_id;
 PERFORM freeholder_controlled_cash_require_prefix(admitted_batch.resource_id);
 IF admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR NEW.invoice_id IS DISTINCT FROM admitted_batch.invoice_id
  OR NEW.provider IS DISTINCT FROM 'stripe' OR NEW.method IS DISTINCT FROM 'provider_schedule' OR NEW.status IS DISTINCT FROM 'created'
  OR NEW.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR NEW.currency IS DISTINCT FROM receipt_proof.currency OR NEW.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR NEW.refunded_minor<>0 OR NEW.provider_ref IS NOT NULL OR NEW.provider_checkout_ref IS NOT NULL OR NEW.processed_at IS NOT NULL OR NEW.failed_at IS NOT NULL
  OR NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL OR NEW.metadata IS DISTINCT FROM '{}'::jsonb OR NEW.updated_at IS DISTINCT FROM NEW.created_at
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(admitted_batch.before_entries) prior_entry WHERE prior_entry->>'table'='payments' AND prior_entry->>'id'=NEW.id::text) THEN
  RAISE EXCEPTION 'Link only the actual newly generated exact shared created-payment row; no historical/equal-value adoption' USING ERRCODE='23514';END IF;
 -- This checkpoint handles the first actual payment birth. Reusing a fresh
 -- first-write proof after any own link is forbidden; the subsequent staged
 -- validator must prove the precise earlier canonical delta, not clear debt.
 IF receipt_proof.ordinal<>1 OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.batch_id=admitted_batch.id) THEN
  RAISE EXCEPTION 'Require complete exact own-canonical stage proof before a subsequent receipt birth' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),'[]'::jsonb),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(admitted_batch.collection_id) actual_entry
 WHERE NOT(actual_entry.family='controlled_cash_application_batches' AND actual_entry.identity=admitted_batch.id::text)
  AND NOT(actual_entry.family='controlled_cash_application_receipts' AND EXISTS(SELECT 1 FROM controlled_cash_application_receipts own_proof WHERE own_proof.batch_id=admitted_batch.id AND own_proof.id::text=actual_entry.identity))
  AND NOT(actual_entry.family='payments' AND actual_entry.identity=NEW.id::text);
 IF actual_entries IS DISTINCT FROM admitted_batch.before_entries OR actual_revision IS DISTINCT FROM admitted_batch.parent_pg_revision THEN
  RAISE EXCEPTION 'The first actual payment birth must be the ONLY canonical delta from the complete immutable preimage' USING ERRCODE='23514';END IF;
 INSERT INTO controlled_cash_application_links(receipt_id,receipt_proof_id,batch_id,payment_id,created_payment_fingerprint)
 VALUES(receipt_proof.receipt_id,receipt_proof.id,admitted_batch.id,NEW.id,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 -- The genuine newborn link now identifies this exact own created row. Only
 -- then may prior-principal accounting separate it from foreign pending debt;
 -- a failed whole-batch/prefix check rolls back the INSERT and its link together.
 PERFORM freeholder_controlled_cash_receipts_complete(admitted_batch.id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_payment_birth AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_link_created_payment();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_payment payments%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Actual receipt/payment links are immutable and originate only at the real payment INSERT boundary' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE id=NEW.receipt_proof_id;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF actual_payment.id IS NULL OR receipt_proof.id IS NULL OR admitted_batch.id IS NULL OR receipt_proof.receipt_id IS DISTINCT FROM NEW.receipt_id OR receipt_proof.batch_id IS DISTINCT FROM NEW.batch_id
  OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_payment.status IS DISTINCT FROM 'created'
  OR actual_payment.invoice_id IS DISTINCT FROM admitted_batch.invoice_id OR actual_payment.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR actual_payment.currency IS DISTINCT FROM receipt_proof.currency
  OR actual_payment.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR actual_payment.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR encode(sha256(convert_to(to_jsonb(actual_payment)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.created_payment_fingerprint THEN
  RAISE EXCEPTION 'The lifetime unique link must prove this actual newly created payment and exact immutable receipt admission' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_links_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_links FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_link();
