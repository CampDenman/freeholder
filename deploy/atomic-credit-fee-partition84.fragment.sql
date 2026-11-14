-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: PRIVATE UNFINISHED SOURCE, UNAPPLIED. Full guards/readiness
-- follow before this can be assembled; no old table column or historical row changes.
CREATE TABLE invoice_credit_funding_atomic_fee_partitions (
 funding_id uuid PRIMARY KEY,source_payment_id uuid NOT NULL,source_application_id uuid,source_invoice_id uuid NOT NULL,
 credit_note_id uuid NOT NULL,credit_note_line_id uuid NOT NULL,original_charge_receipt_id uuid NOT NULL,bank_inspection_id uuid NOT NULL,bank_observation_id uuid NOT NULL,
 protocol text NOT NULL,parent_fingerprint text NOT NULL,economics jsonb NOT NULL,before_entries jsonb NOT NULL,
 admission_transaction_id text NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT credit_atomic_fee_funding_fk FOREIGN KEY(funding_id) REFERENCES invoice_credit_funding(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_payment_fk FOREIGN KEY(source_payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_source_application_fk FOREIGN KEY(source_application_id) REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_source_invoice_fk FOREIGN KEY(source_invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_note_fk FOREIGN KEY(credit_note_id) REFERENCES credit_notes(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_line_fk FOREIGN KEY(credit_note_line_id) REFERENCES credit_note_lines(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_receipt_fk FOREIGN KEY(original_charge_receipt_id) REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_inspection_fk FOREIGN KEY(bank_inspection_id) REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_observation_fk FOREIGN KEY(bank_observation_id) REFERENCES merchant_cash_return_observations(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_protocol CHECK(protocol='freeholder.atomic-credit-fee-partition.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT credit_atomic_fee_fingerprints CHECK(parent_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT credit_atomic_fee_economics CHECK((jsonb_typeof(economics)='object' AND economics->'plan'->>'protocol'='freeholder.atomic-credit-fee-partition.v1'
  AND(economics->'plan'->>'originalPrincipalMinor')::numeric between 1 and 9007199254740991
  AND(economics->'plan'->>'originalFeeMinor')::numeric between 0 and(economics->'plan'->>'originalPrincipalMinor')::numeric
  AND(economics->'plan'->>'takeNominalFeeMinor')::numeric=(economics->'plan'->>'takeRetiredFeeMinor')::numeric+(economics->'plan'->>'takeAssignedFeeMinor')::numeric
  AND(economics->'plan'->>'takeAssignedFeeMinor')::numeric=(economics->'plan'->>'takeProvenCollectedMinor')::numeric+(economics->'plan'->>'takeOwedFeeMinor')::numeric) IS TRUE),
 CONSTRAINT credit_atomic_fee_before_entries CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries)<=5000)
);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_payment ON invoice_credit_funding_atomic_fee_partitions(source_payment_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_parent_source ON invoice_credit_funding_atomic_fee_partitions(source_payment_id,source_application_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_note ON invoice_credit_funding_atomic_fee_partitions(credit_note_id,credit_note_line_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_receipt ON invoice_credit_funding_atomic_fee_partitions(original_charge_receipt_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_inspection ON invoice_credit_funding_atomic_fee_partitions(bank_inspection_id,funding_id);
--> statement-breakpoint
CREATE TABLE invoice_credit_reservation_atomic_fee_partitions (
 reservation_id uuid PRIMARY KEY,funding_id uuid NOT NULL,root_funding_id uuid NOT NULL,source_payment_id uuid NOT NULL,source_application_id uuid,
 protocol text NOT NULL,parent_fingerprint text NOT NULL,funding_partition_fingerprint text NOT NULL,economics jsonb NOT NULL,before_entries jsonb NOT NULL,
 admission_transaction_id text NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT credit_atomic_reservation_parent_fk FOREIGN KEY(reservation_id) REFERENCES invoice_credit_reservations(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_funding_fk FOREIGN KEY(funding_id) REFERENCES invoice_credit_funding_atomic_fee_partitions(funding_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_root_fk FOREIGN KEY(root_funding_id) REFERENCES invoice_credit_funding_atomic_fee_partitions(funding_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_payment_fk FOREIGN KEY(source_payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_application_fk FOREIGN KEY(source_application_id) REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_protocol CHECK(protocol='freeholder.atomic-credit-fee-reservation.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT credit_atomic_reservation_fingerprints CHECK(parent_fingerprint ~ '^[a-f0-9]{64}$' AND funding_partition_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT credit_atomic_reservation_economics CHECK((jsonb_typeof(economics)='object' AND economics->>'protocol'='freeholder.atomic-credit-fee-reservation.v1'
  AND jsonb_typeof(economics->'segments')='array' AND jsonb_array_length(economics->'segments') between 1 and 5000
  AND(economics->>'originalPrincipalMinor')::numeric between 1 and 9007199254740991
  AND(economics->>'originalFeeMinor')::numeric between 0 and(economics->>'originalPrincipalMinor')::numeric
  AND(economics->>'amountMinor')::numeric between 1 and(economics->>'originalPrincipalMinor')::numeric
  AND(economics->>'nominalFeeMinor')::numeric=(economics->>'retiredFeeMinor')::numeric+(economics->>'assignedFeeMinor')::numeric
  AND(economics->>'assignedFeeMinor')::numeric=(economics->>'provenCollectedMinor')::numeric+(economics->>'owedFeeMinor')::numeric) IS TRUE),
 CONSTRAINT credit_atomic_reservation_before_entries CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries)<=5000)
);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_funding ON invoice_credit_reservation_atomic_fee_partitions(funding_id,reservation_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_root ON invoice_credit_reservation_atomic_fee_partitions(source_payment_id,root_funding_id,reservation_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_application ON invoice_credit_reservation_atomic_fee_partitions(source_application_id,reservation_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_credit_fee_partition(actual_payment_id uuid,actual_source_application_id uuid,take_minor bigint)
RETURNS TABLE(known boolean,principal_minor bigint,original_fee_minor bigint,retired_fee_minor bigint,allocated_principal_minor bigint,allocated_nominal_fee_minor bigint,
 allocated_assigned_fee_minor bigint,allocated_retired_fee_minor bigint,take_nominal_fee_minor bigint,take_retired_fee_minor bigint,take_assigned_fee_minor bigint,
 take_collected_fee_minor bigint,take_owed_fee_minor bigint,remaining_principal_minor bigint,remaining_actual_fee_minor bigint,source_receipt_id uuid,
 bank_inspection_id uuid,bank_observation_id uuid,bank_namespace_revision text,evidence_fingerprint text)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE cash_payment payments%ROWTYPE;cash_route merchant_agreement_payment_routes%ROWTYPE;cash_link controlled_cash_application_links%ROWTYPE;cash_batch controlled_cash_application_batches%ROWTYPE;
 source_application invoice_credit_applications%ROWTYPE;source_reservation invoice_credit_reservations%ROWTYPE;source_reservation_partition invoice_credit_reservation_atomic_fee_partitions%ROWTYPE;
 legacy_source_funding invoice_credit_funding%ROWTYPE;legacy_source_proration subscription_prorations%ROWTYPE;legacy_source_quote subscription_controlled_quotes%ROWTYPE;legacy_quote_count bigint;
 source_root invoice_credit_funding_atomic_fee_partitions%ROWTYPE;root_parent invoice_credit_funding%ROWTYPE;fee_state record;bank_state record;root_capacity record;loan record;part jsonb;parent_part jsonb;used_part jsonb;
 scope jsonb;physical_rows jsonb;physical_count bigint;seen uuid[]:=ARRAY[]::uuid[];prior_returned numeric;collected numeric;legacy_principal numeric;legacy_fee numeric;declared_proven numeric;
 allocated_principal numeric:=0;allocated_nominal numeric:=0;allocated_assigned numeric:=0;allocated_retired numeric:=0;birth_retired numeric:=0;prior_retired numeric:=0;after_principal numeric;nominal numeric;assigned numeric;proven numeric;available_actual numeric;
 root_principal numeric;root_fee numeric;epoch_start numeric;epoch_end numeric;epoch_assigned numeric;epoch_proven numeric;interval_start numeric;interval_end numeric;base_floor numeric;n0 numeric;n1 numeric;a0 numeric;a1 numeric;c0 numeric;c1 numeric;
 source_parts jsonb;used_parts jsonb:='[]'::jsonb;free_start numeric;free_end numeric;needed numeric;take_end numeric;selected_nominal numeric:=0;selected_retired numeric:=0;selected_assigned numeric:=0;selected_proven numeric:=0;available_principal numeric:=0;source_principal numeric:=0;source_nominal numeric:=0;source_retired numeric:=0;source_assigned numeric:=0;source_proven numeric:=0;
 loan_principal numeric;loan_nominal numeric;loan_assigned numeric;loan_retired numeric;loan_proven numeric;bad_chain boolean;conflicting_physical boolean;numeric_field text;
BEGIN
 IF take_minor IS NULL OR take_minor<0 OR take_minor>9007199254740991 OR NOT freeholder_credit_atomic_fee_ready() THEN RETURN;END IF;
 SELECT actual_cash.* INTO cash_payment FROM payments actual_cash WHERE actual_cash.id=actual_payment_id;
 SELECT actual_route.* INTO cash_route FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=actual_payment_id;
 SELECT actual_link.* INTO cash_link FROM controlled_cash_application_links actual_link WHERE actual_link.payment_id=actual_payment_id;
 SELECT actual_batch.* INTO cash_batch FROM controlled_cash_application_batches actual_batch WHERE actual_batch.id=cash_link.batch_id;
 IF cash_payment.id IS NULL OR cash_payment.status IS DISTINCT FROM 'succeeded' OR cash_payment.refunded_minor<>0 OR cash_route.original_charge_receipt_id IS DISTINCT FROM cash_link.receipt_id
  OR cash_batch.id IS NULL OR cash_batch.invoice_id IS DISTINCT FROM cash_payment.invoice_id OR cash_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1')
  OR NOT EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=cash_payment.invoice_id AND atomic_epoch.protocol='controlled_cash_atomic.v1') THEN RETURN;END IF;
 SELECT actual_fee.* INTO fee_state FROM freeholder_controlled_atomic_refund_fee_state(actual_payment_id) actual_fee;
 SELECT actual_bank.* INTO bank_state FROM freeholder_controlled_receipt_bank_observation(cash_batch.collection_id,cash_link.receipt_id) actual_bank;
 IF fee_state.known IS DISTINCT FROM true OR fee_state.reconciled IS DISTINCT FROM true OR bank_state.actual_inspection_id IS NULL
  OR fee_state.receipt_id IS DISTINCT FROM cash_link.receipt_id OR fee_state.inspection_id IS DISTINCT FROM bank_state.actual_inspection_id
  OR fee_state.observation_id IS DISTINCT FROM bank_state.actual_observation_id OR fee_state.bank_namespace_revision IS DISTINCT FROM bank_state.bank_fingerprint
  OR EXISTS(SELECT 1 FROM freeholder_atomic_fee_return_resources(actual_payment_id) physical_return WHERE NOT physical_return.known OR physical_return.pending) THEN RETURN;END IF;
 SELECT coalesce(sum(physical_return.amount_minor),0) INTO prior_returned FROM freeholder_atomic_fee_return_resources(actual_payment_id) physical_return WHERE physical_return.known;
 collected:=fee_state.actual_retained_fee_minor;
 IF collected<0 OR collected+prior_returned<>cash_route.application_fee_minor THEN RETURN;END IF;
 source_receipt_id:=cash_link.receipt_id;bank_inspection_id:=bank_state.actual_inspection_id;bank_observation_id:=bank_state.actual_observation_id;bank_namespace_revision:=bank_state.bank_fingerprint;
 root_principal:=cash_payment.amount_minor;root_fee:=cash_route.application_fee_minor;
 IF actual_source_application_id IS NULL THEN
  principal_minor:=cash_payment.amount_minor;original_fee_minor:=cash_route.application_fee_minor;retired_fee_minor:=prior_returned;
  IF EXISTS(SELECT 1 FROM invoice_credit_funding existing_funding JOIN credit_notes original_note ON original_note.id=existing_funding.credit_note_id
   WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id IS NULL AND(original_note.status<>'issued'
    OR EXISTS(SELECT 1 FROM return_requests original_return WHERE original_return.credit_note_id=original_note.id))) THEN RETURN;END IF;
  SELECT coalesce(sum(existing_funding.amount_minor),0),coalesce(sum(existing_funding.fee_obligation_minor),0),coalesce(sum(existing_funding.fee_proven_collected_minor),0),coalesce(array_agg(existing_funding.id ORDER BY existing_funding.id),ARRAY[]::uuid[])
   INTO legacy_principal,legacy_fee,declared_proven,seen FROM invoice_credit_funding existing_funding LEFT JOIN invoice_credit_funding_atomic_fee_partitions purpose ON purpose.funding_id=existing_funding.id
   WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id IS NULL AND purpose.funding_id IS NULL;
  IF cardinality(seen)>5000 OR legacy_principal>root_principal OR legacy_fee<>floor(root_fee*legacy_principal/root_principal) THEN RETURN;END IF;
  allocated_principal:=legacy_principal;allocated_nominal:=legacy_fee;allocated_assigned:=legacy_fee;
  FOR loan IN SELECT existing_funding.*,purpose.economics AS purpose_economics,purpose.parent_fingerprint AS purpose_parent_fingerprint,purpose.protocol AS purpose_protocol,purpose.digest AS purpose_digest,purpose.authentication AS purpose_authentication
   FROM invoice_credit_funding existing_funding JOIN invoice_credit_funding_atomic_fee_partitions purpose ON purpose.funding_id=existing_funding.id
   WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id IS NULL
   ORDER BY jsonb_array_length(purpose.economics->'plan'->'priorFundingIds'),existing_funding.id LOOP
   IF loan.purpose_protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-partition.v1' OR loan.purpose_digest!~'^[a-f0-9]{64}$' OR loan.purpose_authentication!~'^[a-f0-9]{64}$'
    OR loan.purpose_economics->'plan'->>'epochKind' IS DISTINCT FROM 'direct'
    OR loan.purpose_economics->'plan'->>'sourcePaymentId' IS DISTINCT FROM actual_payment_id::text
    OR loan.purpose_economics->'plan'->>'originalPrincipalMinor' IS DISTINCT FROM principal_minor::text
    OR loan.purpose_economics->'plan'->>'originalFeeMinor' IS DISTINCT FROM original_fee_minor::text
    OR loan.purpose_parent_fingerprint IS DISTINCT FROM(SELECT encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') FROM invoice_credit_funding actual_parent WHERE actual_parent.id=loan.id)
    OR jsonb_array_length(loan.purpose_economics->'plan'->'priorFundingIds')<>cardinality(seen)
    OR(SELECT count(*) FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id)<>(SELECT count(DISTINCT prior_id) FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id WHERE NOT prior_id::uuid=ANY(seen)) THEN RETURN;END IF;
   birth_retired:=(loan.purpose_economics->'plan'->>'acceptedRetiredFeeMinor')::numeric;after_principal:=allocated_principal+loan.amount_minor;
   IF birth_retired<prior_retired OR birth_retired>prior_returned OR after_principal>root_principal THEN RETURN;END IF;
   nominal:=floor(root_fee*after_principal/root_principal)-allocated_nominal;available_actual:=root_fee-birth_retired-allocated_assigned;
   IF available_actual<0 THEN RETURN;END IF;assigned:=least(nominal,available_actual);
   IF loan.amount_minor<=0 OR loan.fee_obligation_minor<>assigned OR loan.fee_proven_collected_minor<0 OR loan.fee_proven_collected_minor>assigned OR loan.fee_unexpected
    OR loan.purpose_economics->'plan'->>'takePrincipalMinor' IS DISTINCT FROM loan.amount_minor::text
    OR loan.purpose_economics->'plan'->>'takeNominalFeeMinor' IS DISTINCT FROM nominal::text
    OR loan.purpose_economics->'plan'->>'takeAssignedFeeMinor' IS DISTINCT FROM assigned::text
    OR loan.purpose_economics->'plan'->>'takeRetiredFeeMinor' IS DISTINCT FROM(nominal-assigned)::text
    OR loan.purpose_economics->'plan'->>'takeProvenCollectedMinor' IS DISTINCT FROM loan.fee_proven_collected_minor::text THEN RETURN;END IF;
   allocated_principal:=after_principal;allocated_nominal:=allocated_nominal+nominal;allocated_assigned:=allocated_assigned+assigned;declared_proven:=declared_proven+loan.fee_proven_collected_minor;
   prior_retired:=birth_retired;seen:=array_append(seen,loan.id);IF cardinality(seen)>5000 THEN RETURN;END IF;
  END LOOP;
  available_actual:=root_fee-prior_returned-allocated_assigned;
  IF allocated_principal>root_principal OR available_actual<0 OR declared_proven>collected OR allocated_nominal-allocated_assigned>prior_returned OR allocated_principal+take_minor>root_principal THEN RETURN;END IF;
  nominal:=floor(root_fee*(allocated_principal+take_minor)/root_principal)-allocated_nominal;assigned:=least(nominal,available_actual);proven:=least(assigned,greatest(0,collected-allocated_assigned));
  take_nominal_fee_minor:=nominal;take_assigned_fee_minor:=assigned;take_retired_fee_minor:=nominal-assigned;take_collected_fee_minor:=proven;take_owed_fee_minor:=assigned-proven;
  remaining_principal_minor:=root_principal-allocated_principal-take_minor;remaining_actual_fee_minor:=available_actual-assigned;
 ELSE
  SELECT actual_application.* INTO source_application FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=actual_source_application_id;
  SELECT actual_reservation.* INTO source_reservation FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.id=actual_source_application_id;
  SELECT actual_partition.* INTO source_reservation_partition FROM invoice_credit_reservation_atomic_fee_partitions actual_partition WHERE actual_partition.reservation_id=actual_source_application_id;
  IF source_reservation_partition.reservation_id IS NULL THEN
   -- Positive old-application ancestry is required. Absence of a purpose row
   -- does not establish the class, nor an offset into the original payment.
   SELECT actual_parent.* INTO legacy_source_funding FROM invoice_credit_funding actual_parent WHERE actual_parent.id=source_reservation.funding_id;
   SELECT accepted.* INTO legacy_source_proration FROM subscription_prorations accepted WHERE accepted.id=legacy_source_funding.proration_id;
   SELECT count(*) INTO legacy_quote_count FROM subscription_controlled_quotes actual_quote WHERE actual_quote.planned_proration_id=legacy_source_proration.id AND actual_quote.quote_digest=legacy_source_proration.accepted_quote_digest;
   IF legacy_quote_count<>1 THEN RETURN;END IF;
   SELECT actual_quote.* INTO legacy_source_quote FROM subscription_controlled_quotes actual_quote WHERE actual_quote.planned_proration_id=legacy_source_proration.id AND actual_quote.quote_digest=legacy_source_proration.accepted_quote_digest;
   IF source_application.reservation_id IS NULL OR source_reservation.id IS NULL OR legacy_source_funding.id IS NULL OR legacy_source_proration.id IS NULL
    OR legacy_source_quote.kind IS DISTINCT FROM 'proration' OR legacy_source_quote.review IS NULL OR legacy_source_quote.redacted_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(legacy_source_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
     WHERE declared_source.value->>'fundingId'=legacy_source_funding.id::text OR(declared_source.value->>'sourcePaymentId'=legacy_source_funding.source_payment_id::text
      AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM legacy_source_funding.source_application_id::text))
    OR legacy_source_quote.previous_terms_id IS DISTINCT FROM legacy_source_proration.previous_terms_id
    OR legacy_source_quote.profile_id IS DISTINCT FROM legacy_source_proration.profile_id OR legacy_source_quote.profile_version IS DISTINCT FROM legacy_source_proration.profile_version
    OR NOT EXISTS(SELECT 1 FROM subscription_controlled_resources original_resource WHERE original_resource.id=legacy_source_quote.resource_id AND original_resource.subscription_id=legacy_source_proration.subscription_id)
    OR legacy_source_funding.source_payment_id IS DISTINCT FROM actual_payment_id OR legacy_source_funding.source_invoice_id IS DISTINCT FROM legacy_source_proration.original_invoice_id
    OR legacy_source_funding.credit_note_id IS DISTINCT FROM legacy_source_proration.credit_note_id OR legacy_source_funding.original_evidence_digest IS DISTINCT FROM legacy_source_proration.source_revision
    OR EXISTS(SELECT 1 FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.funding_id=legacy_source_funding.id)
    OR EXISTS(SELECT 1 FROM invoice_credit_releases actual_release WHERE actual_release.reservation_id=actual_source_application_id)
    OR EXISTS(SELECT 1 FROM return_requests original_return WHERE original_return.credit_note_id=legacy_source_funding.credit_note_id)
    OR source_application.fee_unexpected OR source_reservation.fee_unexpected OR legacy_source_funding.fee_unexpected
    OR source_application.fee_obligation_minor IS DISTINCT FROM source_reservation.fee_obligation_minor
    OR source_application.fee_proven_collected_minor IS DISTINCT FROM source_reservation.fee_proven_collected_minor
    OR source_application.fee_collection_state IS DISTINCT FROM source_reservation.fee_collection_state
    OR source_application.fee_proven_collected_minor<>source_application.fee_obligation_minor
    OR source_application.fee_collection_state NOT IN('not_due','recorded_remitted','verified_collected')
    OR NOT EXISTS(SELECT 1 FROM invoices actual_target WHERE actual_target.id=source_application.invoice_id AND actual_target.source_type='subscription' AND actual_target.source_id=source_reservation.target_source_id)
    OR source_application.fee_evidence_digest IS NULL OR source_reservation.fee_evidence_digest IS NULL
    OR source_reservation.amount_minor>legacy_source_funding.amount_minor OR source_reservation.fee_obligation_minor>legacy_source_funding.fee_obligation_minor
    OR(SELECT count(*) FROM credit_note_lines actual_line WHERE actual_line.credit_note_id=legacy_source_funding.credit_note_id)<>1
    OR NOT EXISTS(SELECT 1 FROM credit_notes actual_note JOIN credit_note_lines actual_line ON actual_line.credit_note_id=actual_note.id
      WHERE actual_note.id=legacy_source_funding.credit_note_id AND actual_note.invoice_id=legacy_source_proration.original_invoice_id AND actual_note.status='issued'
       AND actual_note.idempotency_key='subscription-proration:'||legacy_source_proration.id::text||':credit'
       AND actual_line.id=legacy_source_funding.credit_note_line_id AND actual_line.invoice_line_id=legacy_source_proration.original_invoice_line_id)
    OR(SELECT count(*) FROM subscription_proration_principal original_principal WHERE original_principal.proration_id=legacy_source_proration.id
      AND original_principal.source_payment_id=legacy_source_funding.source_payment_id AND original_principal.source_application_id IS NOT DISTINCT FROM legacy_source_funding.source_application_id)<>1
    OR NOT EXISTS(SELECT 1 FROM subscription_proration_principal original_principal WHERE original_principal.proration_id=legacy_source_proration.id
      AND original_principal.source_payment_id=legacy_source_funding.source_payment_id AND original_principal.source_application_id IS NOT DISTINCT FROM legacy_source_funding.source_application_id
      AND original_principal.original_evidence_digest=legacy_source_funding.original_evidence_digest AND original_principal.amount_minor=legacy_source_funding.amount_minor
      AND original_principal.fee_obligation_minor=legacy_source_funding.fee_obligation_minor AND original_principal.fee_proven_collected_minor=legacy_source_funding.fee_proven_collected_minor
      AND original_principal.fee_evidence_digest=legacy_source_funding.fee_evidence_digest) THEN RETURN;END IF;
   IF EXISTS(SELECT 1 FROM invoice_credit_reservations original_reservation
     LEFT JOIN invoice_credit_applications original_application ON original_application.reservation_id=original_reservation.id
     LEFT JOIN invoice_credit_releases original_release ON original_release.reservation_id=original_reservation.id
     WHERE original_reservation.funding_id=legacy_source_funding.id
     GROUP BY original_reservation.funding_id HAVING count(*)>5000
      OR coalesce(bool_or(original_application.reservation_id IS NOT NULL AND original_release.reservation_id IS NOT NULL),false)
      OR coalesce(sum(original_reservation.amount_minor) FILTER(WHERE original_application.reservation_id IS NOT NULL OR original_release.reservation_id IS NULL),0)>legacy_source_funding.amount_minor
      OR coalesce(sum(original_reservation.fee_obligation_minor) FILTER(WHERE original_application.reservation_id IS NOT NULL OR original_release.reservation_id IS NULL),0)>legacy_source_funding.fee_obligation_minor
      OR coalesce(sum(original_reservation.fee_proven_collected_minor) FILTER(WHERE original_application.reservation_id IS NOT NULL OR original_release.reservation_id IS NULL),0)>legacy_source_funding.fee_proven_collected_minor)
    OR EXISTS(SELECT 1 FROM invoice_credit_funding existing_funding JOIN credit_notes actual_note ON actual_note.id=existing_funding.credit_note_id
     WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id=actual_source_application_id
      AND(actual_note.status<>'issued' OR EXISTS(SELECT 1 FROM return_requests original_return WHERE original_return.credit_note_id=actual_note.id))) THEN RETURN;END IF;
   SELECT original_capacity.* INTO root_capacity FROM freeholder_atomic_credit_fee_partition(actual_payment_id,NULL,0) original_capacity;
   IF root_capacity.known IS DISTINCT FROM true OR root_capacity.original_fee_minor<>cash_route.application_fee_minor THEN RETURN;END IF;
   root_principal:=source_reservation.amount_minor;root_fee:=source_application.fee_obligation_minor;
   IF root_principal<=0 OR root_fee<0 OR root_fee>root_principal THEN RETURN;END IF;
   principal_minor:=root_principal;original_fee_minor:=root_fee;retired_fee_minor:=0;
   SELECT coalesce(sum(existing_funding.amount_minor),0),coalesce(sum(existing_funding.fee_obligation_minor),0),coalesce(sum(existing_funding.fee_proven_collected_minor),0),coalesce(array_agg(existing_funding.id ORDER BY existing_funding.id),ARRAY[]::uuid[])
    INTO legacy_principal,legacy_fee,declared_proven,seen FROM invoice_credit_funding existing_funding LEFT JOIN invoice_credit_funding_atomic_fee_partitions actual_purpose ON actual_purpose.funding_id=existing_funding.id
    WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id=actual_source_application_id AND actual_purpose.funding_id IS NULL;
   IF cardinality(seen)>5000 OR legacy_principal>root_principal OR legacy_fee<>floor(root_fee*legacy_principal/root_principal)
    OR EXISTS(SELECT 1 FROM invoice_credit_funding existing_funding JOIN subscription_prorations accepted ON accepted.id=existing_funding.proration_id
     LEFT JOIN subscription_controlled_quotes actual_quote ON actual_quote.planned_proration_id=accepted.id AND actual_quote.quote_digest=accepted.accepted_quote_digest
     WHERE existing_funding.id=ANY(seen) AND(actual_quote.id IS NULL OR actual_quote.review IS NULL
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
       WHERE declared_source.value->>'fundingId'=existing_funding.id::text OR(declared_source.value->>'sourcePaymentId'=existing_funding.source_payment_id::text
        AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM existing_funding.source_application_id::text)))) THEN RETURN;END IF;
   allocated_principal:=legacy_principal;allocated_nominal:=legacy_fee;allocated_assigned:=legacy_fee;
   FOR loan IN SELECT existing_funding.*,actual_purpose.economics AS purpose_economics,actual_purpose.parent_fingerprint AS purpose_parent_fingerprint
    FROM invoice_credit_funding existing_funding JOIN invoice_credit_funding_atomic_fee_partitions actual_purpose ON actual_purpose.funding_id=existing_funding.id
    WHERE existing_funding.source_payment_id=actual_payment_id AND existing_funding.source_application_id=actual_source_application_id
    ORDER BY jsonb_array_length(actual_purpose.economics->'plan'->'priorFundingIds'),existing_funding.id LOOP
    IF loan.purpose_parent_fingerprint IS DISTINCT FROM(SELECT encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') FROM invoice_credit_funding actual_parent WHERE actual_parent.id=loan.id)
     OR loan.purpose_economics->'plan'->>'rootKind' IS DISTINCT FROM 'legacy_application'
     OR loan.purpose_economics->'plan'->>'rootApplicationId' IS DISTINCT FROM actual_source_application_id::text OR loan.purpose_economics->'plan'->>'rootFundingId' IS NOT NULL
     OR loan.purpose_economics->'plan'->>'originalRootPrincipalMinor' IS DISTINCT FROM root_principal::text OR loan.purpose_economics->'plan'->>'originalRootFeeMinor' IS DISTINCT FROM root_fee::text
     OR loan.purpose_economics->'plan'->'legacyApplicationProof'->>'applicationFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(source_application)::text,'UTF8')),'hex')
     OR loan.purpose_economics->'plan'->'legacyApplicationProof'->>'reservationFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(source_reservation)::text,'UTF8')),'hex')
     OR loan.purpose_economics->'plan'->'legacyApplicationProof'->>'fundingFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(legacy_source_funding)::text,'UTF8')),'hex')
     OR loan.purpose_economics->'plan'->'legacyApplicationProof'->>'quoteFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(legacy_source_quote)::text,'UTF8')),'hex')
     OR jsonb_array_length(loan.purpose_economics->'plan'->'priorFundingIds')<>cardinality(seen)
     OR(SELECT count(*) FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id)<>(SELECT count(DISTINCT prior_id) FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(loan.purpose_economics->'plan'->'priorFundingIds') prior_id WHERE NOT prior_id::uuid=ANY(seen)) THEN RETURN;END IF;
    after_principal:=allocated_principal+loan.amount_minor;nominal:=floor(root_fee*after_principal/root_principal)-allocated_nominal;
    IF after_principal>root_principal OR loan.fee_unexpected OR loan.fee_obligation_minor<>nominal OR loan.fee_proven_collected_minor<>nominal
     OR loan.purpose_economics->'plan'->>'acceptedRetiredFeeMinor' IS DISTINCT FROM '0'
     OR loan.purpose_economics->'plan'->>'takeNominalFeeMinor' IS DISTINCT FROM nominal::text OR loan.purpose_economics->'plan'->>'takeAssignedFeeMinor' IS DISTINCT FROM nominal::text
     OR loan.purpose_economics->'plan'->>'takeRetiredFeeMinor' IS DISTINCT FROM '0' THEN RETURN;END IF;
    allocated_principal:=after_principal;allocated_nominal:=allocated_nominal+nominal;allocated_assigned:=allocated_assigned+nominal;declared_proven:=declared_proven+loan.fee_proven_collected_minor;
    seen:=array_append(seen,loan.id);IF cardinality(seen)>5000 THEN RETURN;END IF;
   END LOOP;
   IF allocated_principal+take_minor>root_principal OR allocated_assigned>root_fee OR declared_proven>source_application.fee_proven_collected_minor THEN RETURN;END IF;
   nominal:=floor(root_fee*(allocated_principal+take_minor)/root_principal)-allocated_nominal;
   take_nominal_fee_minor:=nominal;take_assigned_fee_minor:=nominal;take_retired_fee_minor:=0;take_collected_fee_minor:=nominal;take_owed_fee_minor:=0;
   remaining_principal_minor:=root_principal-allocated_principal-take_minor;remaining_actual_fee_minor:=root_fee-allocated_assigned-nominal;
  ELSE
  SELECT actual_root.* INTO source_root FROM invoice_credit_funding_atomic_fee_partitions actual_root WHERE actual_root.funding_id=source_reservation_partition.root_funding_id;
  SELECT actual_root_parent.* INTO root_parent FROM invoice_credit_funding actual_root_parent WHERE actual_root_parent.id=source_root.funding_id;
  IF source_application.reservation_id IS NULL OR source_reservation.id IS NULL OR source_reservation_partition.reservation_id IS NULL OR source_root.funding_id IS NULL
   OR source_root.economics->'plan'->>'rootFundingId' IS NOT NULL
   OR((source_root.economics->'plan'->>'rootKind'='payment' AND source_root.source_application_id IS NULL)
    OR(source_root.economics->'plan'->>'rootKind'='legacy_application' AND source_root.source_application_id::text=source_root.economics->'plan'->>'rootApplicationId')) IS DISTINCT FROM true
   OR source_root.source_payment_id IS DISTINCT FROM actual_payment_id OR root_parent.source_payment_id IS DISTINCT FROM actual_payment_id
   OR source_reservation_partition.source_payment_id IS DISTINCT FROM actual_payment_id OR source_reservation_partition.protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-reservation.v1'
   OR source_reservation_partition.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(source_reservation)::text,'UTF8')),'hex')
   OR source_root.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(root_parent)::text,'UTF8')),'hex')
   OR source_reservation_partition.economics->>'rootEconomicRevision' IS DISTINCT FROM source_root.economics->'plan'->>'economicRevision'
   OR source_reservation.fee_unexpected OR source_application.fee_unexpected OR source_application.fee_obligation_minor<>source_reservation.fee_obligation_minor OR source_application.fee_proven_collected_minor<>source_reservation.fee_proven_collected_minor
   OR source_application.fee_proven_collected_minor<>source_application.fee_obligation_minor OR EXISTS(SELECT 1 FROM invoice_credit_releases actual_release WHERE actual_release.reservation_id=actual_source_application_id) THEN RETURN;END IF;
  SELECT root_result.* INTO root_capacity FROM freeholder_atomic_credit_fee_partition(actual_payment_id,NULL,0) root_result;
  IF root_capacity.known IS DISTINCT FROM true OR root_capacity.original_fee_minor<>root_fee THEN RETURN;END IF;
  -- The real original payment capacity is proved above. Descendant arithmetic
  -- then uses the immutable positively proved root epoch, never a fabricated
  -- offset into the payment or a new retained-fee/principal fraction.
  root_principal:=(source_root.economics->'plan'->>'originalRootPrincipalMinor')::numeric;
  root_fee:=(source_root.economics->'plan'->>'originalRootFeeMinor')::numeric;
  IF root_principal<=0 OR root_principal>cash_payment.amount_minor OR root_fee<0 OR root_fee>cash_route.application_fee_minor THEN RETURN;END IF;
  source_parts:=source_reservation_partition.economics->'segments';
  IF jsonb_typeof(source_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(source_parts) NOT BETWEEN 1 AND 5000 THEN RETURN;END IF;
  WITH RECURSIVE ancestry(id,source_payment_id,source_application_id,path,cycle) AS(
   SELECT actual_funding.id,actual_funding.source_payment_id,actual_funding.source_application_id,ARRAY[actual_funding.id],false FROM invoice_credit_funding actual_funding WHERE actual_funding.id=source_reservation.funding_id
   UNION ALL SELECT predecessor.id,predecessor.source_payment_id,predecessor.source_application_id,ancestry.path||predecessor.id,predecessor.id=ANY(ancestry.path)
    FROM ancestry JOIN invoice_credit_applications inherited ON inherited.reservation_id=ancestry.source_application_id
    JOIN invoice_credit_reservations inherited_reservation ON inherited_reservation.id=inherited.reservation_id JOIN invoice_credit_funding predecessor ON predecessor.id=inherited_reservation.funding_id
    WHERE NOT ancestry.cycle AND cardinality(ancestry.path)<=5000
  ) SELECT EXISTS(SELECT 1 FROM ancestry WHERE ancestry.cycle OR cardinality(ancestry.path)>5000 OR ancestry.source_payment_id<>actual_payment_id)
   OR NOT EXISTS(SELECT 1 FROM ancestry WHERE ancestry.id=source_root.funding_id AND ancestry.source_application_id IS NOT DISTINCT FROM source_root.source_application_id) INTO bad_chain;
  IF bad_chain THEN RETURN;END IF;
  FOR part IN SELECT actual_part.value FROM jsonb_array_elements(source_parts) actual_part(value) ORDER BY(actual_part.value->>'startMinor')::numeric LOOP
   FOREACH numeric_field IN ARRAY ARRAY['epochStartMinor','epochEndMinor','epochAssignedFeeMinor','epochProvenCollectedMinor','startMinor','endMinor','nominalFeeMinor','retiredFeeMinor','assignedFeeMinor','provenCollectedMinor','owedFeeMinor'] LOOP
    IF NOT freeholder_controlled_bank_minor(part->numeric_field) THEN RETURN;END IF;
   END LOOP;
   epoch_start:=(part->>'epochStartMinor')::numeric;epoch_end:=(part->>'epochEndMinor')::numeric;epoch_assigned:=(part->>'epochAssignedFeeMinor')::numeric;epoch_proven:=(part->>'epochProvenCollectedMinor')::numeric;
   interval_start:=(part->>'startMinor')::numeric;interval_end:=(part->>'endMinor')::numeric;base_floor:=floor(root_fee*epoch_start/root_principal);
   n0:=floor(root_fee*interval_start/root_principal)-base_floor;n1:=floor(root_fee*interval_end/root_principal)-base_floor;a0:=least(n0,epoch_assigned);a1:=least(n1,epoch_assigned);c0:=least(a0,epoch_proven);c1:=least(a1,epoch_proven);
   IF part->>'epochFundingId' IS DISTINCT FROM source_root.funding_id::text
    OR epoch_start IS DISTINCT FROM(source_root.economics->'plan'->>'allocatedPrincipalMinor')::numeric OR epoch_end IS DISTINCT FROM(source_root.economics->'plan'->>'afterPrincipalMinor')::numeric
    OR epoch_assigned IS DISTINCT FROM root_parent.fee_obligation_minor OR epoch_proven IS DISTINCT FROM root_parent.fee_proven_collected_minor
    OR interval_start<epoch_start OR interval_start>=interval_end OR interval_end>epoch_end OR epoch_end>root_principal OR epoch_proven<0 OR epoch_proven>epoch_assigned
    OR part->>'nominalFeeMinor' IS DISTINCT FROM(n1-n0)::text OR part->>'assignedFeeMinor' IS DISTINCT FROM(a1-a0)::text OR part->>'retiredFeeMinor' IS DISTINCT FROM(n1-n0-a1+a0)::text
    OR part->>'provenCollectedMinor' IS DISTINCT FROM(c1-c0)::text OR part->>'owedFeeMinor' IS DISTINCT FROM(a1-a0-c1+c0)::text THEN RETURN;END IF;
   source_principal:=source_principal+interval_end-interval_start;source_nominal:=source_nominal+n1-n0;source_retired:=source_retired+n1-n0-a1+a0;source_assigned:=source_assigned+a1-a0;source_proven:=source_proven+c1-c0;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(source_parts) WITH ORDINALITY first_part(value,n) CROSS JOIN jsonb_array_elements(source_parts) WITH ORDINALITY other_part(value,n)
   WHERE first_part.n<other_part.n AND(first_part.value->>'startMinor')::numeric<(other_part.value->>'endMinor')::numeric AND(other_part.value->>'startMinor')::numeric<(first_part.value->>'endMinor')::numeric)
   OR(SELECT count(*) FROM jsonb_array_elements(source_parts))<>(SELECT count(DISTINCT(selected_part->>'startMinor',selected_part->>'endMinor')) FROM jsonb_array_elements(source_parts) selected_part)
   OR source_principal<>source_reservation.amount_minor OR source_assigned<>source_application.fee_obligation_minor OR source_proven<>source_application.fee_proven_collected_minor THEN RETURN;END IF;
  principal_minor:=source_reservation.amount_minor;original_fee_minor:=source_nominal;retired_fee_minor:=source_retired;
  IF EXISTS(SELECT 1 FROM invoice_credit_funding inherited_loan JOIN credit_notes original_note ON original_note.id=inherited_loan.credit_note_id
   WHERE inherited_loan.source_payment_id=actual_payment_id AND inherited_loan.source_application_id=actual_source_application_id
    AND(original_note.status<>'issued' OR EXISTS(SELECT 1 FROM return_requests original_return WHERE original_return.credit_note_id=original_note.id))) THEN RETURN;END IF;
  FOR loan IN SELECT actual_funding.*,actual_partition.economics AS purpose_economics,actual_partition.parent_fingerprint AS purpose_parent_fingerprint
   FROM invoice_credit_funding actual_funding LEFT JOIN invoice_credit_funding_atomic_fee_partitions actual_partition ON actual_partition.funding_id=actual_funding.id
   WHERE actual_funding.source_payment_id=actual_payment_id AND actual_funding.source_application_id=actual_source_application_id ORDER BY actual_funding.id LOOP
   IF loan.purpose_economics IS NULL OR loan.purpose_parent_fingerprint IS DISTINCT FROM(SELECT encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') FROM invoice_credit_funding actual_parent WHERE actual_parent.id=loan.id)
    OR loan.purpose_economics->'plan'->>'rootFundingId' IS DISTINCT FROM source_root.funding_id::text OR loan.purpose_economics->'plan'->'sourceSegments' IS DISTINCT FROM source_parts
    OR jsonb_typeof(loan.purpose_economics->'plan'->'takeSegments') IS DISTINCT FROM 'array' THEN RETURN;END IF;
   loan_principal:=0;loan_nominal:=0;loan_assigned:=0;loan_retired:=0;loan_proven:=0;
   FOR part IN SELECT actual_part.value FROM jsonb_array_elements(loan.purpose_economics->'plan'->'takeSegments') actual_part(value) LOOP
    FOREACH numeric_field IN ARRAY ARRAY['epochStartMinor','epochEndMinor','epochAssignedFeeMinor','epochProvenCollectedMinor','startMinor','endMinor','nominalFeeMinor','retiredFeeMinor','assignedFeeMinor','provenCollectedMinor','owedFeeMinor'] LOOP
     IF NOT freeholder_controlled_bank_minor(part->numeric_field) THEN RETURN;END IF;
    END LOOP;
    epoch_start:=(part->>'epochStartMinor')::numeric;epoch_assigned:=(part->>'epochAssignedFeeMinor')::numeric;epoch_proven:=(part->>'epochProvenCollectedMinor')::numeric;
    interval_start:=(part->>'startMinor')::numeric;interval_end:=(part->>'endMinor')::numeric;base_floor:=floor(root_fee*epoch_start/root_principal);
    n0:=floor(root_fee*interval_start/root_principal)-base_floor;n1:=floor(root_fee*interval_end/root_principal)-base_floor;a0:=least(n0,epoch_assigned);a1:=least(n1,epoch_assigned);c0:=least(a0,epoch_proven);c1:=least(a1,epoch_proven);
    IF interval_start>=interval_end OR part->>'nominalFeeMinor' IS DISTINCT FROM(n1-n0)::text OR part->>'assignedFeeMinor' IS DISTINCT FROM(a1-a0)::text
     OR part->>'retiredFeeMinor' IS DISTINCT FROM(n1-n0-a1+a0)::text OR part->>'provenCollectedMinor' IS DISTINCT FROM(c1-c0)::text OR part->>'owedFeeMinor' IS DISTINCT FROM(a1-a0-c1+c0)::text THEN RETURN;END IF;
    loan_principal:=loan_principal+interval_end-interval_start;loan_nominal:=loan_nominal+n1-n0;loan_assigned:=loan_assigned+a1-a0;loan_retired:=loan_retired+n1-n0-a1+a0;loan_proven:=loan_proven+c1-c0;
   END LOOP;
   IF loan_principal<>loan.amount_minor OR loan_assigned<>loan.fee_obligation_minor OR loan_proven<>loan.fee_proven_collected_minor
    OR loan.purpose_economics->'plan'->>'takeNominalFeeMinor' IS DISTINCT FROM loan_nominal::text OR loan.purpose_economics->'plan'->>'takeRetiredFeeMinor' IS DISTINCT FROM loan_retired::text THEN RETURN;END IF;
   used_parts:=used_parts||(loan.purpose_economics->'plan'->'takeSegments');
   allocated_principal:=allocated_principal+loan.amount_minor;allocated_nominal:=allocated_nominal+(loan.purpose_economics->'plan'->>'takeNominalFeeMinor')::numeric;
   allocated_assigned:=allocated_assigned+loan.fee_obligation_minor;allocated_retired:=allocated_retired+(loan.purpose_economics->'plan'->>'takeRetiredFeeMinor')::numeric;
  END LOOP;
  IF jsonb_array_length(used_parts)+jsonb_array_length(source_parts)>5000 OR allocated_principal+take_minor>principal_minor THEN RETURN;END IF;
  FOR part IN SELECT actual_part.value FROM jsonb_array_elements(used_parts) actual_part(value) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_parts) parent_value WHERE part->>'epochFundingId'=parent_value->>'epochFundingId'
    AND part->>'epochStartMinor'=parent_value->>'epochStartMinor' AND part->>'epochEndMinor'=parent_value->>'epochEndMinor' AND part->>'epochAssignedFeeMinor'=parent_value->>'epochAssignedFeeMinor' AND part->>'epochProvenCollectedMinor'=parent_value->>'epochProvenCollectedMinor'
    AND(part->>'startMinor')::numeric>=(parent_value->>'startMinor')::numeric AND(part->>'endMinor')::numeric<=(parent_value->>'endMinor')::numeric) THEN RETURN;END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(used_parts) WITH ORDINALITY first_part(value,n) CROSS JOIN jsonb_array_elements(used_parts) WITH ORDINALITY other_part(value,n)
   WHERE first_part.n<other_part.n AND(first_part.value->>'startMinor')::numeric<(other_part.value->>'endMinor')::numeric AND(other_part.value->>'startMinor')::numeric<(first_part.value->>'endMinor')::numeric) THEN RETURN;END IF;
  needed:=take_minor;
  FOR parent_part IN SELECT actual_part.value FROM jsonb_array_elements(source_parts) actual_part(value) ORDER BY(actual_part.value->>'startMinor')::numeric LOOP
   epoch_start:=(parent_part->>'epochStartMinor')::numeric;epoch_assigned:=(parent_part->>'epochAssignedFeeMinor')::numeric;epoch_proven:=(parent_part->>'epochProvenCollectedMinor')::numeric;base_floor:=floor(root_fee*epoch_start/root_principal);
   free_start:=(parent_part->>'startMinor')::numeric;
   FOR used_part IN SELECT occupied.value FROM(
    SELECT actual_used.value FROM jsonb_array_elements(used_parts) actual_used(value) WHERE(actual_used.value->>'startMinor')::numeric>=free_start AND(actual_used.value->>'endMinor')::numeric<=(parent_part->>'endMinor')::numeric
    UNION ALL SELECT jsonb_build_object('startMinor',parent_part->'endMinor','endMinor',parent_part->'endMinor')
   ) occupied(value) ORDER BY(occupied.value->>'startMinor')::numeric LOOP
    free_end:=(used_part->>'startMinor')::numeric;
    IF free_start<free_end THEN
     available_principal:=available_principal+free_end-free_start;take_end:=free_start+least(needed,free_end-free_start);
     n0:=floor(root_fee*free_start/root_principal)-base_floor;n1:=floor(root_fee*take_end/root_principal)-base_floor;a0:=least(n0,epoch_assigned);a1:=least(n1,epoch_assigned);c0:=least(a0,epoch_proven);c1:=least(a1,epoch_proven);
     selected_nominal:=selected_nominal+n1-n0;selected_retired:=selected_retired+n1-n0-a1+a0;selected_assigned:=selected_assigned+a1-a0;selected_proven:=selected_proven+c1-c0;
     needed:=needed-take_end+free_start;
    END IF;
    free_start:=(used_part->>'endMinor')::numeric;
   END LOOP;
  END LOOP;
  IF needed<>0 THEN RETURN;END IF;
  take_nominal_fee_minor:=selected_nominal;take_retired_fee_minor:=selected_retired;take_assigned_fee_minor:=selected_assigned;take_collected_fee_minor:=selected_proven;take_owed_fee_minor:=selected_assigned-selected_proven;
  remaining_principal_minor:=available_principal-take_minor;remaining_actual_fee_minor:=source_assigned-allocated_assigned-selected_assigned;
  END IF;
 END IF;
 allocated_principal_minor:=allocated_principal;allocated_nominal_fee_minor:=allocated_nominal;allocated_assigned_fee_minor:=allocated_assigned;allocated_retired_fee_minor:=allocated_nominal-allocated_assigned;
 scope:=freeholder_controlled_cash_scope(cash_batch.collection_id);
 WITH physical AS(
  SELECT current_entry.family AS family,current_entry.identity AS identity,current_entry.fingerprint AS fingerprint FROM freeholder_controlled_cash_parent_entries(cash_batch.collection_id) current_entry
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions purpose WHERE purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions purpose WHERE purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
 ),actual_rows AS(SELECT physical.family,physical.identity,min(physical.fingerprint) AS fingerprint FROM physical GROUP BY physical.family,physical.identity)
 SELECT count(*),jsonb_agg(jsonb_build_object('table',actual_rows.family,'id',actual_rows.identity,'fingerprint',actual_rows.fingerprint) ORDER BY actual_rows.family,actual_rows.identity),
  encode(sha256(convert_to(string_agg(actual_rows.family||':'||actual_rows.identity||':'||actual_rows.fingerprint,E'\n' ORDER BY actual_rows.family,actual_rows.identity),'UTF8')),'hex'),
  EXISTS(SELECT 1 FROM physical GROUP BY physical.family,physical.identity HAVING count(DISTINCT physical.fingerprint)<>1) INTO physical_count,physical_rows,evidence_fingerprint,conflicting_physical FROM actual_rows;
 IF physical_count NOT BETWEEN 1 AND 5000 OR evidence_fingerprint IS NULL OR conflicting_physical THEN RETURN;END IF;
 known:=true;RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_atomic_credit_reservation_partition(actual_funding_id uuid,take_minor bigint)
RETURNS TABLE(known boolean,funding_id uuid,root_funding_id uuid,source_payment_id uuid,source_application_id uuid,principal_minor bigint,nominal_fee_minor bigint,
 retired_fee_minor bigint,assigned_fee_minor bigint,collected_fee_minor bigint,owed_fee_minor bigint,segments jsonb,active_reservation_ids uuid[],released_reservation_ids uuid[],funding_partition_fingerprint text,evidence_fingerprint text)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_funding invoice_credit_funding%ROWTYPE;funding_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;root_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;
 actual_root_parent invoice_credit_funding%ROWTYPE;prior_reservation record;current_capacity record;root_principal numeric;root_fee numeric;root_start numeric;root_end numeric;root_assigned numeric;root_proven numeric;
 parent_parts jsonb;used_parts jsonb:='[]'::jsonb;parent_part jsonb;used_part jsonb;part jsonb;free_start numeric;free_end numeric;take_end numeric;needed numeric;base_floor numeric;n0 numeric;n1 numeric;a0 numeric;a1 numeric;c0 numeric;c1 numeric;
 checked_principal numeric:=0;checked_assigned numeric:=0;checked_proven numeric:=0;prior_principal numeric;prior_nominal numeric;prior_retired numeric;prior_assigned numeric;prior_proven numeric;
 selected_principal numeric:=0;selected_nominal numeric:=0;selected_retired numeric:=0;selected_assigned numeric:=0;selected_proven numeric:=0;plan jsonb;reserved_rows bigint;numeric_field text;
BEGIN
 IF take_minor IS NULL OR take_minor<0 OR take_minor>9007199254740991 OR NOT freeholder_credit_atomic_fee_ready() THEN RETURN;END IF;
 SELECT actual_parent.* INTO actual_funding FROM invoice_credit_funding actual_parent WHERE actual_parent.id=actual_funding_id;
 SELECT actual_purpose.* INTO funding_purpose FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.funding_id=actual_funding_id;
 IF actual_funding.id IS NULL OR funding_purpose.funding_id IS NULL OR funding_purpose.protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-partition.v1'
  OR funding_purpose.source_payment_id IS DISTINCT FROM actual_funding.source_payment_id OR funding_purpose.source_application_id IS DISTINCT FROM actual_funding.source_application_id
  OR funding_purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_funding)::text,'UTF8')),'hex') THEN RETURN;END IF;
 SELECT actual_capacity.* INTO current_capacity FROM freeholder_atomic_credit_fee_partition(actual_funding.source_payment_id,actual_funding.source_application_id,0) actual_capacity;
 IF current_capacity.known IS DISTINCT FROM true THEN RETURN;END IF;
 plan:=funding_purpose.economics->'plan';
 IF plan->>'epochKind'='direct' AND plan->>'rootKind'='payment' AND actual_funding.source_application_id IS NULL AND plan->>'rootFundingId' IS NULL THEN root_funding_id:=actual_funding.id;
 ELSIF plan->>'epochKind'='inherited' AND plan->>'rootKind'='legacy_application' AND actual_funding.source_application_id::text=plan->>'rootApplicationId' AND plan->>'rootFundingId' IS NULL THEN root_funding_id:=actual_funding.id;
 ELSIF plan->>'epochKind'='inherited' AND actual_funding.source_application_id IS NOT NULL AND plan->>'rootFundingId' IS NOT NULL THEN root_funding_id:=(plan->>'rootFundingId')::uuid;
 ELSE RETURN;END IF;
 SELECT original_purpose.* INTO root_purpose FROM invoice_credit_funding_atomic_fee_partitions original_purpose WHERE original_purpose.funding_id=root_funding_id;
 SELECT original_parent.* INTO actual_root_parent FROM invoice_credit_funding original_parent WHERE original_parent.id=root_funding_id;
 IF root_purpose.funding_id IS NULL OR root_purpose.economics->'plan'->>'rootFundingId' IS NOT NULL
  OR((root_purpose.economics->'plan'->>'rootKind'='payment' AND root_purpose.source_application_id IS NULL AND actual_root_parent.source_application_id IS NULL)
   OR(root_purpose.economics->'plan'->>'rootKind'='legacy_application' AND root_purpose.source_application_id::text=root_purpose.economics->'plan'->>'rootApplicationId' AND actual_root_parent.source_application_id IS NOT DISTINCT FROM root_purpose.source_application_id)) IS DISTINCT FROM true
  OR root_purpose.source_payment_id IS DISTINCT FROM actual_funding.source_payment_id OR actual_root_parent.source_payment_id IS DISTINCT FROM actual_funding.source_payment_id
  OR root_purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_root_parent)::text,'UTF8')),'hex') THEN RETURN;END IF;
 root_principal:=(root_purpose.economics->'plan'->>'originalRootPrincipalMinor')::numeric;root_fee:=(root_purpose.economics->'plan'->>'originalRootFeeMinor')::numeric;
 root_start:=(root_purpose.economics->'plan'->>'allocatedPrincipalMinor')::numeric;root_end:=(root_purpose.economics->'plan'->>'afterPrincipalMinor')::numeric;
 root_assigned:=actual_root_parent.fee_obligation_minor;root_proven:=actual_root_parent.fee_proven_collected_minor;
 IF root_principal<=0 OR root_principal>9007199254740991 OR root_fee<0 OR root_fee>root_principal OR root_start<0 OR root_start>=root_end OR root_end>root_principal OR root_assigned<0 OR root_proven<0 OR root_proven>root_assigned THEN RETURN;END IF;
 IF root_funding_id=actual_funding.id THEN
  parent_parts:=jsonb_build_array(jsonb_build_object('epochFundingId',root_funding_id,'epochStartMinor',root_start,'epochEndMinor',root_end,'epochAssignedFeeMinor',root_assigned,'epochProvenCollectedMinor',root_proven,
   'startMinor',root_start,'endMinor',root_end,'nominalFeeMinor',floor(root_fee*root_end/root_principal)-floor(root_fee*root_start/root_principal),
   'retiredFeeMinor',floor(root_fee*root_end/root_principal)-floor(root_fee*root_start/root_principal)-root_assigned,'assignedFeeMinor',root_assigned,'provenCollectedMinor',root_proven,'owedFeeMinor',root_assigned-root_proven));
 ELSE parent_parts:=plan->'takeSegments';END IF;
 IF jsonb_typeof(parent_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(parent_parts) NOT BETWEEN 1 AND 5000 THEN RETURN;END IF;
 FOR part IN SELECT actual_part.value FROM jsonb_array_elements(parent_parts) actual_part(value) LOOP
  FOREACH numeric_field IN ARRAY ARRAY['epochStartMinor','epochEndMinor','epochAssignedFeeMinor','epochProvenCollectedMinor','startMinor','endMinor','nominalFeeMinor','retiredFeeMinor','assignedFeeMinor','provenCollectedMinor','owedFeeMinor'] LOOP
   IF NOT freeholder_controlled_bank_minor(part->numeric_field) THEN RETURN;END IF;
  END LOOP;
  free_start:=(part->>'startMinor')::numeric;free_end:=(part->>'endMinor')::numeric;base_floor:=floor(root_fee*root_start/root_principal);
  n0:=floor(root_fee*free_start/root_principal)-base_floor;n1:=floor(root_fee*free_end/root_principal)-base_floor;a0:=least(n0,root_assigned);a1:=least(n1,root_assigned);c0:=least(a0,root_proven);c1:=least(a1,root_proven);
  IF part->>'epochFundingId' IS DISTINCT FROM root_funding_id::text OR(part->>'epochStartMinor')::numeric IS DISTINCT FROM root_start OR(part->>'epochEndMinor')::numeric IS DISTINCT FROM root_end
   OR(part->>'epochAssignedFeeMinor')::numeric IS DISTINCT FROM root_assigned OR(part->>'epochProvenCollectedMinor')::numeric IS DISTINCT FROM root_proven OR free_start<root_start OR free_start>=free_end OR free_end>root_end
   OR part->>'nominalFeeMinor' IS DISTINCT FROM(n1-n0)::text OR part->>'retiredFeeMinor' IS DISTINCT FROM(n1-n0-a1+a0)::text OR part->>'assignedFeeMinor' IS DISTINCT FROM(a1-a0)::text
   OR part->>'provenCollectedMinor' IS DISTINCT FROM(c1-c0)::text OR part->>'owedFeeMinor' IS DISTINCT FROM(a1-a0-c1+c0)::text THEN RETURN;END IF;
  checked_principal:=checked_principal+free_end-free_start;checked_assigned:=checked_assigned+a1-a0;checked_proven:=checked_proven+c1-c0;
 END LOOP;
 IF checked_principal<>actual_funding.amount_minor OR checked_assigned<>actual_funding.fee_obligation_minor OR checked_proven<>actual_funding.fee_proven_collected_minor
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(parent_parts) WITH ORDINALITY first_part(value,n) CROSS JOIN jsonb_array_elements(parent_parts) WITH ORDINALITY other_part(value,n)
   WHERE first_part.n<other_part.n AND(first_part.value->>'startMinor')::numeric<(other_part.value->>'endMinor')::numeric AND(other_part.value->>'startMinor')::numeric<(first_part.value->>'endMinor')::numeric) THEN RETURN;END IF;
 active_reservation_ids:=ARRAY[]::uuid[];released_reservation_ids:=ARRAY[]::uuid[];
 FOR prior_reservation IN SELECT actual_reservation.*,purpose.economics AS purpose_economics,purpose.parent_fingerprint AS purpose_parent_fingerprint,purpose.funding_partition_fingerprint AS purpose_funding_fingerprint,
  purpose.protocol AS purpose_protocol,purpose.root_funding_id AS purpose_root,purpose.source_payment_id AS purpose_payment,purpose.source_application_id AS purpose_source_application,
  EXISTS(SELECT 1 FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=actual_reservation.id) AS actually_applied,
  EXISTS(SELECT 1 FROM invoice_credit_releases actual_release WHERE actual_release.reservation_id=actual_reservation.id) AS actually_released
  FROM invoice_credit_reservations actual_reservation LEFT JOIN invoice_credit_reservation_atomic_fee_partitions purpose ON purpose.reservation_id=actual_reservation.id
  WHERE actual_reservation.funding_id=actual_funding_id ORDER BY actual_reservation.id LOOP
  IF prior_reservation.purpose_economics IS NULL OR prior_reservation.purpose_protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-reservation.v1'
   OR prior_reservation.purpose_root IS DISTINCT FROM root_funding_id OR prior_reservation.purpose_payment IS DISTINCT FROM actual_funding.source_payment_id OR prior_reservation.purpose_source_application IS DISTINCT FROM actual_funding.source_application_id
   OR prior_reservation.purpose_parent_fingerprint IS DISTINCT FROM(SELECT encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') FROM invoice_credit_reservations actual_parent WHERE actual_parent.id=prior_reservation.id)
   OR prior_reservation.purpose_funding_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(funding_purpose)::text,'UTF8')),'hex')
   OR prior_reservation.purpose_economics->>'fundingEconomicRevision' IS DISTINCT FROM plan->>'economicRevision'
   OR prior_reservation.purpose_economics->>'rootEconomicRevision' IS DISTINCT FROM root_purpose.economics->'plan'->>'economicRevision'
   OR prior_reservation.actually_applied AND prior_reservation.actually_released THEN RETURN;END IF;
  prior_principal:=0;prior_nominal:=0;prior_retired:=0;prior_assigned:=0;prior_proven:=0;
  FOR part IN SELECT actual_part.value FROM jsonb_array_elements(prior_reservation.purpose_economics->'segments') actual_part(value) LOOP
   FOREACH numeric_field IN ARRAY ARRAY['epochStartMinor','epochEndMinor','epochAssignedFeeMinor','epochProvenCollectedMinor','startMinor','endMinor','nominalFeeMinor','retiredFeeMinor','assignedFeeMinor','provenCollectedMinor','owedFeeMinor'] LOOP
    IF NOT freeholder_controlled_bank_minor(part->numeric_field) THEN RETURN;END IF;
   END LOOP;
   free_start:=(part->>'startMinor')::numeric;free_end:=(part->>'endMinor')::numeric;base_floor:=floor(root_fee*root_start/root_principal);
   n0:=floor(root_fee*free_start/root_principal)-base_floor;n1:=floor(root_fee*free_end/root_principal)-base_floor;a0:=least(n0,root_assigned);a1:=least(n1,root_assigned);c0:=least(a0,root_proven);c1:=least(a1,root_proven);
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent_parts) actual_parent WHERE free_start>=(actual_parent->>'startMinor')::numeric AND free_end<=(actual_parent->>'endMinor')::numeric)
    OR part->>'epochFundingId' IS DISTINCT FROM root_funding_id::text OR(part->>'epochStartMinor')::numeric IS DISTINCT FROM root_start OR(part->>'epochEndMinor')::numeric IS DISTINCT FROM root_end
    OR(part->>'epochAssignedFeeMinor')::numeric IS DISTINCT FROM root_assigned OR(part->>'epochProvenCollectedMinor')::numeric IS DISTINCT FROM root_proven OR free_start>=free_end
    OR part->>'nominalFeeMinor' IS DISTINCT FROM(n1-n0)::text OR part->>'retiredFeeMinor' IS DISTINCT FROM(n1-n0-a1+a0)::text OR part->>'assignedFeeMinor' IS DISTINCT FROM(a1-a0)::text
    OR part->>'provenCollectedMinor' IS DISTINCT FROM(c1-c0)::text OR part->>'owedFeeMinor' IS DISTINCT FROM(a1-a0-c1+c0)::text THEN RETURN;END IF;
   prior_principal:=prior_principal+free_end-free_start;prior_nominal:=prior_nominal+n1-n0;prior_retired:=prior_retired+n1-n0-a1+a0;prior_assigned:=prior_assigned+a1-a0;prior_proven:=prior_proven+c1-c0;
  END LOOP;
  IF prior_principal<>prior_reservation.amount_minor OR prior_assigned<>prior_reservation.fee_obligation_minor OR prior_proven<>prior_reservation.fee_proven_collected_minor
   OR prior_reservation.purpose_economics->>'nominalFeeMinor' IS DISTINCT FROM prior_nominal::text OR prior_reservation.purpose_economics->>'retiredFeeMinor' IS DISTINCT FROM prior_retired::text THEN RETURN;END IF;
  IF prior_reservation.actually_released THEN released_reservation_ids:=array_append(released_reservation_ids,prior_reservation.id);
  ELSE active_reservation_ids:=array_append(active_reservation_ids,prior_reservation.id);used_parts:=used_parts||(prior_reservation.purpose_economics->'segments');END IF;
  IF cardinality(active_reservation_ids)+cardinality(released_reservation_ids)+jsonb_array_length(parent_parts)+jsonb_array_length(used_parts)>5000 THEN RETURN;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(used_parts) WITH ORDINALITY first_part(value,n) CROSS JOIN jsonb_array_elements(used_parts) WITH ORDINALITY other_part(value,n)
  WHERE first_part.n<other_part.n AND(first_part.value->>'startMinor')::numeric<(other_part.value->>'endMinor')::numeric AND(other_part.value->>'startMinor')::numeric<(first_part.value->>'endMinor')::numeric) THEN RETURN;END IF;
 needed:=take_minor;segments:='[]'::jsonb;
 FOR parent_part IN SELECT actual_part.value FROM jsonb_array_elements(parent_parts) actual_part(value) ORDER BY(actual_part.value->>'startMinor')::numeric LOOP
  free_start:=(parent_part->>'startMinor')::numeric;base_floor:=floor(root_fee*root_start/root_principal);
  FOR used_part IN SELECT occupied.value FROM(
   SELECT actual_used.value FROM jsonb_array_elements(used_parts) actual_used(value) WHERE(actual_used.value->>'startMinor')::numeric>=free_start AND(actual_used.value->>'endMinor')::numeric<=(parent_part->>'endMinor')::numeric
   UNION ALL SELECT jsonb_build_object('startMinor',parent_part->'endMinor','endMinor',parent_part->'endMinor')
  ) occupied(value) ORDER BY(occupied.value->>'startMinor')::numeric LOOP
   free_end:=(used_part->>'startMinor')::numeric;
   IF free_start<free_end AND needed>0 THEN
    take_end:=free_start+least(needed,free_end-free_start);n0:=floor(root_fee*free_start/root_principal)-base_floor;n1:=floor(root_fee*take_end/root_principal)-base_floor;
    a0:=least(n0,root_assigned);a1:=least(n1,root_assigned);c0:=least(a0,root_proven);c1:=least(a1,root_proven);
    segments:=segments||jsonb_build_array(jsonb_build_object('epochFundingId',root_funding_id,'epochStartMinor',root_start,'epochEndMinor',root_end,'epochAssignedFeeMinor',root_assigned,'epochProvenCollectedMinor',root_proven,
     'startMinor',free_start,'endMinor',take_end,'nominalFeeMinor',n1-n0,'retiredFeeMinor',n1-n0-a1+a0,'assignedFeeMinor',a1-a0,'provenCollectedMinor',c1-c0,'owedFeeMinor',a1-a0-c1+c0));
    selected_principal:=selected_principal+take_end-free_start;selected_nominal:=selected_nominal+n1-n0;selected_retired:=selected_retired+n1-n0-a1+a0;selected_assigned:=selected_assigned+a1-a0;selected_proven:=selected_proven+c1-c0;
    needed:=needed-take_end+free_start;
   END IF;free_start:=(used_part->>'endMinor')::numeric;
  END LOOP;
 END LOOP;
 IF needed<>0 THEN RETURN;END IF;
 SELECT count(*) INTO reserved_rows FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.funding_id=actual_funding_id;
 IF reserved_rows+jsonb_array_length(parent_parts)+jsonb_array_length(used_parts)+jsonb_array_length(segments)>5000 THEN RETURN;END IF;
 known:=true;funding_id:=actual_funding.id;source_payment_id:=actual_funding.source_payment_id;source_application_id:=actual_funding.source_application_id;
 principal_minor:=selected_principal;nominal_fee_minor:=selected_nominal;retired_fee_minor:=selected_retired;assigned_fee_minor:=selected_assigned;collected_fee_minor:=selected_proven;owed_fee_minor:=selected_assigned-selected_proven;
 funding_partition_fingerprint:=encode(sha256(convert_to(to_jsonb(funding_purpose)::text,'UTF8')),'hex');evidence_fingerprint:=current_capacity.evidence_fingerprint;RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_credit_atomic_fee_partition() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_parent invoice_credit_funding%ROWTYPE;actual_quote subscription_controlled_quotes%ROWTYPE;accepted subscription_prorations%ROWTYPE;actual_principal subscription_proration_principal%ROWTYPE;
 actual_link controlled_cash_application_links%ROWTYPE;actual_batch controlled_cash_application_batches%ROWTYPE;bank_state record;fee_state record;
 parent_xid text;plan jsonb;birth jsonb;scope jsonb;physical_count bigint;physical_revision text;conflicting_physical boolean;required_resource uuid;required_key text;declared_count bigint;
 original_application invoice_credit_applications%ROWTYPE;original_reservation invoice_credit_reservations%ROWTYPE;inherited_purpose invoice_credit_reservation_atomic_fee_partitions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original credit fee purposes are immutable' USING ERRCODE='23514';END IF;
 IF NOT freeholder_credit_atomic_fee_ready() OR NEW.protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-partition.v1'
  OR NEW.admission_transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'Install and use the genuine current B credit protocol in its actual birth transaction' USING ERRCODE='23514';END IF;
 SELECT original_parent.* INTO actual_parent FROM invoice_credit_funding original_parent WHERE original_parent.id=NEW.funding_id;
 SELECT original_parent.xmin::text INTO parent_xid FROM invoice_credit_funding original_parent WHERE original_parent.id=NEW.funding_id;
 IF actual_parent.id IS NULL OR parent_xid IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)::text
  OR NEW.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex')
  OR NEW.source_payment_id IS DISTINCT FROM actual_parent.source_payment_id OR NEW.source_application_id IS DISTINCT FROM actual_parent.source_application_id
  OR NEW.source_invoice_id IS DISTINCT FROM actual_parent.source_invoice_id OR NEW.credit_note_id IS DISTINCT FROM actual_parent.credit_note_id OR NEW.credit_note_line_id IS DISTINCT FROM actual_parent.credit_note_line_id THEN
  RAISE EXCEPTION 'The purpose must bind its exact actual immutable newborn funding and full PostgreSQL row' USING ERRCODE='23514';END IF;
 plan:=NEW.economics->'plan';birth:=NEW.economics->'birthDeclaration';
 IF jsonb_typeof(plan) IS DISTINCT FROM 'object' OR jsonb_typeof(birth) IS DISTINCT FROM 'object'
  OR plan->>'sourcePaymentId' IS DISTINCT FROM NEW.source_payment_id::text OR plan->>'sourceApplicationId' IS DISTINCT FROM NEW.source_application_id::text
  OR plan->>'takePrincipalMinor' IS DISTINCT FROM actual_parent.amount_minor::text OR plan->>'takeAssignedFeeMinor' IS DISTINCT FROM actual_parent.fee_obligation_minor::text
  OR plan->>'takeProvenCollectedMinor' IS DISTINCT FROM actual_parent.fee_proven_collected_minor::text OR NEW.economics->>'feeEvidenceDigest' IS DISTINCT FROM actual_parent.fee_evidence_digest
  OR birth->>'plannedFundingId' IS DISTINCT FROM NEW.funding_id::text OR birth->>'prorationId' IS DISTINCT FROM actual_parent.proration_id::text
  OR birth->>'creditNoteId' IS DISTINCT FROM NEW.credit_note_id::text OR birth->>'creditNoteLineId' IS DISTINCT FROM NEW.credit_note_line_id::text
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.before_entries) prior_entry(value) WHERE prior_entry.value->>'key' IN('invoice_credit_funding:'||NEW.funding_id::text,'invoice_credit_funding_atomic_fee_partitions:'||NEW.funding_id::text)) THEN
  RAISE EXCEPTION 'The signed exact pre-birth plan cannot contain its own parent or change the actual frozen principal/fee' USING ERRCODE='23514';END IF;
 IF NEW.source_application_id IS NULL THEN
  IF plan->>'epochKind' IS DISTINCT FROM 'direct' OR plan->>'rootKind' IS DISTINCT FROM 'payment' OR plan->>'parentFundingId' IS NOT NULL OR plan->>'rootFundingId' IS NOT NULL OR plan->>'rootEconomicRevision' IS NOT NULL
   OR plan->>'rootApplicationId' IS NOT NULL OR plan->>'legacyApplicationRevision' IS NOT NULL OR plan->>'legacyApplicationProof' IS NOT NULL
   OR plan->>'originalRootPrincipalMinor' IS DISTINCT FROM plan->>'originalPrincipalMinor' OR plan->>'originalRootFeeMinor' IS DISTINCT FROM plan->>'originalFeeMinor'
   OR plan->'sourceSegments' IS DISTINCT FROM '[]'::jsonb OR plan->'takeSegments' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'A direct B root retains the exact original payment coordinate and epoch' USING ERRCODE='23514';END IF;
 ELSE
  SELECT original_row.* INTO original_application FROM invoice_credit_applications original_row WHERE original_row.reservation_id=NEW.source_application_id;
  SELECT original_row.* INTO original_reservation FROM invoice_credit_reservations original_row WHERE original_row.id=NEW.source_application_id;
  SELECT original_row.* INTO inherited_purpose FROM invoice_credit_reservation_atomic_fee_partitions original_row WHERE original_row.reservation_id=NEW.source_application_id;
  IF original_application.reservation_id IS NULL OR original_reservation.id IS NULL OR plan->>'epochKind' IS DISTINCT FROM 'inherited' OR plan->>'parentFundingId' IS DISTINCT FROM original_reservation.funding_id::text THEN
   RAISE EXCEPTION 'An inherited B root requires its actual original application/reservation FK' USING ERRCODE='23514';END IF;
  IF inherited_purpose.reservation_id IS NULL THEN
   IF plan->>'rootKind' IS DISTINCT FROM 'legacy_application' OR plan->>'rootApplicationId' IS DISTINCT FROM NEW.source_application_id::text OR plan->>'rootFundingId' IS NOT NULL OR plan->>'rootEconomicRevision' IS NOT NULL
    OR plan->>'originalRootPrincipalMinor' IS DISTINCT FROM original_reservation.amount_minor::text OR plan->>'originalRootFeeMinor' IS DISTINCT FROM original_application.fee_obligation_minor::text
    OR plan->>'originalPrincipalMinor' IS DISTINCT FROM original_reservation.amount_minor::text OR plan->>'originalFeeMinor' IS DISTINCT FROM original_application.fee_obligation_minor::text
    OR plan->>'acceptedRetiredFeeMinor' IS DISTINCT FROM '0' OR plan->'sourceSegments' IS DISTINCT FROM '[]'::jsonb OR plan->'takeSegments' IS DISTINCT FROM '[]'::jsonb
    OR plan->'legacyApplicationProof'->>'applicationId' IS DISTINCT FROM NEW.source_application_id::text
    OR plan->'legacyApplicationProof'->>'applicationFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(original_application)::text,'UTF8')),'hex')
    OR plan->'legacyApplicationProof'->>'reservationFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(original_reservation)::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'A positively proved old application is its own original epoch, never an invented payment offset' USING ERRCODE='23514';END IF;
  ELSIF plan->>'rootFundingId' IS DISTINCT FROM inherited_purpose.root_funding_id::text OR plan->>'rootEconomicRevision' IS DISTINCT FROM inherited_purpose.economics->>'rootEconomicRevision'
   OR plan->>'rootKind' IS DISTINCT FROM inherited_purpose.economics->>'rootKind' OR plan->>'rootApplicationId' IS DISTINCT FROM inherited_purpose.economics->>'rootApplicationId'
   OR plan->>'legacyApplicationRevision' IS DISTINCT FROM inherited_purpose.economics->>'legacyApplicationRevision'
   OR plan->>'originalRootPrincipalMinor' IS DISTINCT FROM inherited_purpose.economics->>'originalPrincipalMinor' OR plan->>'originalRootFeeMinor' IS DISTINCT FROM inherited_purpose.economics->>'originalFeeMinor'
   OR plan->'sourceSegments' IS DISTINCT FROM inherited_purpose.economics->'segments' THEN
   RAISE EXCEPTION 'A known B application must carry its exact original absolute segments and cannot downgrade to an old epoch' USING ERRCODE='23514';END IF;
 END IF;
 SELECT original_acceptance.* INTO accepted FROM subscription_prorations original_acceptance WHERE original_acceptance.id=actual_parent.proration_id;
 SELECT original_quote.* INTO actual_quote FROM subscription_controlled_quotes original_quote WHERE original_quote.id::text=birth->>'quoteId';
 SELECT original_principal.* INTO actual_principal FROM subscription_proration_principal original_principal WHERE original_principal.id::text=birth->>'sourcePrincipalId';
 IF accepted.id IS NULL OR actual_quote.id IS NULL OR actual_principal.id IS NULL OR actual_quote.kind IS DISTINCT FROM 'proration' OR actual_quote.review IS NULL OR actual_quote.redacted_at IS NOT NULL
  OR actual_quote.planned_proration_id IS DISTINCT FROM accepted.id OR actual_quote.quote_digest IS DISTINCT FROM accepted.accepted_quote_digest
  OR actual_quote.previous_terms_id IS DISTINCT FROM accepted.previous_terms_id OR actual_quote.profile_id IS DISTINCT FROM accepted.profile_id OR actual_quote.profile_version IS DISTINCT FROM accepted.profile_version
  OR accepted.original_invoice_id IS DISTINCT FROM NEW.source_invoice_id OR accepted.credit_note_id IS DISTINCT FROM NEW.credit_note_id
  OR actual_principal.proration_id IS DISTINCT FROM accepted.id OR actual_principal.source_payment_id IS DISTINCT FROM NEW.source_payment_id OR actual_principal.source_application_id IS DISTINCT FROM NEW.source_application_id
  OR actual_principal.amount_minor IS DISTINCT FROM actual_parent.amount_minor OR actual_principal.fee_evidence_digest IS DISTINCT FROM actual_parent.fee_evidence_digest
  OR actual_parent.original_evidence_digest IS DISTINCT FROM accepted.source_revision OR actual_principal.original_evidence_digest IS DISTINCT FROM accepted.source_revision
  OR birth->>'quoteFingerprint' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_quote)::text,'UTF8')),'hex')
  OR birth->>'declarationDigest' IS DISTINCT FROM actual_quote.review->'atomicCreditFeeDeclaration'->>'digest'
  OR birth->>'declarationAuthentication' IS DISTINCT FROM actual_quote.review->'atomicCreditFeeDeclaration'->>'authentication' THEN
  RAISE EXCEPTION 'The actual quote, acceptance, issued principal and private declaration must identify this exact funding birth' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO declared_count FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
  WHERE declared_source.value->>'fundingId'=NEW.funding_id::text AND declared_source.value->>'sourcePaymentId'=NEW.source_payment_id::text
   AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM NEW.source_application_id::text AND declared_source.value->>'amountMinor'=actual_parent.amount_minor::text AND declared_source.value->>'feeEvidenceDigest'=actual_parent.fee_evidence_digest;
 IF declared_count<>1 OR NOT EXISTS(SELECT 1 FROM credit_note_lines original_line WHERE original_line.id=NEW.credit_note_line_id AND original_line.credit_note_id=NEW.credit_note_id AND original_line.invoice_line_id=accepted.original_invoice_line_id) THEN
  RAISE EXCEPTION 'Exactly one original planned source and actual issued note line must own this purpose' USING ERRCODE='23514';END IF;
 SELECT original_link.* INTO actual_link FROM controlled_cash_application_links original_link WHERE original_link.payment_id=NEW.source_payment_id;
 SELECT original_batch.* INTO actual_batch FROM controlled_cash_application_batches original_batch WHERE original_batch.id=actual_link.batch_id;
 IF actual_batch.id IS NULL OR actual_link.receipt_id IS DISTINCT FROM NEW.original_charge_receipt_id OR plan->>'sourceCollectionId' IS DISTINCT FROM actual_batch.collection_id::text OR plan->>'sourceResourceId' IS DISTINCT FROM actual_batch.resource_id::text THEN
  RAISE EXCEPTION 'The original controlled receipt and actual source resource must retain their real canonical ownership' USING ERRCODE='23514';END IF;
 scope:=freeholder_controlled_cash_scope(actual_batch.collection_id);
 FOR required_resource IN SELECT actual_resource_id FROM unnest(freeholder_controlled_cash_scope_ids(scope,'resources')) actual_resource_id LOOP
  PERFORM freeholder_controlled_cash_require_prefix(required_resource);
 END LOOP;
 FOR required_key IN SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'payments')) actual_id
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'notes')) actual_id
  UNION SELECT 'merchant-return-read:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'inspections')) actual_id
  UNION SELECT 'merchant-fee-invocation:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'payments')) actual_id
  UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(scope->'namespaces') actual_namespace LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'The complete original resource, canonical and callback prefix must already be held' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT current_bank.* INTO bank_state FROM freeholder_controlled_receipt_bank_observation(actual_batch.collection_id,actual_link.receipt_id) current_bank;
 SELECT current_fee.* INTO fee_state FROM freeholder_controlled_atomic_refund_fee_state(NEW.source_payment_id) current_fee;
 IF bank_state.actual_inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR bank_state.actual_observation_id IS DISTINCT FROM NEW.bank_observation_id
  OR bank_state.bank_fingerprint IS DISTINCT FROM NEW.economics->>'bankNamespaceRevision' OR fee_state.known IS DISTINCT FROM true OR fee_state.reconciled IS DISTINCT FROM true
  OR fee_state.inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR fee_state.observation_id IS DISTINCT FROM NEW.bank_observation_id OR fee_state.bank_namespace_revision IS DISTINCT FROM bank_state.bank_fingerprint THEN
  RAISE EXCEPTION 'A purpose needs actual independently current original bank/retired fee evidence, never a planned collection' USING ERRCODE='23514';END IF;
 IF plan->>'originalPaymentFeeMinor' IS DISTINCT FROM freeholder_original_payment_fee(NEW.source_payment_id)::text
  OR(plan->>'originalResourceRetiredFeeMinor')::numeric IS DISTINCT FROM freeholder_original_payment_fee(NEW.source_payment_id)-fee_state.actual_retained_fee_minor THEN
  RAISE EXCEPTION 'The whole actual original Fi/current retired capacity remains distinct from each inherited economic epoch' USING ERRCODE='23514';END IF;
 WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(actual_batch.collection_id) current_entry
   WHERE NOT(current_entry.family='invoice_credit_funding' AND current_entry.identity=NEW.funding_id::text)
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
 ),actual_rows AS(SELECT physical.family,physical.identity,min(physical.fingerprint) AS fingerprint FROM physical GROUP BY physical.family,physical.identity)
 SELECT count(*),encode(sha256(convert_to(string_agg(actual_rows.family||':'||actual_rows.identity||':'||actual_rows.fingerprint,E'\n' ORDER BY actual_rows.family,actual_rows.identity),'UTF8')),'hex'),
  EXISTS(SELECT 1 FROM physical GROUP BY physical.family,physical.identity HAVING count(DISTINCT physical.fingerprint)<>1) INTO physical_count,physical_revision,conflicting_physical FROM actual_rows;
 IF physical_count NOT BETWEEN 1 AND 5000 OR conflicting_physical OR physical_revision IS DISTINCT FROM NEW.economics->>'postgresSourceRevision' THEN
  RAISE EXCEPTION 'Only this exact actual newborn parent may be reconstructed; every other current physical source/callback remains unchanged' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_credit_atomic_reservation() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_parent invoice_credit_reservations%ROWTYPE;actual_funding invoice_credit_funding%ROWTYPE;funding_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;root_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;
 parent_xid text;economics jsonb;plan jsonb;scope jsonb;physical_count bigint;physical_revision text;conflicting_physical boolean;source_capacity record;required_resource uuid;required_key text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original reservation fee intervals are immutable' USING ERRCODE='23514';END IF;
 IF NOT freeholder_credit_atomic_fee_ready() OR NEW.protocol IS DISTINCT FROM 'freeholder.atomic-credit-fee-reservation.v1'
  OR NEW.admission_transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'Use the genuine installed original reservation protocol in its actual birth transaction' USING ERRCODE='23514';END IF;
 SELECT original_parent.* INTO actual_parent FROM invoice_credit_reservations original_parent WHERE original_parent.id=NEW.reservation_id;
 SELECT original_parent.xmin::text INTO parent_xid FROM invoice_credit_reservations original_parent WHERE original_parent.id=NEW.reservation_id;
 SELECT original_funding.* INTO actual_funding FROM invoice_credit_funding original_funding WHERE original_funding.id=actual_parent.funding_id;
 SELECT original_purpose.* INTO funding_purpose FROM invoice_credit_funding_atomic_fee_partitions original_purpose WHERE original_purpose.funding_id=actual_funding.id;
 SELECT original_root.* INTO root_purpose FROM invoice_credit_funding_atomic_fee_partitions original_root WHERE original_root.funding_id=NEW.root_funding_id;
 IF actual_parent.id IS NULL OR actual_funding.id IS NULL OR funding_purpose.funding_id IS NULL OR root_purpose.funding_id IS NULL
  OR parent_xid IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)::text
  OR NEW.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex')
  OR funding_purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_funding)::text,'UTF8')),'hex')
  OR NEW.funding_partition_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(funding_purpose)::text,'UTF8')),'hex')
  OR actual_parent.funding_id IS DISTINCT FROM NEW.funding_id OR actual_funding.source_payment_id IS DISTINCT FROM NEW.source_payment_id OR actual_funding.source_application_id IS DISTINCT FROM NEW.source_application_id
  OR root_purpose.source_payment_id IS DISTINCT FROM NEW.source_payment_id OR root_purpose.economics->'plan'->>'rootFundingId' IS NOT NULL THEN
  RAISE EXCEPTION 'The actual newborn reservation, original funding and immutable original root must be exact' USING ERRCODE='23514';END IF;
 economics:=NEW.economics;plan:=funding_purpose.economics->'plan';
 IF jsonb_typeof(economics) IS DISTINCT FROM 'object' OR economics->>'fundingId' IS DISTINCT FROM actual_funding.id::text OR economics->>'rootFundingId' IS DISTINCT FROM NEW.root_funding_id::text
  OR economics->>'sourcePaymentId' IS DISTINCT FROM NEW.source_payment_id::text OR economics->>'sourceApplicationId' IS DISTINCT FROM NEW.source_application_id::text
  OR economics->>'fundingEconomicRevision' IS DISTINCT FROM plan->>'economicRevision' OR economics->>'rootEconomicRevision' IS DISTINCT FROM root_purpose.economics->'plan'->>'economicRevision'
  OR economics->>'rootKind' IS DISTINCT FROM root_purpose.economics->'plan'->>'rootKind' OR economics->>'rootApplicationId' IS DISTINCT FROM root_purpose.economics->'plan'->>'rootApplicationId'
  OR economics->>'legacyApplicationRevision' IS DISTINCT FROM root_purpose.economics->'plan'->>'legacyApplicationRevision'
  OR economics->>'originalPrincipalMinor' IS DISTINCT FROM root_purpose.economics->'plan'->>'originalRootPrincipalMinor' OR economics->>'originalFeeMinor' IS DISTINCT FROM root_purpose.economics->'plan'->>'originalRootFeeMinor'
  OR economics->>'amountMinor' IS DISTINCT FROM actual_parent.amount_minor::text OR economics->>'assignedFeeMinor' IS DISTINCT FROM actual_parent.fee_obligation_minor::text OR economics->>'provenCollectedMinor' IS DISTINCT FROM actual_parent.fee_proven_collected_minor::text
  OR actual_parent.fee_collection_state IS DISTINCT FROM actual_funding.fee_collection_state OR actual_parent.fee_unexpected IS DISTINCT FROM actual_funding.fee_unexpected
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.before_entries) prior_entry(value) WHERE prior_entry.value->>'key' IN('invoice_credit_reservations:'||NEW.reservation_id::text,'invoice_credit_reservation_atomic_fee_partitions:'||NEW.reservation_id::text)) THEN
  RAISE EXCEPTION 'Original absolute root/caps and actual reservation principal/fee cannot be rebased at birth' USING ERRCODE='23514';END IF;
 SELECT current_capacity.* INTO source_capacity FROM freeholder_atomic_credit_fee_partition(NEW.source_payment_id,NEW.source_application_id,0) current_capacity;
 IF source_capacity.known IS DISTINCT FROM true THEN RAISE EXCEPTION 'Every original global loan, current bank and retired fee must remain independently accounted' USING ERRCODE='23514';END IF;
 scope:=freeholder_controlled_cash_scope((plan->>'sourceCollectionId')::uuid);
 FOR required_resource IN SELECT actual_resource_id FROM unnest(freeholder_controlled_cash_scope_ids(scope,'resources')) actual_resource_id LOOP PERFORM freeholder_controlled_cash_require_prefix(required_resource);END LOOP;
 FOR required_key IN SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'payments')) actual_id
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'notes')) actual_id
  UNION SELECT 'merchant-return-read:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'inspections')) actual_id
  UNION SELECT 'merchant-fee-invocation:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(scope,'payments')) actual_id
  UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(scope->'namespaces') actual_namespace LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'The complete original source/canonical/callback prefix must already be held before reservation birth' USING ERRCODE='23514';END IF;
 END LOOP;
 WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries((plan->>'sourceCollectionId')::uuid) current_entry
   WHERE NOT(current_entry.family='invoice_credit_reservations' AND current_entry.identity=NEW.reservation_id::text)
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(scope,'payments'))
 ),actual_rows AS(SELECT physical.family,physical.identity,min(physical.fingerprint) AS fingerprint FROM physical GROUP BY physical.family,physical.identity)
 SELECT count(*),encode(sha256(convert_to(string_agg(actual_rows.family||':'||actual_rows.identity||':'||actual_rows.fingerprint,E'\n' ORDER BY actual_rows.family,actual_rows.identity),'UTF8')),'hex'),
  EXISTS(SELECT 1 FROM physical GROUP BY physical.family,physical.identity HAVING count(DISTINCT physical.fingerprint)<>1) INTO physical_count,physical_revision,conflicting_physical FROM actual_rows;
 IF physical_count NOT BETWEEN 1 AND 5000 OR conflicting_physical OR physical_revision IS DISTINCT FROM economics->>'postgresSourceRevision' THEN
  RAISE EXCEPTION 'Only the exact newborn reservation may be reconstructed; every other current physical row stays full' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_atomic_fee_birth_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;actual_funding invoice_credit_funding%ROWTYPE;actual_quote subscription_controlled_quotes%ROWTYPE;accepted subscription_prorations%ROWTYPE;
 source_capacity record;physical_row record;actual_invoice invoices%ROWTYPE;actual_subscription subscriptions%ROWTYPE;current_scope jsonb;physical_count bigint;conflicting_physical boolean;
 before_entry jsonb;projection jsonb;normalized jsonb:='[]'::jsonb;normalized_row jsonb;normalized_hash text;final_revision text;source_collection uuid;owner_quote uuid;owner_proration uuid;owner_subscription uuid;target_invoice uuid;
 is_declared boolean;requires_atomic boolean;allowed_birth boolean;application_delta numeric;target_credited numeric;required_resource uuid;
