-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C9.33/C12.38: UNAPPLIED exact controlled-origin branch; all legacy policy preserved.
-- Append AFTER the entire frozen614412-byte owned85 prefix; root owns assembly.
CREATE OR REPLACE FUNCTION freeholder_subscription_period_cash_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed subscription_provider_invoice_observations%ROWTYPE; operation subscription_provider_schedule_operations%ROWTYPE; phase jsonb; payment payments%ROWTYPE; invoice invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE;
BEGIN
 -- A controlled origin is never adopted by the unrelated legacy phase
 -- reader. Its actual generated payment/link, same-TX signed batch and full
 -- current immutable bank/parent stage must prove the exact proposed route.
 IF EXISTS(SELECT 1 FROM subscription_controlled_charge_origins controlled_origin WHERE controlled_origin.receipt_id=NEW.original_charge_receipt_id)
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links controlled_link WHERE controlled_link.payment_id=NEW.payment_id) THEN
  IF TG_OP IS DISTINCT FROM 'INSERT'
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_charge_origins controlled_origin WHERE controlled_origin.receipt_id=NEW.original_charge_receipt_id)
   OR freeholder_controlled_subscription_route_valid(to_jsonb(NEW)) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Only the exact original controlled receipt and genuine same-transaction bank/parent stage may create its period route' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.origin_kind<>'provider_schedule' THEN RETURN NEW; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO invoice FROM invoices WHERE id=payment.invoice_id;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=invoice.id;
 SELECT * INTO observed FROM subscription_provider_invoice_observations WHERE subscription_id=NEW.subscription_id AND provider_invoice_ref=NEW.provider_invoice_ref ORDER BY evidence_revision DESC LIMIT 1;
 IF observed.id IS NULL OR NOT freeholder_subscription_period_verified(observed.id) OR observed.provider_subscription_ref IS DISTINCT FROM NEW.provider_subscription_ref THEN RAISE EXCEPTION 'Apply scheduled cash only through its latest complete admitted invoice lineage' USING ERRCODE='23514'; END IF;
 SELECT * INTO operation FROM subscription_provider_schedule_operations WHERE id=observed.provider_operation_id;
 SELECT value INTO phase FROM jsonb_array_elements(operation.original_request->'phases') WHERE value->>'phaseDigest'=observed.phase_digest;
 IF invoice.source_type<>'subscription' OR split_part(invoice.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text
  OR substring(invoice.source_id FROM 38) IS DISTINCT FROM to_char((phase->>'start')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR invoice.currency IS DISTINCT FROM phase->>'currency' OR invoice.total_minor IS DISTINCT FROM(phase->>'totalMinor')::bigint OR invoice.tax_minor IS DISTINCT FROM(phase->>'taxMinor')::bigint
  OR invoice.shipping_minor<>0 OR invoice.discount_minor<>0 OR policy.fee_minor IS DISTINCT FROM(phase->>'applicationFeeMinor')::bigint OR policy.site_fee_bps IS DISTINCT FROM(phase->>'siteFeeBps')::integer
  OR(SELECT count(*) FROM invoice_merchant_tax_quotes q WHERE q.invoice_id=invoice.id AND q.profile_id::text=phase->>'profileId' AND q.profile_version::text=phase->>'profileVersion' AND q.occurred_at=(phase->>'taxOccurredAt')::timestamptz AND q.tax_minor=(phase->>'taxMinor')::bigint AND q.shipping_minor=0 AND q.shipping_tax_minor=0)<>1
  OR(SELECT count(*) FROM invoice_merchant_tax_quotes q WHERE q.invoice_id=invoice.id)<>1
  OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id)<>(CASE WHEN(phase->>'setupFeeMinor')::bigint>0 THEN 2 ELSE 1 END)
  OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionComponent'='period' AND l.unit_amount_minor=(phase->>'periodAmountMinor')::bigint)<>1
  OR((phase->>'setupFeeMinor')::bigint>0 AND(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionComponent'='setup' AND l.unit_amount_minor=(phase->>'setupFeeMinor')::bigint)<>1)
  OR EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=invoice.id AND(l.source_type IS DISTINCT FROM 'subscription' OR l.source_id IS DISTINCT FROM NEW.subscription_id::text OR l.quantity_micros IS DISTINCT FROM 1000000 OR l.discount_minor IS DISTINCT FROM 0
   OR l.snapshot->>'subscriptionTermsId' IS DISTINCT FROM phase->>'termsId' OR l.snapshot->>'subscriptionPeriodStart' IS DISTINCT FROM phase->>'start' OR l.snapshot->>'subscriptionPeriodEnd' IS DISTINCT FROM phase->>'end'
   OR(l.snapshot ? 'subscriptionPhaseDigest' AND l.snapshot->>'subscriptionPhaseDigest' IS DISTINCT FROM phase->>'phaseDigest'))) THEN
  RAISE EXCEPTION 'The canonical net/setup/tax/fee lines must match the actual admitted original provider period' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_subscription_route_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_subscription_route_valid(jsonb)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c43cf639e0f7ff4840a87aa219cd597b4463b4eb4e4be2d33b399e8022647d1a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_agreement_payment_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1499929d2e393ff2eadd4c43f1a601044be62ea60ac72a41713e9dcff420829a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5315979c10ffba43177521dccf94ab401442f724f9bb372eb24802327d391c6f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_batch()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d4eec6cffbc37e319f492d16e1c1914bc1fae9cc2ead53d66f184805d73cd524')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_receipt()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='69cc878883175b6353bfa7a7caafedb3198627b3d7061ec626e49badf466d959')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_receipts_complete(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a92e7fdbbff4386fd0944ebcae90a7f25dff9d27f47fcf6ec4ae777eb0eb5af0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_before_settlement(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='49bcc680eb768f599b569ca8238e7223403bada4bb90881028f034d166966b9f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_stage(uuid,uuid,uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a40dd083ee120f238c2c58b19890e4f2f20110c6cc3af12eaa90f203413af7d6')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_application_shape(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3f878d26d2ead57e5d1ae5b159404eee172c947aee20bb78d4e27fbf7e7a32fa')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_atomic_fee_valid(uuid,bigint,numeric,numeric)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8b6c12df24f5758a11af8b3dce53a045b86f488c13409e49f88c41084548dce0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_guard_agreement_fee()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d91fd819a23c05940a0392b407d8bae1a107afb980264fbb67cbc2ce47628d57')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_bank_invoice(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea997a78b7a85655575edcc669ecbb41c4a6caee608f357696d164657e9dc48f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_bank_minor(jsonb,boolean)') AND p.provolatile='i' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='05d891ce5a52f018a9c5b6f21d9c3ae43f68d7abd7e831fb2cf512cff476a68e')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_subscription_period_cash_application()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='45821c8b9b091cd3af998039a832e38fdbf04a4861793afd95bb3a31f527064d')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_period_lineage' AND t.tgfoid=to_regprocedure('freeholder_subscription_period_cash_application()') AND t.tgenabled IN('O','A') AND t.tgtype=7 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