BEGIN
 SELECT original_funding.* INTO actual_funding FROM invoice_credit_funding original_funding WHERE original_funding.id=NEW.id;
 SELECT original_acceptance.* INTO accepted FROM subscription_prorations original_acceptance WHERE original_acceptance.id=actual_funding.proration_id;
 SELECT original_quote.* INTO actual_quote FROM subscription_controlled_quotes original_quote WHERE original_quote.planned_proration_id=accepted.id AND original_quote.quote_digest=accepted.accepted_quote_digest;
 SELECT actual_purpose.* INTO purpose FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.funding_id=NEW.id;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
  WHERE declared_source.value->>'fundingId'=NEW.id::text OR(declared_source.value->>'sourcePaymentId'=NEW.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM NEW.source_application_id::text)) INTO is_declared;
 SELECT EXISTS(SELECT 1 FROM payments original_payment JOIN invoices original_invoice ON original_invoice.id=original_payment.invoice_id
  JOIN controlled_cash_application_links original_link ON original_link.payment_id=original_payment.id
  WHERE original_payment.id=NEW.source_payment_id AND original_invoice.refunded_minor>0
   AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=original_invoice.id AND atomic_epoch.protocol='controlled_cash_atomic.v1')) INTO requires_atomic;
 IF purpose.funding_id IS NULL THEN
  IF is_declared OR requires_atomic THEN RAISE EXCEPTION 'Every genuine atomic-retired funding requires its actual same-transaction purpose, even when the legacy scalar fee coincides' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NOT freeholder_credit_atomic_fee_ready() OR purpose.admission_transaction_id IS DISTINCT FROM pg_current_xact_id()::text OR actual_quote.id IS NULL OR accepted.id IS NULL
  OR NOT is_declared OR purpose.economics->'birthDeclaration'->>'quoteId' IS DISTINCT FROM actual_quote.id::text
  OR purpose.economics->'birthDeclaration'->>'prorationId' IS DISTINCT FROM accepted.id::text
  OR purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_funding)::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'The complete final B funding must retain its genuine exact quote, actual parent and birth transaction' USING ERRCODE='23514';END IF;
 owner_quote:=actual_quote.id;owner_proration:=accepted.id;owner_subscription:=accepted.subscription_id;target_invoice:=accepted.debit_invoice_id;source_collection:=(purpose.economics->'plan'->>'sourceCollectionId')::uuid;
 SELECT current_capacity.* INTO source_capacity FROM freeholder_atomic_credit_fee_partition(purpose.source_payment_id,purpose.source_application_id,0) current_capacity;
 IF source_capacity.known IS DISTINCT FROM true OR source_capacity.bank_inspection_id IS DISTINCT FROM purpose.bank_inspection_id OR source_capacity.bank_observation_id IS DISTINCT FROM purpose.bank_observation_id
  OR source_capacity.bank_namespace_revision IS DISTINCT FROM purpose.economics->>'bankNamespaceRevision' THEN
  RAISE EXCEPTION 'Final original fee/principal loans and current bank/caller evidence must remain independently complete' USING ERRCODE='23514';END IF;
 current_scope:=freeholder_controlled_cash_scope(source_collection);
 FOR required_resource IN SELECT actual_resource_id FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'resources')) actual_resource_id LOOP PERFORM freeholder_controlled_cash_require_prefix(required_resource);END LOOP;
 WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(source_collection) current_entry
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
 ) SELECT count(*),EXISTS(SELECT 1 FROM physical GROUP BY physical.family,physical.identity HAVING count(DISTINCT physical.fingerprint)<>1) INTO physical_count,conflicting_physical FROM(SELECT DISTINCT physical.family,physical.identity FROM physical) actual_identities;
 IF physical_count NOT BETWEEN 1 AND 5000 OR conflicting_physical THEN RAISE EXCEPTION 'Retain the whole bounded final physical namespace without hash-domain collisions' USING ERRCODE='23514';END IF;
 FOR physical_row IN WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(source_collection) current_entry
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
 ) SELECT physical.family,physical.identity,min(physical.fingerprint) AS fingerprint FROM physical GROUP BY physical.family,physical.identity ORDER BY physical.family,physical.identity LOOP
  SELECT original_entry.value INTO before_entry FROM jsonb_array_elements(purpose.before_entries) original_entry(value) WHERE original_entry.value->>'key'=physical_row.family||':'||physical_row.identity;
  allowed_birth:=false;
  IF before_entry IS NULL THEN
   IF physical_row.family IN('invoice_credit_funding','invoice_credit_funding_atomic_fee_partitions') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_funding original_funding LEFT JOIN invoice_credit_funding_atomic_fee_partitions original_purpose ON original_purpose.funding_id=original_funding.id
     WHERE original_funding.id::text=physical_row.identity AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_funding.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND EXISTS(SELECT 1 FROM subscription_proration_principal original_principal WHERE original_principal.proration_id=owner_proration AND original_principal.source_payment_id=original_funding.source_payment_id
       AND original_principal.source_application_id IS NOT DISTINCT FROM original_funding.source_application_id AND original_principal.amount_minor=original_funding.amount_minor AND original_principal.fee_obligation_minor=original_funding.fee_obligation_minor
       AND original_principal.fee_proven_collected_minor=original_funding.fee_proven_collected_minor AND original_principal.fee_evidence_digest=original_funding.fee_evidence_digest AND original_principal.original_evidence_digest=original_funding.original_evidence_digest)
      AND(original_purpose.funding_id IS NOT NULL AND original_purpose.admission_transaction_id=pg_current_xact_id()::text AND original_purpose.economics->'birthDeclaration'->>'quoteId'=owner_quote::text
        AND original_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(original_funding)::text,'UTF8')),'hex')
       OR physical_row.family='invoice_credit_funding' AND original_purpose.funding_id IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
        WHERE declared_source.value->>'fundingId'=original_funding.id::text OR(declared_source.value->>'sourcePaymentId'=original_funding.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM original_funding.source_application_id::text)))) INTO allowed_birth;
   ELSIF physical_row.family IN('invoice_credit_reservations','invoice_credit_reservation_atomic_fee_partitions') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_reservations original_reservation LEFT JOIN invoice_credit_reservation_atomic_fee_partitions original_purpose ON original_purpose.reservation_id=original_reservation.id
     JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
     LEFT JOIN invoice_credit_funding_atomic_fee_partitions original_funding_purpose ON original_funding_purpose.funding_id=original_funding.id
     WHERE original_reservation.id::text=physical_row.identity AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_reservation.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND(original_purpose.reservation_id IS NOT NULL AND original_purpose.admission_transaction_id=pg_current_xact_id()::text AND original_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(original_reservation)::text,'UTF8')),'hex')
       OR physical_row.family='invoice_credit_reservations' AND original_purpose.reservation_id IS NULL AND original_funding_purpose.funding_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
         WHERE declared_source.value->>'fundingId'=original_funding.id::text OR(declared_source.value->>'sourcePaymentId'=original_funding.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM original_funding.source_application_id::text)))) INTO allowed_birth;
   ELSIF physical_row.family IN('invoice_credit_applications','agreement_fee_credit_assignments') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_applications original_application JOIN invoice_credit_reservations original_reservation ON original_reservation.id=original_application.reservation_id
     JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
     WHERE original_application.reservation_id::text=physical_row.identity AND original_application.invoice_id=target_invoice AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_application.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND original_application.fee_obligation_minor=original_reservation.fee_obligation_minor AND original_application.fee_proven_collected_minor=original_reservation.fee_proven_collected_minor
      AND NOT EXISTS(SELECT 1 FROM invoice_credit_releases actual_release WHERE actual_release.reservation_id=original_reservation.id)
      AND(physical_row.family='invoice_credit_applications' OR EXISTS(SELECT 1 FROM agreement_fee_credit_assignments actual_assignment WHERE actual_assignment.application_id=original_application.reservation_id AND actual_assignment.invoice_id=target_invoice
       AND actual_assignment.amount_minor=original_reservation.amount_minor AND actual_assignment.fee_obligation_minor=original_application.fee_obligation_minor AND actual_assignment.proven_collected_minor=original_application.fee_proven_collected_minor
       AND actual_assignment.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text))) INTO allowed_birth;
   ELSIF physical_row.family='subscription_proration_credit_uses' THEN
    SELECT EXISTS(SELECT 1 FROM subscription_proration_credit_uses actual_use WHERE actual_use.id::text=physical_row.identity AND actual_use.proration_id=owner_proration AND actual_use.credit_note_id=accepted.credit_note_id
     AND actual_use.amount_minor::text=actual_quote.review->>'creditAppliedMinor' AND actual_use.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text) INTO allowed_birth;
   ELSIF physical_row.family='agreement_fee_duties' THEN
    SELECT EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id::text=physical_row.identity AND actual_duty.invoice_id=target_invoice AND actual_duty.acceptance_id=owner_proration
     AND actual_duty.accepted_quote_digest=actual_quote.quote_digest AND actual_duty.merchant_profile_id=actual_quote.profile_id AND actual_duty.profile_version=actual_quote.profile_version
     AND actual_duty.target_fee_minor=accepted.debit_fee_obligation_minor AND actual_duty.carried_fee_minor=accepted.applied_fee_obligation_minor
     AND actual_duty.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text) INTO allowed_birth;
   ELSIF physical_row.family IN('subscription_controlled_collections','subscription_controlled_components') THEN
    SELECT EXISTS(SELECT 1 FROM subscription_controlled_collections actual_collection WHERE actual_collection.id=actual_quote.planned_collection_id AND actual_collection.quote_id=owner_quote AND actual_collection.proration_id=owner_proration
     AND actual_collection.invoice_id IS NOT DISTINCT FROM target_invoice AND actual_collection.credit_note_id IS NOT DISTINCT FROM accepted.credit_note_id
     AND actual_collection.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text AND freeholder_controlled_collection_valid(actual_collection.id)
     AND(physical_row.family='subscription_controlled_collections' AND actual_collection.id::text=physical_row.identity
      OR physical_row.family='subscription_controlled_components' AND EXISTS(SELECT 1 FROM subscription_controlled_components actual_component WHERE actual_component.id::text=physical_row.identity AND actual_component.collection_id=actual_collection.id
       AND actual_component.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text))) INTO allowed_birth;
   END IF;
   IF allowed_birth THEN CONTINUE;END IF;
  END IF;
  normalized_hash:=physical_row.fingerprint;
  IF physical_row.family='invoices' AND physical_row.identity=target_invoice::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeInvoiceProjections') original_projection(value) WHERE original_projection.value->>'invoiceId'=physical_row.identity;
   SELECT original_invoice.* INTO actual_invoice FROM invoices original_invoice WHERE original_invoice.id=target_invoice;
   SELECT coalesce(sum(original_reservation.amount_minor),0) INTO application_delta FROM invoice_credit_applications original_application JOIN invoice_credit_reservations original_reservation ON original_reservation.id=original_application.reservation_id JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
    WHERE original_application.invoice_id=target_invoice AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
     AND original_application.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(purpose.before_entries) prior_application(value) WHERE prior_application.value->>'key'='invoice_credit_applications:'||original_application.reservation_id::text);
   target_credited:=(projection->>'creditedMinor')::numeric+application_delta;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR application_delta<=0 OR actual_invoice.credited_minor IS DISTINCT FROM target_credited
    OR actual_invoice.status IS DISTINCT FROM(CASE WHEN actual_invoice.paid_minor+actual_invoice.credited_minor>=actual_invoice.total_minor-actual_invoice.refunded_minor THEN 'paid' ELSE 'partially_paid' END) THEN
    RAISE EXCEPTION 'Only the exact actual original noncash application may change its canonical invoice projection' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(actual_invoice)||jsonb_build_object('credited_minor',(projection->>'creditedMinor')::bigint,'status',projection->>'status','paid_at',(projection->>'paidAt')::timestamptz,'updated_at',(projection->>'updatedAt')::timestamptz);
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted invoice field changed during credit application' USING ERRCODE='23514';END IF;
  ELSIF physical_row.family='subscription_prorations' AND physical_row.identity=owner_proration::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeProrationProjections') original_projection(value) WHERE original_projection.value->>'prorationId'=physical_row.identity;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR projection->>'state' IS DISTINCT FROM 'accepted' OR projection->>'originalJobId' IS NOT NULL OR projection->>'jobClaimDigest' IS NOT NULL OR projection->>'originalTask' IS NOT NULL
    OR accepted.original_job_id IS NULL OR accepted.original_task->>'prorationId' IS DISTINCT FROM accepted.id::text OR accepted.original_task->>'subscriptionId' IS DISTINCT FROM accepted.subscription_id::text
    OR accepted.original_task->>'originalJobId' IS DISTINCT FROM accepted.original_job_id::text OR accepted.original_task->>'acceptedQuoteDigest' IS DISTINCT FROM accepted.accepted_quote_digest
    OR NOT EXISTS(SELECT 1 FROM job_idempotency_keys original_claim JOIN pgboss.job original_job ON original_job.id=original_claim.job_id AND original_job.name=original_claim.job_name
     WHERE original_claim.job_id=accepted.original_job_id AND original_claim.job_name='subscriptions.applyGrossProration' AND original_claim.payload_hash=accepted.job_claim_digest AND original_job.data=accepted.original_task)
    OR accepted.state IS DISTINCT FROM(CASE WHEN target_invoice IS NULL OR EXISTS(SELECT 1 FROM invoices actual_target WHERE actual_target.id=target_invoice AND actual_target.status='paid' AND actual_target.paid_minor+actual_target.credited_minor>=actual_target.total_minor-actual_target.refunded_minor) THEN 'awaiting_effective' ELSE 'awaiting_payment' END) THEN
    RAISE EXCEPTION 'Only the genuine shared original enqueue/task/state continuation can change this accepted proration' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(accepted)||jsonb_build_object('original_job_id',projection->'originalJobId','job_claim_digest',projection->'jobClaimDigest','original_task',projection->'originalTask','state',projection->'state');
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted accepted proration field changed' USING ERRCODE='23514';END IF;
  ELSIF physical_row.family='subscriptions' AND physical_row.identity=owner_subscription::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeSubscriptionProjections') original_projection(value) WHERE original_projection.value->>'subscriptionId'=physical_row.identity;
   SELECT original_parent.* INTO actual_subscription FROM subscriptions original_parent WHERE original_parent.id=owner_subscription;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR projection->>'pendingPlanId' IS NOT NULL OR actual_subscription.pending_plan_id IS DISTINCT FROM accepted.plan_id THEN
    RAISE EXCEPTION 'Only the exact newly accepted pending plan may continue this real parent' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(actual_subscription)||jsonb_build_object('pending_plan_id',projection->'pendingPlanId','updated_at',(projection->>'updatedAt')::timestamptz);
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted original subscription field changed' USING ERRCODE='23514';END IF;
  END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('table',physical_row.family,'id',physical_row.identity,'fingerprint',normalized_hash));
 END LOOP;
 SELECT encode(sha256(convert_to(string_agg(actual_entry.value->>'table'||':'||(actual_entry.value->>'id')||':'||(actual_entry.value->>'fingerprint'),E'\n' ORDER BY actual_entry.value->>'table',actual_entry.value->>'id'),'UTF8')),'hex') INTO final_revision FROM jsonb_array_elements(normalized) actual_entry(value);
 IF final_revision IS DISTINCT FROM purpose.economics->>'postgresSourceRevision' THEN RAISE EXCEPTION 'Final actual current physical history differs beyond the exact authenticated canonical credit delta' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_atomic_reservation_birth_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE purpose invoice_credit_reservation_atomic_fee_partitions%ROWTYPE;funding_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;actual_parent invoice_credit_reservations%ROWTYPE;actual_funding invoice_credit_funding%ROWTYPE;actual_quote subscription_controlled_quotes%ROWTYPE;accepted subscription_prorations%ROWTYPE;
 source_capacity record;physical_row record;actual_invoice invoices%ROWTYPE;actual_subscription subscriptions%ROWTYPE;current_scope jsonb;physical_count bigint;conflicting_physical boolean;
 before_entry jsonb;projection jsonb;normalized jsonb:='[]'::jsonb;normalized_row jsonb;normalized_hash text;final_revision text;source_collection uuid;owner_quote uuid;owner_proration uuid;owner_subscription uuid;target_invoice uuid;
 is_declared boolean;requires_atomic boolean;allowed_birth boolean;application_delta numeric;target_credited numeric;required_resource uuid;
BEGIN
 SELECT original_parent.* INTO actual_parent FROM invoice_credit_reservations original_parent WHERE original_parent.id=NEW.id;
 SELECT original_funding.* INTO actual_funding FROM invoice_credit_funding original_funding WHERE original_funding.id=actual_parent.funding_id;
 SELECT original_acceptance.* INTO accepted FROM subscription_prorations original_acceptance WHERE original_acceptance.id=actual_funding.proration_id;
 SELECT original_quote.* INTO actual_quote FROM subscription_controlled_quotes original_quote WHERE original_quote.planned_proration_id=accepted.id AND original_quote.quote_digest=accepted.accepted_quote_digest;
 SELECT actual_purpose.* INTO purpose FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.reservation_id=NEW.id;
 SELECT actual_purpose.* INTO funding_purpose FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.funding_id=actual_funding.id;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
  WHERE declared_source.value->>'fundingId'=actual_funding.id::text OR(declared_source.value->>'sourcePaymentId'=actual_funding.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM actual_funding.source_application_id::text)) INTO is_declared;
 IF purpose.reservation_id IS NULL THEN
  IF funding_purpose.funding_id IS NOT NULL OR is_declared THEN RAISE EXCEPTION 'Every actual B reservation requires its same-transaction immutable original interval receipt, even a numeric coincidence' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NOT freeholder_credit_atomic_fee_ready() OR purpose.admission_transaction_id IS DISTINCT FROM pg_current_xact_id()::text OR actual_quote.id IS NULL OR accepted.id IS NULL
  OR funding_purpose.funding_id IS NULL OR NOT is_declared OR purpose.funding_id IS DISTINCT FROM actual_funding.id
  OR funding_purpose.economics->'birthDeclaration'->>'quoteId' IS DISTINCT FROM actual_quote.id::text OR funding_purpose.economics->'birthDeclaration'->>'prorationId' IS DISTINCT FROM accepted.id::text
  OR purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex')
  OR funding_purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_funding)::text,'UTF8')),'hex')
  OR purpose.funding_partition_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(funding_purpose)::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'The complete final B reservation must retain its exact actual parent, original root and birth transaction' USING ERRCODE='23514';END IF;
 owner_quote:=actual_quote.id;owner_proration:=accepted.id;owner_subscription:=accepted.subscription_id;target_invoice:=accepted.debit_invoice_id;source_collection:=(funding_purpose.economics->'plan'->>'sourceCollectionId')::uuid;
 SELECT current_capacity.* INTO source_capacity FROM freeholder_atomic_credit_fee_partition(purpose.source_payment_id,purpose.source_application_id,0) current_capacity;
 IF source_capacity.known IS DISTINCT FROM true THEN RAISE EXCEPTION 'Every current original loan, bank/fee/refund/caller and retained source must remain complete' USING ERRCODE='23514';END IF;
 SELECT current_interval.* INTO source_capacity FROM freeholder_atomic_credit_reservation_partition(actual_funding.id,0) current_interval;
 IF source_capacity.known IS DISTINCT FROM true OR source_capacity.root_funding_id IS DISTINCT FROM purpose.root_funding_id
  OR source_capacity.funding_partition_fingerprint IS DISTINCT FROM purpose.funding_partition_fingerprint THEN
  RAISE EXCEPTION 'Every actual final original interval, application and release must conserve its immutable original root/caps' USING ERRCODE='23514';END IF;
 current_scope:=freeholder_controlled_cash_scope(source_collection);
 FOR required_resource IN SELECT actual_resource_id FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'resources')) actual_resource_id LOOP PERFORM freeholder_controlled_cash_require_prefix(required_resource);END LOOP;
 WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(source_collection) current_entry
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
 ) SELECT count(*),EXISTS(SELECT 1 FROM physical GROUP BY physical.family,physical.identity HAVING count(DISTINCT physical.fingerprint)<>1) INTO physical_count,conflicting_physical FROM(SELECT DISTINCT physical.family,physical.identity FROM physical) actual_identities;
 IF physical_count NOT BETWEEN 1 AND 5000 OR conflicting_physical THEN RAISE EXCEPTION 'Retain the whole bounded final physical namespace without hash-domain collisions' USING ERRCODE='23514';END IF;
 FOR physical_row IN WITH physical AS(
  SELECT current_entry.family,current_entry.identity,current_entry.fingerprint FROM freeholder_controlled_cash_parent_entries(source_collection) current_entry
  UNION ALL SELECT 'invoice_credit_funding_atomic_fee_partitions',actual_purpose.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'invoice_credit_reservation_atomic_fee_partitions',actual_purpose.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_purpose)::text,'UTF8')),'hex') FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.source_payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
  UNION ALL SELECT 'merchant_fee_refund_invocations',actual_invocation.id::text,encode(sha256(convert_to(to_jsonb(actual_invocation)::text,'UTF8')),'hex') FROM merchant_fee_refund_invocations actual_invocation WHERE actual_invocation.payment_id=ANY(freeholder_controlled_cash_scope_ids(current_scope,'payments'))
 ) SELECT physical.family,physical.identity,min(physical.fingerprint) AS fingerprint FROM physical GROUP BY physical.family,physical.identity ORDER BY physical.family,physical.identity LOOP
  SELECT original_entry.value INTO before_entry FROM jsonb_array_elements(purpose.before_entries) original_entry(value) WHERE original_entry.value->>'key'=physical_row.family||':'||physical_row.identity;
  allowed_birth:=false;
  IF before_entry IS NULL THEN
   IF physical_row.family IN('invoice_credit_funding','invoice_credit_funding_atomic_fee_partitions') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_funding original_funding LEFT JOIN invoice_credit_funding_atomic_fee_partitions original_purpose ON original_purpose.funding_id=original_funding.id
     WHERE original_funding.id::text=physical_row.identity AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_funding.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND EXISTS(SELECT 1 FROM subscription_proration_principal original_principal WHERE original_principal.proration_id=owner_proration AND original_principal.source_payment_id=original_funding.source_payment_id
       AND original_principal.source_application_id IS NOT DISTINCT FROM original_funding.source_application_id AND original_principal.amount_minor=original_funding.amount_minor AND original_principal.fee_obligation_minor=original_funding.fee_obligation_minor
       AND original_principal.fee_proven_collected_minor=original_funding.fee_proven_collected_minor AND original_principal.fee_evidence_digest=original_funding.fee_evidence_digest AND original_principal.original_evidence_digest=original_funding.original_evidence_digest)
      AND(original_purpose.funding_id IS NOT NULL AND original_purpose.admission_transaction_id=pg_current_xact_id()::text AND original_purpose.economics->'birthDeclaration'->>'quoteId'=owner_quote::text
        AND original_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(original_funding)::text,'UTF8')),'hex')
       OR physical_row.family='invoice_credit_funding' AND original_purpose.funding_id IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
        WHERE declared_source.value->>'fundingId'=original_funding.id::text OR(declared_source.value->>'sourcePaymentId'=original_funding.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM original_funding.source_application_id::text)))) INTO allowed_birth;
   ELSIF physical_row.family IN('invoice_credit_reservations','invoice_credit_reservation_atomic_fee_partitions') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_reservations original_reservation LEFT JOIN invoice_credit_reservation_atomic_fee_partitions original_purpose ON original_purpose.reservation_id=original_reservation.id
     JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
     LEFT JOIN invoice_credit_funding_atomic_fee_partitions original_funding_purpose ON original_funding_purpose.funding_id=original_funding.id
     WHERE original_reservation.id::text=physical_row.identity AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_reservation.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND(original_purpose.reservation_id IS NOT NULL AND original_purpose.admission_transaction_id=pg_current_xact_id()::text AND original_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(original_reservation)::text,'UTF8')),'hex')
       OR physical_row.family='invoice_credit_reservations' AND original_purpose.reservation_id IS NULL AND original_funding_purpose.funding_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
         WHERE declared_source.value->>'fundingId'=original_funding.id::text OR(declared_source.value->>'sourcePaymentId'=original_funding.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM original_funding.source_application_id::text)))) INTO allowed_birth;
   ELSIF physical_row.family IN('invoice_credit_applications','agreement_fee_credit_assignments') THEN
    SELECT EXISTS(SELECT 1 FROM invoice_credit_applications original_application JOIN invoice_credit_reservations original_reservation ON original_reservation.id=original_application.reservation_id
     JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
     WHERE original_application.reservation_id::text=physical_row.identity AND original_application.invoice_id=target_invoice AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND original_application.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND original_application.fee_obligation_minor=original_reservation.fee_obligation_minor AND original_application.fee_proven_collected_minor=original_reservation.fee_proven_collected_minor
      AND NOT EXISTS(SELECT 1 FROM invoice_credit_releases actual_release WHERE actual_release.reservation_id=original_reservation.id)
      AND(physical_row.family='invoice_credit_applications' OR EXISTS(SELECT 1 FROM agreement_fee_credit_assignments actual_assignment WHERE actual_assignment.application_id=original_application.reservation_id AND actual_assignment.invoice_id=target_invoice
       AND actual_assignment.amount_minor=original_reservation.amount_minor AND actual_assignment.fee_obligation_minor=original_application.fee_obligation_minor AND actual_assignment.proven_collected_minor=original_application.fee_proven_collected_minor
       AND actual_assignment.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text))) INTO allowed_birth;
   ELSIF physical_row.family='subscription_proration_credit_uses' THEN
    SELECT EXISTS(SELECT 1 FROM subscription_proration_credit_uses actual_use WHERE actual_use.id::text=physical_row.identity AND actual_use.proration_id=owner_proration AND actual_use.credit_note_id=accepted.credit_note_id
     AND actual_use.amount_minor::text=actual_quote.review->>'creditAppliedMinor' AND actual_use.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text) INTO allowed_birth;
   ELSIF physical_row.family='agreement_fee_duties' THEN
    SELECT EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id::text=physical_row.identity AND actual_duty.invoice_id=target_invoice AND actual_duty.acceptance_id=owner_proration
     AND actual_duty.accepted_quote_digest=actual_quote.quote_digest AND actual_duty.merchant_profile_id=actual_quote.profile_id AND actual_duty.profile_version=actual_quote.profile_version
     AND actual_duty.target_fee_minor=accepted.debit_fee_obligation_minor AND actual_duty.carried_fee_minor=accepted.applied_fee_obligation_minor
     AND actual_duty.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text) INTO allowed_birth;
   ELSIF physical_row.family IN('subscription_controlled_collections','subscription_controlled_components') THEN
    SELECT EXISTS(SELECT 1 FROM subscription_controlled_collections actual_collection WHERE actual_collection.id=actual_quote.planned_collection_id AND actual_collection.quote_id=owner_quote AND actual_collection.proration_id=owner_proration
     AND actual_collection.invoice_id IS NOT DISTINCT FROM target_invoice AND actual_collection.credit_note_id IS NOT DISTINCT FROM accepted.credit_note_id
     AND actual_collection.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text AND freeholder_controlled_collection_valid(actual_collection.id)
     AND(physical_row.family='subscription_controlled_collections' AND actual_collection.id::text=physical_row.identity
      OR physical_row.family='subscription_controlled_components' AND EXISTS(SELECT 1 FROM subscription_controlled_components actual_component WHERE actual_component.id::text=physical_row.identity AND actual_component.collection_id=actual_collection.id
       AND actual_component.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text))) INTO allowed_birth;
   END IF;
   IF allowed_birth THEN CONTINUE;END IF;
  END IF;
  normalized_hash:=physical_row.fingerprint;
  IF physical_row.family='invoices' AND physical_row.identity=target_invoice::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeInvoiceProjections') original_projection(value) WHERE original_projection.value->>'invoiceId'=physical_row.identity;
   SELECT original_invoice.* INTO actual_invoice FROM invoices original_invoice WHERE original_invoice.id=target_invoice;
   SELECT coalesce(sum(original_reservation.amount_minor),0) INTO application_delta FROM invoice_credit_applications original_application JOIN invoice_credit_reservations original_reservation ON original_reservation.id=original_application.reservation_id JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
    WHERE original_application.invoice_id=target_invoice AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
     AND original_application.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(purpose.before_entries) prior_application(value) WHERE prior_application.value->>'key'='invoice_credit_applications:'||original_application.reservation_id::text);
   target_credited:=(projection->>'creditedMinor')::numeric+application_delta;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR application_delta<=0 OR actual_invoice.credited_minor IS DISTINCT FROM target_credited
    OR actual_invoice.status IS DISTINCT FROM(CASE WHEN actual_invoice.paid_minor+actual_invoice.credited_minor>=actual_invoice.total_minor-actual_invoice.refunded_minor THEN 'paid' ELSE 'partially_paid' END) THEN
    RAISE EXCEPTION 'Only the exact actual original noncash application may change its canonical invoice projection' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(actual_invoice)||jsonb_build_object('credited_minor',(projection->>'creditedMinor')::bigint,'status',projection->>'status','paid_at',(projection->>'paidAt')::timestamptz,'updated_at',(projection->>'updatedAt')::timestamptz);
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted invoice field changed during credit application' USING ERRCODE='23514';END IF;
  ELSIF physical_row.family='subscription_prorations' AND physical_row.identity=owner_proration::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeProrationProjections') original_projection(value) WHERE original_projection.value->>'prorationId'=physical_row.identity;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR projection->>'state' IS DISTINCT FROM 'accepted' OR projection->>'originalJobId' IS NOT NULL OR projection->>'jobClaimDigest' IS NOT NULL OR projection->>'originalTask' IS NOT NULL
    OR accepted.original_job_id IS NULL OR accepted.original_task->>'prorationId' IS DISTINCT FROM accepted.id::text OR accepted.original_task->>'subscriptionId' IS DISTINCT FROM accepted.subscription_id::text
    OR accepted.original_task->>'originalJobId' IS DISTINCT FROM accepted.original_job_id::text OR accepted.original_task->>'acceptedQuoteDigest' IS DISTINCT FROM accepted.accepted_quote_digest
    OR NOT EXISTS(SELECT 1 FROM job_idempotency_keys original_claim JOIN pgboss.job original_job ON original_job.id=original_claim.job_id AND original_job.name=original_claim.job_name
     WHERE original_claim.job_id=accepted.original_job_id AND original_claim.job_name='subscriptions.applyGrossProration' AND original_claim.payload_hash=accepted.job_claim_digest AND original_job.data=accepted.original_task)
    OR accepted.state IS DISTINCT FROM(CASE WHEN target_invoice IS NULL OR EXISTS(SELECT 1 FROM invoices actual_target WHERE actual_target.id=target_invoice AND actual_target.status='paid' AND actual_target.paid_minor+actual_target.credited_minor>=actual_target.total_minor-actual_target.refunded_minor) THEN 'awaiting_effective' ELSE 'awaiting_payment' END) THEN
    RAISE EXCEPTION 'Only the genuine shared original enqueue/task/state continuation can change this accepted proration' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(accepted)||jsonb_build_object('original_job_id',projection->'originalJobId','job_claim_digest',projection->'jobClaimDigest','original_task',projection->'originalTask','state',projection->'state');
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted accepted proration field changed' USING ERRCODE='23514';END IF;
  ELSIF physical_row.family='subscriptions' AND physical_row.identity=owner_subscription::text AND before_entry->>'postgres_row' IS DISTINCT FROM physical_row.fingerprint THEN
   SELECT original_projection.value INTO projection FROM jsonb_array_elements(purpose.economics->'beforeSubscriptionProjections') original_projection(value) WHERE original_projection.value->>'subscriptionId'=physical_row.identity;
   SELECT original_parent.* INTO actual_subscription FROM subscriptions original_parent WHERE original_parent.id=owner_subscription;
   IF projection IS NULL OR before_entry->>'postgres_row' IS NULL OR projection->>'pendingPlanId' IS NOT NULL OR actual_subscription.pending_plan_id IS DISTINCT FROM accepted.plan_id THEN
    RAISE EXCEPTION 'Only the exact newly accepted pending plan may continue this real parent' USING ERRCODE='23514';END IF;
   normalized_row:=to_jsonb(actual_subscription)||jsonb_build_object('pending_plan_id',projection->'pendingPlanId','updated_at',(projection->>'updatedAt')::timestamptz);
   normalized_hash:=encode(sha256(convert_to(normalized_row::text,'UTF8')),'hex');IF normalized_hash IS DISTINCT FROM before_entry->>'postgres_row' THEN RAISE EXCEPTION 'An unlisted original subscription field changed' USING ERRCODE='23514';END IF;
  END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('table',physical_row.family,'id',physical_row.identity,'fingerprint',normalized_hash));
 END LOOP;
 SELECT encode(sha256(convert_to(string_agg(actual_entry.value->>'table'||':'||(actual_entry.value->>'id')||':'||(actual_entry.value->>'fingerprint'),E'\n' ORDER BY actual_entry.value->>'table',actual_entry.value->>'id'),'UTF8')),'hex') INTO final_revision FROM jsonb_array_elements(normalized) actual_entry(value);
 IF final_revision IS DISTINCT FROM purpose.economics->>'postgresSourceRevision' THEN RAISE EXCEPTION 'Final actual current physical history differs beyond the exact authenticated canonical credit delta' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_credit_fee_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE funding invoice_credit_funding%ROWTYPE;reservation invoice_credit_reservations%ROWTYPE;payment payments%ROWTYPE;parent invoice_credit_applications%ROWTYPE;parent_r invoice_credit_reservations%ROWTYPE;
 total_principal numeric;total_fee numeric;prior_principal numeric;prior_fee numeric;prior_proven numeric;expected_fee numeric;expected_proven numeric;
 atomic_known boolean;atomic_candidate record;atomic_interval record;atomic_funding_parent invoice_credit_funding%ROWTYPE;atomic_reservation_parent invoice_credit_reservations%ROWTYPE;atomic_funding_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;atomic_reservation_purpose invoice_credit_reservation_atomic_fee_partitions%ROWTYPE;atomic_scope jsonb;atomic_required_resource uuid;atomic_required_key text;
BEGIN
 IF current_setting('freeholder.invoice_credit_v1',true)IS DISTINCT FROM '1' OR NEW.fee_evidence_digest IS NULL OR NEW.fee_evidence_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Retain the exact original fee obligation and actual collection evidence before new credit disposition' USING ERRCODE='23514'; END IF;
 -- Exact NEW B branches retain the complete old non-B body below.
 IF TG_TABLE_NAME='invoice_credit_funding' THEN
  SELECT EXISTS(SELECT 1 FROM payments original_payment JOIN invoices original_invoice ON original_invoice.id=original_payment.invoice_id JOIN controlled_cash_application_links original_link ON original_link.payment_id=original_payment.id
   WHERE original_payment.id=NEW.source_payment_id AND original_invoice.refunded_minor>0 AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=original_invoice.id AND atomic_epoch.protocol='controlled_cash_atomic.v1'))
   OR EXISTS(SELECT 1 FROM subscription_controlled_quotes actual_quote CROSS JOIN LATERAL jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
    WHERE actual_quote.planned_proration_id=NEW.proration_id AND(declared_source.value->>'fundingId'=NEW.id::text OR(declared_source.value->>'sourcePaymentId'=NEW.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM NEW.source_application_id::text))) INTO atomic_known;
  IF atomic_known THEN
   SELECT freeholder_controlled_cash_scope(original_batch.collection_id) INTO atomic_scope FROM controlled_cash_application_links original_link JOIN controlled_cash_application_batches original_batch ON original_batch.id=original_link.batch_id WHERE original_link.payment_id=NEW.source_payment_id;
   IF atomic_scope IS NULL OR cardinality(freeholder_controlled_cash_scope_ids(atomic_scope,'resources'))=0 THEN RAISE EXCEPTION 'Restore the real complete original controlled source prefix before the first credit mutation' USING ERRCODE='23514';END IF;
   FOR atomic_required_resource IN SELECT original_resource FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'resources')) original_resource LOOP PERFORM freeholder_controlled_cash_require_prefix(atomic_required_resource);END LOOP;
   FOR atomic_required_key IN SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'payments')) actual_id
    UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'invoices')) actual_id
    UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'notes')) actual_id
    UNION SELECT 'merchant-return-read:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'inspections')) actual_id
    UNION SELECT 'merchant-fee-invocation:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'payments')) actual_id
    UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(atomic_scope->'namespaces') actual_namespace LOOP
    IF atomic_required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
     AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
     AND actual_lock.classid::bigint=(CASE WHEN hashtext(atomic_required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END) AND actual_lock.objid::bigint=(hashtext(atomic_required_key)::bigint & 4294967295::bigint)) THEN
     RAISE EXCEPTION 'All genuine original canonical/cash/callback locks must already be held before typed credit; no late prefix acquisition' USING ERRCODE='23514';END IF;
   END LOOP;
   SELECT current_candidate.* INTO atomic_candidate FROM freeholder_atomic_credit_fee_partition(NEW.source_payment_id,NEW.source_application_id,NEW.amount_minor) current_candidate;
   IF atomic_candidate.known IS DISTINCT FROM true OR NEW.fee_obligation_minor IS DISTINCT FROM atomic_candidate.take_assigned_fee_minor OR NEW.fee_proven_collected_minor IS DISTINCT FROM atomic_candidate.take_collected_fee_minor OR NEW.fee_unexpected
    OR NEW.fee_collection_state IS DISTINCT FROM(CASE WHEN atomic_candidate.take_assigned_fee_minor=0 THEN 'not_due' WHEN atomic_candidate.take_owed_fee_minor=0 THEN 'verified_collected' ELSE 'owed' END)
    OR NOT EXISTS(SELECT 1 FROM subscription_proration_principal original_principal WHERE original_principal.proration_id=NEW.proration_id AND original_principal.source_payment_id=NEW.source_payment_id AND original_principal.source_application_id IS NOT DISTINCT FROM NEW.source_application_id
     AND original_principal.amount_minor=NEW.amount_minor AND original_principal.fee_obligation_minor=NEW.fee_obligation_minor AND original_principal.fee_proven_collected_minor=NEW.fee_proven_collected_minor
     AND original_principal.fee_collection_state=NEW.fee_collection_state AND original_principal.fee_evidence_digest=NEW.fee_evidence_digest AND original_principal.fee_unexpected=NEW.fee_unexpected)
    OR NOT EXISTS(SELECT 1 FROM subscription_controlled_quotes actual_quote JOIN subscription_prorations accepted ON accepted.id=actual_quote.planned_proration_id AND accepted.accepted_quote_digest=actual_quote.quote_digest
     CROSS JOIN LATERAL jsonb_array_elements(actual_quote.review->'atomicCreditFeeDeclaration'->'fundings') declared_source(value)
     WHERE accepted.id=NEW.proration_id AND actual_quote.review->'atomicCreditFeeDeclaration'->>'protocol'='freeholder.atomic-credit-fee-declaration.v1'
      AND declared_source.value->>'fundingId'=NEW.id::text AND declared_source.value->>'sourcePaymentId'=NEW.source_payment_id::text AND declared_source.value->>'sourceApplicationId' IS NOT DISTINCT FROM NEW.source_application_id::text
      AND declared_source.value->>'amountMinor'=NEW.amount_minor::text AND declared_source.value->>'feeEvidenceDigest'=NEW.fee_evidence_digest) THEN
    RAISE EXCEPTION 'New B funding needs its actual current original epoch, exact accepted principal/fee and genuine private planned UUID; no legacy coincidence fallback' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
 ELSE
  IF TG_TABLE_NAME='invoice_credit_reservations' THEN
   SELECT original_funding.* INTO atomic_funding_parent FROM invoice_credit_funding original_funding WHERE original_funding.id=NEW.funding_id;
  ELSE
   SELECT original_reservation.* INTO atomic_reservation_parent FROM invoice_credit_reservations original_reservation WHERE original_reservation.id=NEW.reservation_id;
   SELECT original_funding.* INTO atomic_funding_parent FROM invoice_credit_funding original_funding WHERE original_funding.id=atomic_reservation_parent.funding_id;
  END IF;
  SELECT original_purpose.* INTO atomic_funding_purpose FROM invoice_credit_funding_atomic_fee_partitions original_purpose WHERE original_purpose.funding_id=atomic_funding_parent.id;
  SELECT atomic_funding_purpose.funding_id IS NOT NULL OR EXISTS(SELECT 1 FROM payments original_payment JOIN invoices original_invoice ON original_invoice.id=original_payment.invoice_id JOIN controlled_cash_application_links original_link ON original_link.payment_id=original_payment.id
   WHERE original_payment.id=atomic_funding_parent.source_payment_id AND original_invoice.refunded_minor>0 AND EXISTS(SELECT 1 FROM controlled_cash_application_batches atomic_epoch WHERE atomic_epoch.invoice_id=original_invoice.id AND atomic_epoch.protocol='controlled_cash_atomic.v1')) INTO atomic_known;
  IF atomic_known THEN
   SELECT freeholder_controlled_cash_scope(original_batch.collection_id) INTO atomic_scope FROM controlled_cash_application_links original_link JOIN controlled_cash_application_batches original_batch ON original_batch.id=original_link.batch_id WHERE original_link.payment_id=atomic_funding_parent.source_payment_id;
   IF atomic_scope IS NULL OR cardinality(freeholder_controlled_cash_scope_ids(atomic_scope,'resources'))=0 THEN RAISE EXCEPTION 'Restore the real complete original controlled source prefix before the first credit mutation' USING ERRCODE='23514';END IF;
   FOR atomic_required_resource IN SELECT original_resource FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'resources')) original_resource LOOP PERFORM freeholder_controlled_cash_require_prefix(atomic_required_resource);END LOOP;
   FOR atomic_required_key IN SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'payments')) actual_id
    UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'invoices')) actual_id
    UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'notes')) actual_id
    UNION SELECT 'merchant-return-read:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'inspections')) actual_id
    UNION SELECT 'merchant-fee-invocation:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(atomic_scope,'payments')) actual_id
    UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(atomic_scope->'namespaces') actual_namespace LOOP
    IF atomic_required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
     AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
     AND actual_lock.classid::bigint=(CASE WHEN hashtext(atomic_required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END) AND actual_lock.objid::bigint=(hashtext(atomic_required_key)::bigint & 4294967295::bigint)) THEN
     RAISE EXCEPTION 'All genuine original canonical/cash/callback locks must already be held before typed credit; no late prefix acquisition' USING ERRCODE='23514';END IF;
   END LOOP;
   SELECT current_candidate.* INTO atomic_candidate FROM freeholder_atomic_credit_fee_partition(atomic_funding_parent.source_payment_id,atomic_funding_parent.source_application_id,0) current_candidate;
   IF atomic_candidate.known IS DISTINCT FROM true THEN RAISE EXCEPTION 'An old loan cannot continue beyond genuine current original retained fee/principal capacity' USING ERRCODE='23514';END IF;
   IF atomic_funding_purpose.funding_id IS NOT NULL THEN
    IF TG_TABLE_NAME='invoice_credit_reservations' THEN
     SELECT current_interval.* INTO atomic_interval FROM freeholder_atomic_credit_reservation_partition(atomic_funding_parent.id,NEW.amount_minor) current_interval;
    ELSE
     SELECT current_interval.* INTO atomic_interval FROM freeholder_atomic_credit_reservation_partition(atomic_funding_parent.id,0) current_interval;
    END IF;
    IF atomic_interval.known IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retain every actual original B interval, source and current bank/caller before new disposition' USING ERRCODE='23514';END IF;
    IF TG_TABLE_NAME='invoice_credit_reservations' THEN
     IF NEW.fee_obligation_minor IS DISTINCT FROM atomic_interval.assigned_fee_minor OR NEW.fee_proven_collected_minor IS DISTINCT FROM atomic_interval.collected_fee_minor
      OR NEW.fee_collection_state IS DISTINCT FROM atomic_funding_parent.fee_collection_state OR NEW.fee_unexpected IS DISTINCT FROM atomic_funding_parent.fee_unexpected THEN
      RAISE EXCEPTION 'A B reservation consumes exact original absolute interval/caps, never a repriced assigned/principal fraction' USING ERRCODE='23514';END IF;
     RETURN NEW;
    ELSE
     SELECT original_purpose.* INTO atomic_reservation_purpose FROM invoice_credit_reservation_atomic_fee_partitions original_purpose WHERE original_purpose.reservation_id=NEW.reservation_id;
     IF atomic_reservation_purpose.reservation_id IS NULL OR atomic_reservation_purpose.funding_id IS DISTINCT FROM atomic_funding_parent.id
      OR atomic_reservation_purpose.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(atomic_reservation_parent)::text,'UTF8')),'hex')
      OR atomic_reservation_purpose.funding_partition_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(atomic_funding_purpose)::text,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'An actual B application derives exactly its immutable reservation PK/FK and current complete source; no new loan or old-child fallback' USING ERRCODE='23514';END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='invoice_credit_funding' THEN
  SELECT * INTO payment FROM payments WHERE id=NEW.source_payment_id;
  IF NEW.source_application_id IS NULL THEN total_principal:=payment.amount_minor;total_fee:=freeholder_original_payment_fee(payment.id);
  ELSE SELECT * INTO parent FROM invoice_credit_applications WHERE reservation_id=NEW.source_application_id;SELECT * INTO parent_r FROM invoice_credit_reservations WHERE id=parent.reservation_id;
   total_principal:=parent_r.amount_minor;total_fee:=parent.fee_obligation_minor;
   IF parent.fee_evidence_digest IS NULL THEN RAISE EXCEPTION 'An inherited applied credit requires its real original fee disposition' USING ERRCODE='23514';END IF;
  END IF;
  SELECT coalesce(sum(f.amount_minor),0),coalesce(sum(f.fee_obligation_minor),0) INTO prior_principal,prior_fee FROM invoice_credit_funding f JOIN credit_notes n ON n.id=f.credit_note_id
   WHERE f.source_payment_id=payment.id AND f.source_application_id IS NOT DISTINCT FROM NEW.source_application_id AND n.status='issued';
  IF payment.id IS NULL OR payment.refunded_minor<>0 OR total_principal IS NULL OR total_principal<=0 OR total_fee IS NULL OR prior_fee<>floor(total_fee*prior_principal/total_principal) THEN
   RAISE EXCEPTION 'Restore the complete original fee epoch and cumulative allocation; never reprice it at a later bps' USING ERRCODE='23514';END IF;
  expected_fee:=floor(total_fee*(prior_principal+NEW.amount_minor)/total_principal)-prior_fee;
  IF NEW.fee_obligation_minor<>expected_fee OR NOT EXISTS(SELECT 1 FROM subscription_proration_principal s WHERE s.proration_id=NEW.proration_id AND s.source_payment_id=NEW.source_payment_id AND s.source_application_id IS NOT DISTINCT FROM NEW.source_application_id
   AND s.amount_minor=NEW.amount_minor AND s.fee_obligation_minor=NEW.fee_obligation_minor AND s.fee_proven_collected_minor=NEW.fee_proven_collected_minor AND s.fee_collection_state=NEW.fee_collection_state AND s.fee_evidence_digest=NEW.fee_evidence_digest AND s.fee_unexpected=NEW.fee_unexpected) THEN
   RAISE EXCEPTION 'The issued credit must reproduce its exact accepted principal/fee source receipt' USING ERRCODE='23514';END IF;
  IF NEW.fee_collection_state IN('recorded_remitted','verified_collected','not_due') AND NOT freeholder_credit_fee_is_collected(payment.id,NEW.fee_collection_state)
   OR NEW.fee_proven_collected_minor<>(CASE WHEN NEW.fee_collection_state IN('recorded_remitted','verified_collected') THEN NEW.fee_obligation_minor ELSE 0 END) THEN
   RAISE EXCEPTION 'An expected carried fee is not a collected commission; preserve owed or review until actual original proof exists' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='invoice_credit_reservations' THEN
  SELECT * INTO funding FROM invoice_credit_funding WHERE id=NEW.funding_id;
  SELECT coalesce(sum(r.amount_minor),0),coalesce(sum(r.fee_obligation_minor),0),coalesce(sum(r.fee_proven_collected_minor),0) INTO prior_principal,prior_fee,prior_proven
   FROM invoice_credit_reservations r LEFT JOIN invoice_credit_applications a ON a.reservation_id=r.id LEFT JOIN invoice_credit_releases l ON l.reservation_id=r.id WHERE r.funding_id=funding.id AND(a.reservation_id IS NOT NULL OR l.reservation_id IS NULL);
  expected_fee:=floor(funding.fee_obligation_minor::numeric*(prior_principal+NEW.amount_minor)/funding.amount_minor)-prior_fee;
  expected_proven:=floor(funding.fee_proven_collected_minor::numeric*(prior_principal+NEW.amount_minor)/funding.amount_minor)-prior_proven;
  IF funding.fee_evidence_digest IS NULL OR NEW.fee_obligation_minor<>expected_fee OR NEW.fee_proven_collected_minor<>expected_proven OR NEW.fee_collection_state<>funding.fee_collection_state OR NEW.fee_unexpected<>funding.fee_unexpected THEN
   RAISE EXCEPTION 'Reserve the same original fee epoch with deterministic residual ownership, separately from proven collection' USING ERRCODE='23514';END IF;
 ELSE SELECT * INTO reservation FROM invoice_credit_reservations WHERE id=NEW.reservation_id;
  IF reservation.fee_evidence_digest IS NULL OR NEW.fee_obligation_minor<>reservation.fee_obligation_minor OR NEW.fee_proven_collected_minor<>reservation.fee_proven_collected_minor OR NEW.fee_collection_state<>reservation.fee_collection_state OR NEW.fee_unexpected<>reservation.fee_unexpected THEN
   RAISE EXCEPTION 'An actual credit application cannot invent or lose its original fee obligation or collection state' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_credit_fee_is_collected(target uuid,kind text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (CASE WHEN kind='recorded_remitted' THEN EXISTS(SELECT 1 FROM commercial_payment_attestations a JOIN payments p ON p.id=a.payment_id WHERE a.payment_id=target AND p.status='succeeded' AND p.refunded_minor=0
  AND coalesce((SELECT sum(CASE WHEN f.direction='returned' THEN -f.amount_minor ELSE f.amount_minor END)FROM commercial_fee_attestations f WHERE f.payment_id=p.id),0)=a.fee_owed_minor)
 WHEN kind IN('verified_collected','not_due') THEN EXISTS(SELECT 1 FROM payments p JOIN LATERAL(SELECT * FROM merchant_payment_observations o WHERE o.payment_id=p.id AND o.provider_ref=p.provider_ref AND o.status='succeeded' ORDER BY o.observed_at DESC,o.id DESC LIMIT 1)o ON true
  WHERE p.id=target AND p.status='succeeded' AND p.refunded_minor=0 AND o.customer_charge_verified AND o.route_verified AND o.amount_minor=p.amount_minor AND o.currency=p.currency
  AND o.application_fee_currency=p.currency AND o.observed_application_fee_minor=freeholder_original_payment_fee(p.id)AND o.observed_fee_refunded_minor=0
  AND(kind='not_due' AND freeholder_original_payment_fee(p.id)=0 AND o.application_fee_ref IS NULL OR kind='verified_collected' AND o.application_fee_ref IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM merchant_fee_refunds f WHERE f.payment_id=p.id AND f.status IN('reserved','dispatching','unknown')))
  OR(kind='not_due'AND EXISTS(SELECT 1 FROM commercial_payment_attestations a WHERE a.payment_id=target AND a.fee_owed_minor=0)) ELSE false END) OR EXISTS(
  SELECT 1 FROM payments original_payment JOIN invoices original_invoice ON original_invoice.id=original_payment.invoice_id
   JOIN controlled_cash_application_links original_link ON original_link.payment_id=original_payment.id
   JOIN LATERAL freeholder_atomic_credit_fee_partition(original_payment.id,NULL,0) current_capacity ON current_capacity.known
   JOIN LATERAL freeholder_controlled_atomic_refund_fee_state(original_payment.id) current_fee ON current_fee.known AND current_fee.reconciled
  WHERE kind IN('verified_collected','not_due') AND original_payment.id=target AND original_payment.status='succeeded' AND original_payment.refunded_minor=0 AND original_invoice.refunded_minor>0
   AND current_capacity.source_receipt_id=original_link.receipt_id AND current_fee.receipt_id=original_link.receipt_id
   AND current_capacity.bank_inspection_id=current_fee.inspection_id AND current_capacity.bank_observation_id=current_fee.observation_id AND current_capacity.bank_namespace_revision=current_fee.bank_namespace_revision
   AND current_fee.actual_retained_fee_minor=current_capacity.original_fee_minor-current_capacity.retired_fee_minor
   AND(kind='not_due' AND current_capacity.original_fee_minor=0 OR kind='verified_collected' AND current_capacity.original_fee_minor>0)
 )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_invoice_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE funding invoice_credit_funding%ROWTYPE; reservation invoice_credit_reservations%ROWTYPE; note credit_notes%ROWTYPE; line credit_note_lines%ROWTYPE;
 source invoices%ROWTYPE; target invoices%ROWTYPE; payment payments%ROWTYPE; used bigint; parent_application invoice_credit_applications%ROWTYPE; parent_reservation invoice_credit_reservations%ROWTYPE; parent_funding invoice_credit_funding%ROWTYPE;
 atomic_siblings_ok boolean:=false;atomic_candidate record;atomic_reservation_purpose invoice_credit_reservation_atomic_fee_partitions%ROWTYPE;atomic_funding_purpose invoice_credit_funding_atomic_fee_partitions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.invoice_credit_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original noncash credit funding/reservations/applications/releases are immutable through their guarded exact writer' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='invoice_credit_funding' THEN
  SELECT * INTO note FROM credit_notes WHERE id=NEW.credit_note_id;
  SELECT * INTO line FROM credit_note_lines WHERE id=NEW.credit_note_line_id;
  SELECT * INTO payment FROM payments WHERE id=NEW.source_payment_id;
  SELECT * INTO source FROM invoices WHERE id=NEW.source_invoice_id;
  IF NEW.source_application_id IS NOT NULL THEN
   SELECT * INTO parent_application FROM invoice_credit_applications WHERE reservation_id=NEW.source_application_id;
   SELECT * INTO parent_reservation FROM invoice_credit_reservations WHERE id=parent_application.reservation_id;
   SELECT * INTO parent_funding FROM invoice_credit_funding WHERE id=parent_reservation.funding_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payment:'||NEW.source_payment_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('invoice:'||NEW.source_invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('credit-note:'||NEW.credit_note_id::text));
  IF note.id IS NULL OR note.status<>'issued' OR note.invoice_id IS DISTINCT FROM source.id OR line.credit_note_id IS DISTINCT FROM note.id
   OR payment.status<>'succeeded' OR payment.currency IS DISTINCT FROM note.currency OR source.currency IS DISTINCT FROM note.currency
   OR(NEW.source_application_id IS NULL AND payment.invoice_id IS DISTINCT FROM source.id)
   OR(NEW.source_application_id IS NOT NULL AND(parent_application.invoice_id IS DISTINCT FROM source.id OR parent_funding.source_payment_id IS DISTINCT FROM payment.id OR parent_reservation.id IS NULL))
   OR NOT EXISTS(SELECT 1 FROM invoice_lines original WHERE original.id=line.invoice_line_id AND original.invoice_id=source.id)
   OR EXISTS(SELECT 1 FROM return_requests r WHERE r.credit_note_id=note.id)
   OR(NEW.source_application_id IS NULL AND NOT freeholder_refund_amount_available(payment.id,'invoice-credit-funding:'||NEW.id::text,freeholder_credit_principal_reserved(payment.id)+NEW.amount_minor))
   OR NOT freeholder_subscription_proration_credit_owner(NEW.proration_id,note.id,line.id,payment.id,NEW.amount_minor,NEW.original_evidence_digest) THEN
   RAISE EXCEPTION 'Credit needs exact original issued lines, successful principal, current refund capacity and causal accepted proration ownership' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(f.amount_minor),0) INTO used FROM invoice_credit_funding f WHERE f.credit_note_line_id=line.id;
  IF used+NEW.amount_minor>line.total_minor THEN RAISE EXCEPTION 'Credit line funding cannot borrow another original line principal' USING ERRCODE='23514'; END IF;
  IF NEW.source_application_id IS NOT NULL THEN
   SELECT coalesce(sum(f.amount_minor),0) INTO used FROM invoice_credit_funding f JOIN credit_notes c ON c.id=f.credit_note_id WHERE f.source_application_id=NEW.source_application_id AND c.status='issued';
   IF used+NEW.amount_minor>parent_reservation.amount_minor THEN RAISE EXCEPTION 'Original applied credit principal cannot fund multiple successor promises beyond its exact own amount' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_TABLE_NAME='invoice_credit_reservations' THEN SELECT * INTO funding FROM invoice_credit_funding WHERE id=NEW.funding_id;
  ELSE SELECT * INTO reservation FROM invoice_credit_reservations WHERE id=NEW.reservation_id; SELECT * INTO funding FROM invoice_credit_funding WHERE id=reservation.funding_id; END IF;
  SELECT * INTO note FROM credit_notes WHERE id=funding.credit_note_id;
  IF funding.id IS NULL OR note.id IS NULL OR note.status<>'issued' OR EXISTS(SELECT 1 FROM return_requests WHERE credit_note_id=note.id) THEN
   RAISE EXCEPTION 'Original issued credit ownership changed or already backs a whole return/refund promise' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payment:'||funding.source_payment_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('invoice:'||funding.source_invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('credit-note:'||note.id::text));
  IF TG_TABLE_NAME='invoice_credit_reservations' THEN
   SELECT coalesce(sum(r.amount_minor),0) INTO used FROM invoice_credit_reservations r LEFT JOIN invoice_credit_releases released ON released.reservation_id=r.id WHERE r.funding_id=funding.id AND released.reservation_id IS NULL;
   IF used+NEW.amount_minor>funding.amount_minor OR NOT freeholder_subscription_proration_credit_target(funding.proration_id,NEW.target_source_id) THEN
    RAISE EXCEPTION 'Reserve only actual available original credit for its exact accepted proration target' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='invoice_credit_applications' THEN
   SELECT * INTO source FROM invoices WHERE id=funding.source_invoice_id;
   SELECT * INTO target FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
   IF source.refunded_minor<>0 THEN
    SELECT actual_purpose.* INTO atomic_reservation_purpose FROM invoice_credit_reservation_atomic_fee_partitions actual_purpose WHERE actual_purpose.reservation_id=reservation.id;
    SELECT actual_purpose.* INTO atomic_funding_purpose FROM invoice_credit_funding_atomic_fee_partitions actual_purpose WHERE actual_purpose.funding_id=funding.id;
    IF atomic_reservation_purpose.reservation_id IS NOT NULL AND atomic_funding_purpose.funding_id IS NOT NULL THEN
     PERFORM freeholder_controlled_cash_require_prefix((atomic_funding_purpose.economics->'plan'->>'sourceResourceId')::uuid);
     SELECT current_capacity.* INTO atomic_candidate FROM freeholder_atomic_credit_fee_partition(funding.source_payment_id,funding.source_application_id,0) current_capacity;
     SELECT atomic_candidate.known IS TRUE
      AND atomic_reservation_purpose.funding_id=funding.id AND atomic_reservation_purpose.source_payment_id=funding.source_payment_id AND atomic_reservation_purpose.source_application_id IS NOT DISTINCT FROM funding.source_application_id
      AND atomic_reservation_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(reservation)::text,'UTF8')),'hex')
      AND atomic_funding_purpose.parent_fingerprint=encode(sha256(convert_to(to_jsonb(funding)::text,'UTF8')),'hex')
      AND atomic_reservation_purpose.funding_partition_fingerprint=encode(sha256(convert_to(to_jsonb(atomic_funding_purpose)::text,'UTF8')),'hex')
      AND NOT EXISTS(SELECT 1 FROM payments original_payment WHERE original_payment.invoice_id=source.id AND original_payment.status IN('created','processing'))
      AND(select coalesce(sum(original_payment.amount_minor),0) from payments original_payment where original_payment.invoice_id=source.id and original_payment.status='succeeded')=source.paid_minor
      AND(select coalesce(sum(original_payment.refunded_minor),0) from payments original_payment where original_payment.invoice_id=source.id and original_payment.status='succeeded')=source.refunded_minor
      AND(select count(*) from freeholder_controlled_atomic_refund_targets(source.id) original_target where original_target.known)=(select count(*) from payments original_payment where original_payment.invoice_id=source.id and original_payment.status='succeeded')
      AND NOT EXISTS(SELECT 1 FROM payments original_payment LEFT JOIN LATERAL freeholder_controlled_atomic_refund_bank_state(original_payment.id) original_bank ON true
       LEFT JOIN LATERAL freeholder_controlled_atomic_refund_fee_state(original_payment.id) original_fee ON true
       WHERE original_payment.invoice_id=source.id AND original_payment.status='succeeded' AND(original_bank.known IS DISTINCT FROM true OR original_bank.refunded_minor IS DISTINCT FROM original_payment.refunded_minor::float8
        OR original_fee.known IS DISTINCT FROM true OR original_fee.reconciled IS DISTINCT FROM true
        OR EXISTS(SELECT 1 FROM freeholder_atomic_fee_return_resources(original_payment.id) actual_return WHERE NOT actual_return.known OR actual_return.pending)
        OR original_payment.refunded_minor>0 AND EXISTS(SELECT 1 FROM invoice_credit_funding original_loan WHERE original_loan.source_payment_id=original_payment.id))) INTO atomic_siblings_ok;
    END IF;
   END IF;
   IF reservation.id IS NULL OR target.id IS NULL OR target.source_type<>'subscription' OR target.source_id IS DISTINCT FROM reservation.target_source_id
    OR target.contact_id IS DISTINCT FROM source.contact_id OR target.currency IS DISTINCT FROM source.currency OR(source.refunded_minor<>0 AND atomic_siblings_ok IS DISTINCT FROM true)
    OR target.issued_at IS NULL OR target.status NOT IN('sent','viewed','partially_paid','overdue') OR target.total_minor-target.paid_minor-target.credited_minor<reservation.amount_minor
    OR EXISTS(SELECT 1 FROM invoice_credit_releases WHERE reservation_id=reservation.id)
    OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=target.id AND p.status IN('created','processing')) THEN
    RAISE EXCEPTION 'Apply the exact unused credit to its actual original issued buyer/currency/target after every original target caller is resolved' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS(SELECT 1 FROM invoice_credit_applications WHERE reservation_id=reservation.id)
   OR NOT freeholder_subscription_proration_credit_release(funding.proration_id,reservation.id) THEN
   RAISE EXCEPTION 'The whole original proration promise or actual applied credit still owns this reservation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
