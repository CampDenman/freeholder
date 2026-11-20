-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C11.10/C1.08 SOURCE ONLY, UNAPPLIED. A NEW forward migration AFTER frozen85.
-- This guard must be FIRST in its own actual migration transaction; never
-- concatenate it after prior definitions inside the old85 transaction.
--
-- What this guard can and cannot promise, corrected 2026-11-18.
--
-- ACCESS EXCLUSIVE conflicts with every lock mode, ACCESS SHARE included, so
-- holding it is what actually stops any other session reading or writing these
-- tables for the rest of this transaction, and NOWAIT refuses at once rather
-- than queueing an exclusive request in front of live traffic. That is the
-- whole guarantee, and PostgreSQL enforces it.
--
-- A census of pg_stat_activity stood here and vetoed that lock. It promised
-- nothing on top of it: it cannot tell a connection that will touch these
-- tables from an idle one that never will, and a backend may arrive the moment
-- after it passes -- which the previous version of this header conceded in the
-- same breath as requiring it. What it did do was make every packaged deploy
-- unbootable. Freeholder applies migrations in-process at boot
-- (src/core/migrate.ts, deploy/linux/share/systemd/freeholder.service) while
-- the web server is already answering readiness probes, so the migrating
-- instance's own pool was always "another backend", and the failure was not a
-- refused write but an instance that never became ready. A second replica is
-- still refused -- by the lock, which can see what it holds.
--
-- The prepared-transaction check stays. NOWAIT would refuse such a holder
-- anyway, but by name here rather than as an unexplained lock failure. Its
-- post-lock repetition is gone: once ACCESS EXCLUSIVE is held, no new prepared
-- transaction can reach these tables, so a second look could only refuse a
-- rollout over a prepared transaction that has nothing to do with it.
-- lock_timeout is deliberately not set: NOWAIT does not wait, so it is moot.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
  RAISE EXCEPTION 'Resolve the actual original prepared transactions before safe-response rollout' USING ERRCODE='55006';END IF;
 LOCK TABLE subscription_controlled_calls,subscription_controlled_charge_origins,subscription_controlled_closures,
  subscription_controlled_facts,subscription_controlled_finishes,subscription_controlled_operations,
  subscription_controlled_resources,subscription_controlled_stops,subscription_controlled_verifications IN ACCESS EXCLUSIVE MODE NOWAIT;
END $$;

--> statement-breakpoint

-- Shape-only retention accepts genuine SAFE positive/UNKNOWN facts. Authority is
-- the explicit authority context and additionally requires ZERO unknown paths.
CREATE FUNCTION freeholder_controlled_safe_response_valid(candidate jsonb,context text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record;child jsonb;tag jsonb;item jsonb;kind text;field_name text;count_value numeric;
 allowed text[]=string_to_array('id object customer subscription parent metadata status currency billing_reason collection_method default_payment_method auto_advance total subtotal amount_due amount_paid amount_remaining starting_balance ending_balance pre_payment_credit_notes_amount post_payment_credit_notes_amount application_fee_amount transfer_data on_behalf_of automatic_tax discounts default_tax_rates total_discount_amounts total_taxes total_tax_amounts paid_out_of_band period_start period_end status_transitions payment_intent payments lines payment_method amount amount_received amount_capturable latest_charge capture_method confirmation_method cancellation_reason canceled_at processing amount_captured amount_refunded captured paid refunded disputed dispute application_fee transfer balance_transaction refunds reason fee originating_transaction charge created balance invoice_credit_balance cash_balance deleted available invoice credit_amount pre_payment_amount post_payment_amount refund out_of_band_amount voided_at billing_cycle_anchor billing_mode trial_end trial_start cancel_at_period_end cancel_at ended_at pause_collection application_fee_percent pending_setup_intent latest_invoice items pending_update schedule pending_invoice_item_interval next_pending_invoice_item_invoice quantity current_period_start current_period_end price tax_rates period pricing discount_amounts taxes tax_amounts product unit_amount unit_amount_decimal billing_scheme type tax_behavior transform_quantity recurring active amount_requested payment amount_reversed reversed reversals destination source_transaction account balance_transactions net source fee_details exchange_rate data has_more url subscription_details invoice_item_details subscription_item_details invoice_item subscription_item proration price_details start end interval interval_count usage_type behavior resumes_at enabled amount_percent paid_at finalized_at marked_uncollectible_at tax_rate discount taxability_reason percentage inclusive providerSubscriptionRef providerInvoiceRef providerCustomerRef providerInvoiceItemRef componentId origin requiresIndependentRead prorationSuppressed pauseRequested completeCreditNotes createdProductRef providerPreviewRef providerProductRef providerPriceRef providerLineRef subscriptionItemRef providerApiVersion providerPlatformAccountId providerAccountId providerPaymentIntentRef providerChargeRef destinationAccountId settlementMerchantAccountId customerChargeVerified merchantRouteVerified subscriptionId provider chargeAccountId collectionPausedAsDraft financiallyQuiesced positiveCollectionAdmissible amountMinor totalMinor subtotalMinor paidMinor remainingMinor amountDueMinor autoAdvance completePayments completeLines suppliesPaidAuthority completeZeroRecurringItem fixedTaxRequiredBeforeCollection merchantTaxAuthority actualAnchor actualPeriodStart actualPeriodEnd actualTrialEnd originalAcceptedTrialEnd firstInvoiceFinancialState calendarCanceled actualBillingAnchor actualProviderTrialEnd currentReadDigest complete balanceState issuedCreditNoteRefs inventoryDigest requestedAnchor requestedProrationBehavior originalAnchor originalTrialEnd trialPolicy sealedTaxIncluded prorationAt actualInvoicePeriodStart actualInvoicePeriodEnd component kind periodStart periodEnd exactManifest manifestDigest customerFinancialDigest canonicalTargetDigest providerInvoiceRefs taxAuthority components matches actualCash actualPayments actualIntents actualLines actualPrices actualInvoices creditNotes actualRaw actualInvoice inventory financial lineBindings raw intent invoicePayment cash componentId providerInvoiceLineRef providerInvoiceItemRef provenanceDigest manifest', ' ');
 source_keys text[]=string_to_array('freeholder_bootstrap_operation_id freeholder_bootstrap_request_digest freeholder_canonical_invoice_id freeholder_canonical_target_digest freeholder_controlled_accepted_quote_digest freeholder_controlled_collection_id freeholder_controlled_collection_policy freeholder_controlled_collection_protocol freeholder_controlled_collection_quote_digest freeholder_controlled_collection_quote_id freeholder_controlled_component freeholder_controlled_component_digest freeholder_controlled_component_id freeholder_controlled_component_kind freeholder_controlled_creator_operation_id freeholder_controlled_creator_request_digest freeholder_controlled_generation freeholder_controlled_item_operation_id freeholder_controlled_item_request_digest freeholder_controlled_price_epoch_id freeholder_controlled_product_operation_id freeholder_controlled_product_request_digest freeholder_controlled_subscription_version freeholder_controlled_transport freeholder_controlled_update_operation_id freeholder_controlled_update_request_digest freeholder_merchant_profile_id freeholder_merchant_profile_version freeholder_merchant_tax_quote_digest freeholder_platform_account_id freeholder_subscription_id freeholder_subscription_terms_id',' ');
 enums text[]=string_to_array('invoice payment_intent setup_intent charge refund dispute customer cash_balance credit_note subscription subscription_item line_item invoice_line_item price product invoice_payment application_fee transfer balance_transaction list draft open paid void uncollectible deleted issued succeeded pending failed canceled processing requires_payment_method requires_confirmation requires_action requires_capture incomplete incomplete_expired trialing active past_due unpaid paused charge_automatically send_invoice subscription_create subscription_cycle subscription_update manual automatic automatic_async manual_multiple automatic_preferred card not_requested unchanged flexible classic principal merchant_declared_tax_collection locked_canonical_credit net per_unit tiered recurring one_time exclusive inclusive unspecified licensed metered day week month year keep_as_draft mark_uncollectible subscription_details invoice_item_details subscription_item_details price_details fraudulent duplicate requested_by_customer abandoned expired order_change bank_account_unusable debit_not_authorized insufficient_funds customer_initiated merchant_initiated lost stolen credit product_unsatisfactory general unrecognized subscription_canceled credit_not_processed incorrect_account_details disputed warning_needs_response warning_under_review warning_closed needs_response under_review won available refund_failure transfer_cancel transfer_refund adjustment tax fee application_fee_refund transfer_reversal invoiceitem stripe review known_zero unverified canonical_merchant_tax_ledger preserve_original_end create_prorations none created_draft existing_generated zero_only_preparation draft_calendar canonical_gross_target_locked_credit_no_wallet controlled_net_gross.v1 exact_canonical_components.v1 2026-10-28.endive',' ');
BEGIN
 IF context IS NULL OR candidate IS NULL THEN RETURN false;END IF;
 kind=jsonb_typeof(candidate);
 IF context IN('raw','raw_product','result','authority') THEN
  IF kind IS DISTINCT FROM 'object' OR candidate->>'protocol'='controlled_historical_fin_reference.v1' THEN RETURN false;END IF;
  tag=candidate->'_freeholder_projection';
  IF jsonb_typeof(tag) IS DISTINCT FROM 'object' OR tag->>'protocol' IS DISTINCT FROM 'controlled_provider_safe_response.v1'
   OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(tag) key) IS DISTINCT FROM ARRAY['context','protocol','unknownFinancialPathCount','unknownFinancialPaths']::text[]
   OR NOT coalesce(tag->>'context'=ANY(string_to_array('createMerchantControlledBootstrap inspectMerchantControlledBootstrap pauseMerchantControlledBootstrap previewMerchantControlledProration previewMerchantControlledCalendarUpdate inspectMerchantControlledInvoice createMerchantControlledTaxProduct inspectMerchantControlledTaxProduct discoverMerchantControlledBootstrap updateMerchantControlledCalendar cancelMerchantControlledCalendar inspectMerchantControlledCalendar listMerchantControlledInvoices inspectMerchantControlledCustomerFinancials prepareMerchantControlledDraft addMerchantControlledComponent inspectMerchantControlledInvoiceManifest setMerchantControlledInvoiceFee finalizeMerchantControlledInvoice payMerchantControlledInvoice',' ')),false)
   OR jsonb_typeof(tag->'unknownFinancialPathCount') IS DISTINCT FROM 'number' OR NOT coalesce(tag->>'unknownFinancialPathCount'~'^[0-9]{1,16}$',false)
   OR jsonb_typeof(tag->'unknownFinancialPaths') IS DISTINCT FROM 'array' OR jsonb_array_length(tag->'unknownFinancialPaths')>65 THEN RETURN false;END IF;
  count_value=(tag->>'unknownFinancialPathCount')::numeric;
  IF count_value>9007199254740991 OR(count_value=0 AND jsonb_array_length(tag->'unknownFinancialPaths')<>0)
   OR(count_value>0 AND jsonb_array_length(tag->'unknownFinancialPaths')=0) OR(context='authority' AND count_value<>0) THEN RETURN false;END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(tag->'unknownFinancialPaths') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item) key) IS DISTINCT FROM ARRAY['path','reason']::text[]
    OR NOT coalesce(item->>'path'~'^(dispatch[1-9][0-9]{0,3}\.)?(response(\.f[0-9]{1,6}|\.m[0-9]{1,6}|\.c[0-9]{1,6}|\.i[0-9]{1,6})*|historical_result)$',false)
    OR NOT coalesce(item->>'reason' IN('unsupported_financial_shape','unsupported_financial_field','reserved_projection_collision','unknown_page_url','public_product_context_conflict','unknown_path_capacity_exceeded'),false) THEN RETURN false;END IF;
  END LOOP;
  IF count_value>64 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tag->'unknownFinancialPaths') debt WHERE debt->>'reason'='unknown_path_capacity_exceeded' AND debt->>'path'='response') THEN RETURN false;END IF;
 ELSIF context NOT IN('nested','metadata','currency_map') AND context NOT LIKE 'field:%' THEN RETURN false;END IF;
 IF kind='null' OR kind='boolean' THEN RETURN context NOT IN('raw','raw_product','result','authority');END IF;
 IF kind='number' THEN RETURN candidate::text~'^-?[0-9]{1,16}$' AND abs(candidate::text::numeric)<=9007199254740991;END IF;
 IF kind='string' THEN
  field_name=substring(context from 7);
  IF field_name='url' THEN RETURN candidate#>>'{}'~'^/v1/(subscriptions|invoices|invoice_payments|credit_notes|refunds|disputes|invoices/in_[A-Za-z0-9_]{1,196}/lines|charges/ch_[A-Za-z0-9_]{1,196}/refunds)$';END IF;
  IF field_name='unit_amount_decimal' THEN RETURN candidate#>>'{}'~'^-?[0-9]{1,16}(\.[0-9]{1,12})?$';END IF;
  RETURN coalesce(candidate#>>'{}'=ANY(enums) OR candidate#>>'{}'~'^(acct|cus|sub|in|upcoming_in|pi|seti|ch|re|dp|cn|cnli|il|inpay|ii|si|price|prod|fee|fr|tr|trr|txn|txr|txcd|di|cb|src|pm|sched)_[A-Za-z0-9_]{1,195}$'
   OR candidate#>>'{}'~'^[a-f0-9]{64}$' OR candidate#>>'{}'~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   OR candidate#>>'{}'~'^[A-Za-z]{3}$' OR candidate#>>'{}'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$',false);
 END IF;
 IF kind='array' THEN
  FOR child IN SELECT value FROM jsonb_array_elements(candidate) LOOP IF NOT freeholder_controlled_safe_response_valid(child,'nested') THEN RETURN false;END IF;END LOOP;
  RETURN true;
 END IF;
 IF kind IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 FOR entry IN SELECT key,value FROM jsonb_each(candidate) LOOP
  IF entry.key='_freeholder_projection' THEN
   IF context NOT IN('raw','raw_product','result','authority') AND NOT freeholder_controlled_safe_response_valid(candidate,'result') THEN RETURN false;END IF;
   CONTINUE;
  END IF;
  IF context='currency_map' THEN
   IF entry.key!~'^[a-z]{3}$' OR jsonb_typeof(entry.value) NOT IN('number','null') OR NOT freeholder_controlled_safe_response_valid(entry.value,'nested') THEN RETURN false;END IF;
   CONTINUE;
  END IF;
  IF context='metadata' THEN
   IF NOT(entry.key=ANY(source_keys)) OR(jsonb_typeof(entry.value)<>'null' AND jsonb_typeof(entry.value)<>'string')
    OR(jsonb_typeof(entry.value)='string' AND NOT(entry.value#>>'{}'~'^[0-9]{1,16}$') AND NOT freeholder_controlled_safe_response_valid(entry.value,'nested')) THEN RETURN false;END IF;
   CONTINUE;
  END IF;
  IF entry.key='name' THEN
   IF context<>'raw_product' OR jsonb_typeof(entry.value) IS DISTINCT FROM 'string' OR length(entry.value#>>'{}')>500 THEN RETURN false;END IF;
   CONTINUE;
  END IF;
  IF NOT(entry.key=ANY(allowed)) THEN RETURN false;END IF;
  IF NOT freeholder_controlled_safe_response_valid(entry.value,CASE WHEN entry.key='metadata' THEN 'metadata' WHEN entry.key IN('invoice_credit_balance','available') THEN 'currency_map' ELSE 'field:'||entry.key END) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint

-- Argument is the actual STORED call UUID. BEFORE INSERT checks NEW directly.
CREATE FUNCTION freeholder_controlled_safe_call_admissible(target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM subscription_controlled_calls actual_call
  JOIN subscription_controlled_operations actual_operation ON actual_operation.id=actual_call.operation_id
  JOIN subscription_controlled_resources actual_resource ON actual_resource.id=actual_operation.resource_id
  WHERE actual_call.id=target AND actual_call.admission->'payload'->>'responseProjectionProtocol'='controlled_provider_safe_response.v1'
   AND actual_call.admission->'payload'->>'callId'=actual_call.id::text
   AND actual_call.admission->'payload'->>'operationId'=actual_operation.id::text
   AND actual_call.admission->'payload'->>'resourceId'=actual_resource.id::text
   AND actual_call.admission->'payload'->>'requestDigest'=actual_operation.request_digest
   AND actual_call.admission->'payload'->>'kind'=actual_operation.kind
   AND actual_call.admission->>'kind'='admission' AND actual_call.admission->>'version'='1'
   AND actual_call.admission->'payload'->>'purpose'='subscription_controlled_provider_caller.v1');
$$;
--> statement-breakpoint

CREATE FUNCTION freeholder_controlled_safe_response_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
 EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_writer()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='9a49facb6f5fe26e2c9f78250b527acee1bf8e564e07644199a752280465ba05')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_operation_admissible(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='27487ae8447074e97ced587c666830211550469665a7e43953be4e5242219c23')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_zero_closure_valid(uuid,jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='322b251dc9fb99b1f3235aa9133b4e95affe8c2efe5690f04e743b49d20347d5')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_collection_writer()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='b32c7bd1f7c8f41838bde1f9ce66248bd299401a29a6b29bc84344f77cac2abc')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_target_operation_admissible(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='e1bd0ac38bbc11ddcc1d5ececa61644b474ff5266837c3c5908d386c816bad85')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_proration_source(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='5aaddf28a223fa95a2c5bc6dc592764b3689427e8481034b9369b72eb4689213')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_original_period_source(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='d21220f90b61edc681341120d39763739e8f121bdd0d613848f140ae7092fab3')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_collection_inventory(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='0b037994a1225c1ca4d6d9f33c71888a2d518a6e67ba35793121d0383969ac93')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_cash_application_shape(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='027064eb6d584f33c68dee5e671d2184affa381d9673fcd0706a467839c9929e')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_cash_bank_invoice(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='924bc14757d4a81109e06e151f5aee93678bdd2274e927bbbfd56e7ba2e41bcd')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_receipt_bank_observation(uuid,uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='c3602be822c07bbb6c3fda64ef3f112b8f9e3d94f7203a3f5a25eb4335ad7995')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_prepost_bank(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='cc411ba4d6fb3dad97e075a5db65c0b5557e1aa1f438bf4666360391b4ef8377')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_subscription_route_ready()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='55c849934e6ac3a5dc74e567450179447cbe40dbd235678da959ff81d2d86731')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_ready()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='6e9efda50f54615516ea2af80aba2ed14fca509d029e3343ec5b7297c9b203d1')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_safe_response_valid(jsonb,text)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='22217c75d63fdf49d79e127e5f7389e72d849c2a5fdef147d215d2fead10c954')
  AND  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_safe_call_admissible(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='b3d0221bc314360f19b2f3dacc35ba470190e0c17c688c1fc2943ba1c9065337')
  AND (SELECT count(*) FROM pg_trigger installed WHERE installed.tgfoid=to_regprocedure('freeholder_controlled_writer()') AND installed.tgenabled IN('O','A') AND installed.tgtype=31 AND NOT installed.tgisinternal AND(installed.tgrelid,installed.tgname) IN((to_regclass('subscription_controlled_resources'),'subscription_controlled_resources_guard'),(to_regclass('subscription_controlled_operations'),'subscription_controlled_operations_guard'),(to_regclass('subscription_controlled_calls'),'subscription_controlled_calls_guard'),(to_regclass('subscription_controlled_facts'),'subscription_controlled_facts_guard'),(to_regclass('subscription_controlled_finishes'),'subscription_controlled_finishes_guard'),(to_regclass('subscription_controlled_stops'),'subscription_controlled_stops_guard'),(to_regclass('subscription_controlled_verifications'),'subscription_controlled_verifications_guard'),(to_regclass('subscription_controlled_closures'),'subscription_controlled_closures_guard')))=8,false);
$$;
--> statement-breakpoint
-- BEGIN FULL SAFE-RESPONSE SUCCESSORS
CREATE OR REPLACE FUNCTION freeholder_controlled_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;o subscription_controlled_operations%ROWTYPE;c subscription_controlled_calls%ROWTYPE;
 parent subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;scope subscription_merchant_scopes%ROWTYPE;method payment_methods%ROWTYPE;
 original jsonb;payload jsonb;body jsonb;last_ordinal integer;resource_uuid uuid;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.controlled_provider_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original controlled resources, operations, callers, raw facts and distinct finish/stop/verification/closure receipts are immutable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_resources' THEN
  SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id FOR UPDATE;
  SELECT * INTO t FROM subscription_commercial_terms WHERE id=NEW.terms_id;
  SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
  SELECT * INTO method FROM payment_methods WHERE id=parent.payment_method_id;
  IF parent.id IS NULL OR parent.provider IS DISTINCT FROM 'stripe' OR parent.billing_mode IS DISTINCT FROM 'provider' OR parent.merchant_scope_version<>1 OR t.subscription_id IS DISTINCT FROM parent.id OR scope.subscription_id IS NULL OR NEW.generation<>1 OR parent.provider_schedule_ref_v1 IS NOT NULL
   OR NEW.original_scope->>'subscriptionId' IS DISTINCT FROM parent.id::text OR NEW.original_scope->>'termsId' IS DISTINCT FROM t.id::text OR NEW.original_scope->>'generation' IS DISTINCT FROM NEW.generation::text
   OR NEW.original_scope->>'providerApiVersion' IS DISTINCT FROM '2026-10-28.endive' OR NEW.original_scope->>'providerPlatformAccountId' IS DISTINCT FROM scope.provider_platform_account_id
   OR (scope.charge_account_id IS NULL AND (NEW.original_scope->>'destinationAccountId' IS DISTINCT FROM scope.recipient_account_id OR NEW.original_scope->>'settlementMerchantAccountId' IS DISTINCT FROM scope.settlement_merchant_account_id))
   OR (scope.charge_account_id IS NOT NULL AND (NEW.original_scope ? 'destinationAccountId' OR NEW.original_scope ? 'settlementMerchantAccountId'))
   OR coalesce(NEW.original_scope->>'providerAccountId','') IS DISTINCT FROM coalesce(scope.charge_account_id,'') OR NEW.original_scope->>'currency' IS DISTINCT FROM parent.currency
   OR method.status IS DISTINCT FROM 'active' OR method.provider IS DISTINCT FROM 'stripe' OR method.contact_id IS DISTINCT FROM parent.contact_id
   OR NEW.original_scope->>'providerMethodRef' IS DISTINCT FROM method.provider_method_ref OR NEW.original_scope->>'providerCustomerRef' IS DISTINCT FROM method.provider_customer_ref
   OR coalesce(NEW.original_scope->>'providerAccountId','') IS DISTINCT FROM method.provider_account_id OR NEW.original_scope->>'providerPlatformAccountId' IS DISTINCT FROM method.provider_platform_account_id
   OR NEW.original_scope->>'acceptedPeriodEnd' IS NULL OR (NEW.original_scope->>'acceptedPeriodEnd')::timestamptz IS DISTINCT FROM parent.current_period_end
   OR nullif(NEW.original_scope->>'acceptedTrialEnd','')::timestamptz IS DISTINCT FROM parent.trial_ends_at
   OR EXISTS(SELECT 1 FROM subscription_provider_generations WHERE subscription_id=parent.id)
   OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations WHERE subscription_id=parent.id AND original_request->>'resourceKind' IS DISTINCT FROM 'phase_product')
   OR NOT freeholder_subscription_resumption_callers_closed(parent.id) THEN
   RAISE EXCEPTION 'Retain only actual original uncreated-calendar terms, method, namespace and application calendar; no old paid generation may be replaced by a zero bootstrap' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='subscription_controlled_operations' THEN resource_uuid=NEW.resource_id;
 ELSIF TG_TABLE_NAME='subscription_controlled_calls' THEN SELECT resource_id INTO resource_uuid FROM subscription_controlled_operations WHERE id=NEW.operation_id;
 ELSIF TG_TABLE_NAME='subscription_controlled_facts' THEN SELECT op.resource_id INTO resource_uuid FROM subscription_controlled_calls ticket JOIN subscription_controlled_operations op ON op.id=ticket.operation_id WHERE ticket.id=NEW.call_id;
 ELSIF TG_TABLE_NAME IN('subscription_controlled_finishes','subscription_controlled_stops','subscription_controlled_verifications') THEN
  SELECT op.resource_id INTO resource_uuid FROM subscription_controlled_calls ticket JOIN subscription_controlled_operations op ON op.id=ticket.operation_id WHERE ticket.id=NEW.call_id;
 ELSE resource_uuid=NEW.resource_id;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('controlled-provider:'||resource_uuid::text));
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=resource_uuid FOR UPDATE;
 IF r.id IS NULL OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id) THEN
  RAISE EXCEPTION 'A missing or genuinely closed original resource cannot acquire another operation, caller or replacement fact' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_operations' THEN
  SELECT coalesce(max(ordinal),0) INTO last_ordinal FROM subscription_controlled_operations WHERE resource_id=r.id;
  SELECT * INTO t FROM subscription_commercial_terms WHERE id=r.terms_id;
  IF NEW.ordinal<>last_ordinal+1 OR NEW.accepted_quote_digest IS DISTINCT FROM t.accepted_quote_digest
   OR NOT coalesce(NEW.original_request->>'scopeDigest' ~ '^[a-f0-9]{64}$',false) OR jsonb_typeof(NEW.original_request->'payload') IS DISTINCT FROM 'object'
   OR NOT freeholder_controlled_callers_closed(r.id) OR octet_length(NEW.original_request::text)>256000 THEN
   RAISE EXCEPTION 'Every exact next controlled request retains the whole original revision and all older actual callers; a newer row cannot supersede an outstanding invocation' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_calls' THEN
  SELECT * INTO o FROM subscription_controlled_operations WHERE id=NEW.operation_id;body=NEW.admission;payload=body->'payload';
  IF payload->>'responseProjectionProtocol' IS DISTINCT FROM 'controlled_provider_safe_response.v1' OR NOT freeholder_controlled_operation_admissible(o.id) OR body->>'version' IS DISTINCT FROM '1' OR body->>'kind' IS DISTINCT FROM 'admission'
   OR payload->>'purpose' IS DISTINCT FROM 'subscription_controlled_provider_caller.v1' OR payload->>'operationId' IS DISTINCT FROM o.id::text
   OR payload->>'callId' IS DISTINCT FROM NEW.id::text OR payload->>'resourceId' IS DISTINCT FROM r.id::text OR payload->>'kind' IS DISTINCT FROM o.kind
   OR payload->>'requestDigest' IS DISTINCT FROM o.request_digest OR payload->>'admittedSourceRevision' IS DISTINCT FROM o.previous_evidence_revision
   OR payload->'caller'->>'id' IS DISTINCT FROM payload->>'callerId' OR NOT coalesce(payload->>'callerId' ~ '^[a-f0-9-]{36}$',false)
   OR NOT coalesce(payload->'caller'->>'pid' ~ '^[1-9][0-9]*$',false) OR NOT coalesce(payload->>'completionDigest' ~ '^[a-f0-9]{64}$',false)
   OR NOT coalesce(body->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(body->>'publicKey') BETWEEN 40 AND 2000,false) THEN
   RAISE EXCEPTION 'Only this current exact operation and actual signed original process/nonce can admit one physical caller' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_facts' THEN
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
  SELECT coalesce(max(ordinal),0) INTO last_ordinal FROM subscription_controlled_facts WHERE call_id=c.id;
  SELECT * INTO o FROM subscription_controlled_operations WHERE id=c.operation_id;
  IF NOT freeholder_controlled_safe_call_admissible(c.id)
   OR NEW.actual->'raw'->'_freeholder_projection'->>'context' IS DISTINCT FROM (CASE o.kind WHEN 'bootstrap' THEN 'createMerchantControlledBootstrap' WHEN 'discover_bootstrap' THEN 'discoverMerchantControlledBootstrap' WHEN 'read_bootstrap' THEN 'inspectMerchantControlledBootstrap' WHEN 'pause_drafts' THEN 'pauseMerchantControlledBootstrap' WHEN 'read_invoice' THEN 'inspectMerchantControlledInvoice' WHEN 'read_customer_financials' THEN 'inspectMerchantControlledCustomerFinancials' WHEN 'list_invoices' THEN 'listMerchantControlledInvoices' WHEN 'read_calendar' THEN 'inspectMerchantControlledCalendar' WHEN 'cancel_calendar' THEN 'cancelMerchantControlledCalendar' WHEN 'create_product' THEN 'createMerchantControlledTaxProduct' WHEN 'read_product' THEN 'inspectMerchantControlledTaxProduct' WHEN 'preview_proration' THEN 'previewMerchantControlledProration' WHEN 'preview_update' THEN 'previewMerchantControlledCalendarUpdate' WHEN 'update_calendar' THEN 'updateMerchantControlledCalendar' WHEN 'create_draft' THEN 'prepareMerchantControlledDraft' WHEN 'add_invoice_component' THEN 'addMerchantControlledComponent' WHEN 'read_manifest' THEN 'inspectMerchantControlledInvoiceManifest' WHEN 'set_invoice_fee' THEN 'setMerchantControlledInvoiceFee' WHEN 'finalize_invoice' THEN 'finalizeMerchantControlledInvoice' WHEN 'pay_invoice' THEN 'payMerchantControlledInvoice' END)
   OR(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.actual) key) IS DISTINCT FROM ARRAY['kind','raw']::text[]
   OR NOT freeholder_controlled_safe_response_valid(NEW.actual->'raw',CASE WHEN NEW.actual->>'kind' IN('product_created','product_read') THEN 'raw_product' ELSE 'raw' END) THEN
   RAISE EXCEPTION 'Retain only this original new caller safe response; preserve rejected caller debt and recover by an actual new observation' USING ERRCODE='23514';END IF;
  IF NEW.actual->>'kind' IN('product_created','product_read') AND NEW.actual->'raw' ? 'name' THEN
   SELECT * INTO o FROM subscription_controlled_operations WHERE id=c.operation_id;
   IF o.kind NOT IN('create_product','read_product') OR NEW.actual->'raw'->>'name' IS DISTINCT FROM o.original_request->'payload'->>'name'
    OR NEW.actual->'raw'->'metadata'->>'freeholder_controlled_component' IS DISTINCT FROM 'merchant_declared_tax_collection'
    OR NEW.actual->'raw'->'metadata'->>'freeholder_platform_account_id' IS DISTINCT FROM r.original_scope->>'providerPlatformAccountId'
    OR NEW.actual->'raw'->'metadata'->>'freeholder_controlled_product_operation_id' IS DISTINCT FROM (CASE WHEN o.kind='create_product' THEN o.id::text ELSE o.original_request->'payload'->>'originalProductOperationId' END)
    OR NEW.actual->'raw'->'metadata'->>'freeholder_controlled_product_request_digest' IS DISTINCT FROM (CASE WHEN o.kind='create_product' THEN o.request_digest ELSE o.original_request->'payload'->>'originalProductRequestDigest' END) THEN
    RAISE EXCEPTION 'Only the exact originally admitted canonical public product name may be retained' USING ERRCODE='23514';END IF;
  END IF;
  IF c.id IS NULL OR NEW.ordinal<>last_ordinal+1 OR EXISTS(SELECT 1 FROM subscription_controlled_finishes WHERE call_id=c.id)
   OR EXISTS(SELECT 1 FROM subscription_controlled_stops WHERE call_id=c.id) OR octet_length(NEW.actual::text)>256000
   OR NOT coalesce(NEW.actual->>'kind' IN('bootstrap_subscription','pause_subscription','subscription_read','invoice_read','proration_preview','intent_read','cash_observed','invoice_payments_read','invoice_lines_read','price_read','product_created','product_read','subscription_list_read','calendar_updated','calendar_canceled','invoice_list_read','customer_financial_read','customer_credit_notes_read','controlled_draft_created','controlled_item_created','controlled_invoice_updated','controlled_invoice_finalized','controlled_invoice_paid'),false)
   OR jsonb_typeof(NEW.actual->'raw') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Only an actual unfinished, unstopped original caller can retain its next bounded raw occurrence; late callbacks remain refused' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_verifications' THEN
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
  IF c.operation_id IS DISTINCT FROM NEW.operation_id OR NOT EXISTS(SELECT 1 FROM subscription_controlled_finishes f WHERE f.call_id=c.id
   AND f.actual_result->>'outcome'='returned' AND((f.actual_result->'result'=NEW.actual_result AND freeholder_controlled_safe_call_admissible(c.id) AND freeholder_controlled_safe_response_valid(NEW.actual_result,'result')) OR (NEW.actual_result->>'protocol'='controlled_historical_fin_reference.v1'
    AND c.admission->'payload'->>'responseProjectionProtocol' IS DISTINCT FROM 'controlled_provider_safe_response.v1'
    AND NEW.actual_result->>'operationId'=c.operation_id::text AND NEW.actual_result->>'callId'=c.id::text AND NEW.actual_result->>'finishCallId'=f.call_id::text
    AND NEW.actual_result->>'originalFinishPgSha256'=encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex')
    AND NEW.actual_result->>'originalFramePgSha256'=encode(sha256(convert_to(f.actual_result::text,'UTF8')),'hex')
    AND NEW.actual_result->>'originalResultPgSha256'=encode(sha256(convert_to((f.actual_result->'result')::text,'UTF8')),'hex')
    AND NEW.actual_result->>'originalSignedFrameDigest'=f.proof->'payload'->>'factsDigest'
    AND coalesce(NEW.actual_result->>'originalSdkResultDigest','')~'^[a-f0-9]{64}$'
    AND coalesce(NEW.actual_result->>'safeViewDigest','')~'^[a-f0-9]{64}$'
    AND NEW.actual_result->>'safeViewPgSha256'=encode(sha256(convert_to((NEW.actual_result->'safeView')::text,'UTF8')),'hex')
    AND freeholder_controlled_safe_response_valid(NEW.actual_result->'safeView','result')
    AND(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.actual_result) key)=ARRAY['callId','finishCallId','operationId','originalFinishPgSha256','originalFramePgSha256','originalResultPgSha256','originalSdkResultDigest','originalSignedFrameDigest','proof','protocol','safeView','safeViewDigest','safeViewPgSha256']::text[]
    AND(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.actual_result->'proof') key)=ARRAY['authentication','createdAt','digest']::text[]
    AND coalesce(NEW.actual_result->'proof'->>'authentication','')~'^[a-f0-9]{64}$' AND coalesce(NEW.actual_result->'proof'->>'digest','')~'^[a-f0-9]{64}$'
    AND coalesce(NEW.actual_result->'proof'->>'createdAt','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'))) THEN
   RAISE EXCEPTION 'A result projection must copy the exact actual returned SDK result, never operator replacement evidence or a stop review' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_closures' THEN
  IF NOT freeholder_controlled_zero_closure_valid(NEW.resource_id,NEW.proof) OR NEW.original_evidence_revision IS DISTINCT FROM NEW.proof->>'originalEvidenceRevision' THEN
   RAISE EXCEPTION 'Actual canceled zero transport requires complete terminal zero-invoice inventory; unknown callers, cash or drafts cannot be forgiven' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;SELECT * INTO o FROM subscription_controlled_operations WHERE id=c.operation_id;
  original=c.admission->'payload';body=NEW.proof;payload=body->'payload';
  IF c.id IS NULL OR body->>'version' IS DISTINCT FROM '1' OR payload->>'purpose' IS DISTINCT FROM 'subscription_controlled_provider_caller.v1'
   OR payload->>'callId' IS DISTINCT FROM c.id::text OR payload->>'operationId' IS DISTINCT FROM o.id::text OR payload->>'resourceId' IS DISTINCT FROM r.id::text
   OR payload->>'requestDigest' IS DISTINCT FROM o.request_digest OR payload->>'admissionDigest' IS DISTINCT FROM c.admission_digest OR payload->>'callerId' IS DISTINCT FROM original->>'callerId'
   OR NOT coalesce(body->>'signature' ~ '^[A-Za-z0-9_-]{86}$',false) OR NOT coalesce(length(body->>'publicKey') BETWEEN 40 AND 2000,false) THEN
   RAISE EXCEPTION 'Retain this exact original signed caller, request and admission without substituting another invocation' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='subscription_controlled_finishes' THEN
   IF NOT freeholder_controlled_safe_call_admissible(c.id)
    OR(NEW.actual_result->>'outcome'='returned' AND NEW.actual_result->'result'->'_freeholder_projection'->>'context' IS DISTINCT FROM (CASE o.kind WHEN 'bootstrap' THEN 'createMerchantControlledBootstrap' WHEN 'discover_bootstrap' THEN 'discoverMerchantControlledBootstrap' WHEN 'read_bootstrap' THEN 'inspectMerchantControlledBootstrap' WHEN 'pause_drafts' THEN 'pauseMerchantControlledBootstrap' WHEN 'read_invoice' THEN 'inspectMerchantControlledInvoice' WHEN 'read_customer_financials' THEN 'inspectMerchantControlledCustomerFinancials' WHEN 'list_invoices' THEN 'listMerchantControlledInvoices' WHEN 'read_calendar' THEN 'inspectMerchantControlledCalendar' WHEN 'cancel_calendar' THEN 'cancelMerchantControlledCalendar' WHEN 'create_product' THEN 'createMerchantControlledTaxProduct' WHEN 'read_product' THEN 'inspectMerchantControlledTaxProduct' WHEN 'preview_proration' THEN 'previewMerchantControlledProration' WHEN 'preview_update' THEN 'previewMerchantControlledCalendarUpdate' WHEN 'update_calendar' THEN 'updateMerchantControlledCalendar' WHEN 'create_draft' THEN 'prepareMerchantControlledDraft' WHEN 'add_invoice_component' THEN 'addMerchantControlledComponent' WHEN 'read_manifest' THEN 'inspectMerchantControlledInvoiceManifest' WHEN 'set_invoice_fee' THEN 'setMerchantControlledInvoiceFee' WHEN 'finalize_invoice' THEN 'finalizeMerchantControlledInvoice' WHEN 'pay_invoice' THEN 'payMerchantControlledInvoice' END))
    OR(NEW.actual_result->>'outcome'='returned' AND((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.actual_result) key) IS DISTINCT FROM ARRAY['outcome','result']::text[] OR NOT freeholder_controlled_safe_response_valid(NEW.actual_result->'result','result')))
    OR(NEW.actual_result->>'outcome'='threw' AND NEW.actual_result<>'{"outcome":"threw"}'::jsonb) THEN
    RAISE EXCEPTION 'Unsafe old callbacks cannot invent a projected result or new FIN; retain actual unresolved caller debt' USING ERRCODE='23514';END IF;
   IF body->>'kind' IS DISTINCT FROM 'finish' OR body->>'publicKey' IS DISTINCT FROM c.admission->>'publicKey'
    OR payload->>'completionDigest' IS DISTINCT FROM original->>'completionDigest' OR NOT coalesce(payload->>'outcome' IN('returned','threw'),false)
    OR payload->>'outcome' IS DISTINCT FROM NEW.actual_result->>'outcome' OR NOT coalesce(payload->>'factsDigest' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_controlled_stops WHERE call_id=c.id) THEN
    RAISE EXCEPTION 'Only the actual unstopped original process signs its real returned/thrown SDK finish' USING ERRCODE='23514';END IF;
  ELSE
   IF body->>'kind' IS DISTINCT FROM 'stop_review' OR payload->'originalAdmission' IS DISTINCT FROM c.admission OR NOT coalesce(payload->>'reviewedBy' ~ '^user:[a-f0-9-]{36}$',false)
    OR NOT coalesce(payload->>'mechanicalCheck' IN('original_process_absent','unobservable_host_review'),false)
    OR NOT coalesce(payload->>'hostingEvidenceDigest' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(payload->>'currentEvidenceRevision' ~ '^[a-f0-9]{64}$',false)
    OR EXISTS(SELECT 1 FROM subscription_controlled_finishes WHERE call_id=c.id) THEN
    RAISE EXCEPTION 'Independent fresh human runtime evidence releases the exact absent original caller; it never invents a bank finish' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;bootstrap subscription_controlled_operations%ROWTYPE;
 payload jsonb;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;payload=o.original_request->'payload';
 IF o.id IS NULL OR r.id IS NULL OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal)
  OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR NOT freeholder_controlled_callers_closed(r.id) THEN RETURN false;END IF;
 IF o.kind='bootstrap' THEN
  RETURN o.ordinal=1 AND payload='{}'::jsonb AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='bootstrap' AND id<>o.id)
   AND coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
   AND EXISTS(SELECT 1 FROM subscriptions p JOIN module_settings m ON m.module='subscriptions' AND m.enabled WHERE p.id=r.subscription_id AND p.status IN('active','trialing') AND p.cancelled_at IS NULL AND NOT p.cancel_at_period_end)
   AND freeholder_subscription_resumption_callers_closed(r.subscription_id);
 END IF;
 SELECT * INTO bootstrap FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='bootstrap';
 IF bootstrap.id IS NULL THEN RETURN false;END IF;
 IF o.kind='create_product' THEN
  RETURN payload->>'component'='merchant_declared_tax_collection' AND length(payload->>'name') BETWEEN 1 AND 500
   AND coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND kind='create_product' AND id<>o.id)
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
    WHERE prior.resource_id=r.id AND prior.kind='read_bootstrap' AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'collectionPausedAsDraft'='true');
 END IF;
 IF payload->>'bootstrapOperationId' IS DISTINCT FROM bootstrap.id::text OR payload->>'bootstrapRequestDigest' IS DISTINCT FROM bootstrap.request_digest THEN RETURN false;END IF;
 IF o.kind='discover_bootstrap' THEN RETURN true;END IF;
 IF o.kind='read_product' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_operations creator JOIN subscription_controlled_calls c ON c.operation_id=creator.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   WHERE creator.resource_id=r.id AND creator.kind='create_product' AND creator.id::text=payload->>'originalProductOperationId'
    AND creator.request_digest=payload->>'originalProductRequestDigest' AND f.actual->>'kind'='product_created'
    AND f.actual->'raw'->>'id'=payload->>'createdProductRef' AND creator.original_request->'payload'->>'name'=payload->>'name');
 END IF;
 IF NOT coalesce(payload->>'providerSubscriptionRef' ~ '^sub_[A-Za-z0-9_]{1,195}$',false) OR NOT EXISTS(
  SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_calls c ON c.operation_id=prior.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE prior.resource_id=r.id AND ((prior.id=bootstrap.id AND f.actual->>'kind'='bootstrap_subscription' AND f.actual->'raw'->>'id'=payload->>'providerSubscriptionRef')
   OR(prior.kind='discover_bootstrap' AND f.actual->>'kind'='subscription_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) item
    WHERE item->>'id'=payload->>'providerSubscriptionRef' AND item->'metadata'->>'freeholder_bootstrap_operation_id'=bootstrap.id::text AND item->'metadata'->>'freeholder_bootstrap_request_digest'=bootstrap.request_digest)))) THEN RETURN false;END IF;
 IF o.kind IN('read_bootstrap','read_calendar','read_customer_financials','list_invoices','cancel_calendar') THEN RETURN true;END IF;
 IF o.kind IN('preview_proration','preview_update','update_calendar','create_draft','add_invoice_component','read_manifest','set_invoice_fee','finalize_invoice','pay_invoice') THEN RETURN freeholder_controlled_target_operation_admissible(o.id);END IF;
 IF o.kind='pause_drafts' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
   WHERE prior.resource_id=r.id AND prior.kind='read_bootstrap' AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=payload->>'providerSubscriptionRef');
 END IF;
 IF o.kind='read_invoice' THEN
  RETURN coalesce(payload->>'providerInvoiceRef' ~ '^in_[A-Za-z0-9_]{1,196}$',false) AND EXISTS(
   SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_calls c ON c.operation_id=prior.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   WHERE prior.resource_id=r.id AND (f.actual->'raw'->>'latest_invoice'=payload->>'providerInvoiceRef'
    OR f.actual->'raw'->'latest_invoice'->>'id'=payload->>'providerInvoiceRef'
    OR(f.actual->>'kind' IN('invoice_read','controlled_draft_created') AND f.actual->'raw'->>'id'=payload->>'providerInvoiceRef')
    OR(f.actual->>'kind'='invoice_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) item WHERE item->>'id'=payload->>'providerInvoiceRef'))));
 END IF;
 RETURN false;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_zero_closure_valid(target uuid,proof jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;calendar subscription_controlled_verifications%ROWTYPE;inventory subscription_controlled_verifications%ROWTYPE;
 calendar_op subscription_controlled_operations%ROWTYPE;list_op subscription_controlled_operations%ROWTYPE;item jsonb;actual jsonb;known_count integer;
BEGIN
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=target;
 IF EXISTS(SELECT 1 FROM subscription_controlled_facts actual_fact JOIN subscription_controlled_calls actual_call ON actual_call.id=actual_fact.call_id JOIN subscription_controlled_operations actual_operation ON actual_operation.id=actual_call.operation_id WHERE actual_operation.resource_id=target AND actual_fact.actual->'raw' ? '_freeholder_projection' AND NOT freeholder_controlled_safe_response_valid(actual_fact.actual->'raw','authority')) THEN RETURN false;END IF;
 IF r.id IS NULL OR proof->>'kind' IS DISTINCT FROM 'zero_transport' OR NOT freeholder_controlled_callers_closed(target)
  OR EXISTS(SELECT 1 FROM subscription_controlled_charge_origins WHERE resource_id=target)
  OR (SELECT count(*) FROM subscription_controlled_operations WHERE resource_id=target AND kind='bootstrap')<>1
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=target AND kind NOT IN('bootstrap','discover_bootstrap','read_bootstrap','pause_drafts','read_invoice','read_customer_financials','preview_proration','preview_update','read_calendar','list_invoices','cancel_calendar','create_product','read_product'))
  OR EXISTS(SELECT 1 FROM subscription_controlled_collections c JOIN subscription_controlled_quotes q ON q.id=c.quote_id WHERE q.resource_id=target)
  OR jsonb_typeof(proof->'invoices') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations op WHERE op.resource_id=target AND op.kind='read_customer_financials')
  AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority') WHERE op.resource_id=target AND op.kind='read_customer_financials'
   AND v.actual_result->>'balanceState'='known_zero' AND v.actual_result->>'completeCreditNotes'='true') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_calls c ON c.operation_id=op.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE op.resource_id=target AND((f.actual->>'kind'='customer_financial_read' AND(f.actual->'raw'->>'id' IS DISTINCT FROM r.original_scope->>'providerCustomerRef' OR f.actual->'raw'->>'balance' IS DISTINCT FROM '0'
    OR jsonb_typeof(f.actual->'raw'->'invoice_credit_balance') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(f.actual->'raw'->'invoice_credit_balance') balance WHERE balance.value<>'0'::jsonb)
    OR(f.actual->'raw'->'cash_balance' IS DISTINCT FROM 'null'::jsonb AND(freeholder_controlled_ref(f.actual->'raw'->'cash_balance'->'customer') IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
     OR jsonb_typeof(f.actual->'raw'->'cash_balance'->'available') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(f.actual->'raw'->'cash_balance'->'available') balance WHERE balance.value<>'0'::jsonb)))))
   OR(f.actual->>'kind'='customer_credit_notes_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(f.actual->'raw'->'data') note WHERE note->>'status'='issued' AND note->>'amount' IS DISTINCT FROM '0')))) THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT entry->>'providerInvoiceRef') FROM jsonb_array_elements(proof->'invoices') entry)<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 SELECT * INTO calendar FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'calendarReadOperationId' AND freeholder_controlled_safe_call_admissible(call_id) AND freeholder_controlled_safe_response_valid(actual_result,'authority');
 SELECT * INTO inventory FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'invoiceListOperationId' AND freeholder_controlled_safe_call_admissible(call_id) AND freeholder_controlled_safe_response_valid(actual_result,'authority');
 SELECT * INTO calendar_op FROM subscription_controlled_operations WHERE id=calendar.operation_id;
 SELECT * INTO list_op FROM subscription_controlled_operations WHERE id=inventory.operation_id;
 IF calendar_op.resource_id IS DISTINCT FROM r.id OR list_op.resource_id IS DISTINCT FROM r.id OR calendar_op.kind IS DISTINCT FROM 'read_calendar'
  OR list_op.kind IS DISTINCT FROM 'list_invoices' OR list_op.ordinal<=calendar_op.ordinal OR calendar.actual_result->>'calendarCanceled' IS DISTINCT FROM 'true'
  OR calendar.actual_result_digest IS DISTINCT FROM proof->>'calendarResultDigest' OR inventory.actual_result_digest IS DISTINCT FROM proof->>'invoiceListResultDigest'
  OR inventory.actual_result->>'complete' IS DISTINCT FROM 'true' OR calendar.actual_result->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
  OR inventory.actual_result->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
  OR jsonb_typeof(inventory.actual_result->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_array_length(inventory.actual_result->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 -- No old actual positive occurrence can disappear just because a later list
 -- is empty or its ordinary canonical application never committed.
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE o.resource_id=target AND ((f.actual->>'kind'='cash_observed') OR(f.actual->>'kind'='intent_read' AND f.actual->'raw'->>'amount_received' IS DISTINCT FROM '0')
   OR(f.actual->>'kind'='invoice_read' AND (f.actual->'raw'->>'amount_paid' IS DISTINCT FROM '0' OR f.actual->'raw'->>'total' IS DISTINCT FROM '0'))
   OR(f.actual->>'kind'='invoice_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) entry
    WHERE entry->>'amount_paid' IS DISTINCT FROM '0' OR entry->>'total' IS DISTINCT FROM '0')))) THEN RETURN false;END IF;
 SELECT count(DISTINCT id) INTO known_count FROM (
  SELECT freeholder_controlled_ref(f.actual->'raw'->'latest_invoice') AS id
   FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id WHERE o.resource_id=target AND f.actual->'raw'->'latest_invoice' IS NOT NULL AND f.actual->'raw'->'latest_invoice'<>'null'::jsonb
  UNION ALL SELECT f.actual->'raw'->>'id' FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id WHERE o.resource_id=target AND f.actual->>'kind'='invoice_read'
  UNION ALL SELECT entry->>'id' FROM subscription_controlled_operations o JOIN subscription_controlled_calls c ON c.operation_id=o.id JOIN subscription_controlled_facts f ON f.call_id=c.id
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.actual->'raw'->'data','[]'::jsonb)) entry WHERE o.resource_id=target AND f.actual->>'kind'='invoice_list_read'
 ) known;
 IF known_count<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(proof->'invoices') LOOP
  SELECT v.actual_result INTO actual FROM subscription_controlled_verifications v JOIN subscription_controlled_operations o ON o.id=v.operation_id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
   WHERE v.operation_id::text=item->>'readOperationId' AND o.resource_id=target AND o.kind='read_invoice' AND o.ordinal>list_op.ordinal AND v.actual_result_digest=item->>'resultDigest';
  IF actual IS NULL OR actual->>'providerInvoiceRef' IS DISTINCT FROM item->>'providerInvoiceRef' OR actual->>'providerSubscriptionRef' IS DISTINCT FROM proof->>'providerSubscriptionRef'
   OR NOT inventory.actual_result->'providerInvoiceRefs' @> jsonb_build_array(item->>'providerInvoiceRef')
   OR actual->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR NOT coalesce(actual->>'status' IN('paid','void'),false)
   OR actual->>'totalMinor' IS DISTINCT FROM '0' OR actual->>'paidMinor' IS DISTINCT FROM '0' OR actual->>'remainingMinor' IS DISTINCT FROM '0' OR actual->>'autoAdvance' IS DISTINCT FROM 'false'
   OR actual->>'completePayments' IS DISTINCT FROM 'true' OR actual->>'completeLines' IS DISTINCT FROM 'true' OR actual->'actualCash' IS DISTINCT FROM '[]'::jsonb
   OR actual->'actualInvoice'->>'starting_balance' IS DISTINCT FROM '0' OR actual->'actualInvoice'->>'ending_balance' IS DISTINCT FROM '0'
   OR actual->'actualInvoice'->>'post_payment_credit_notes_amount' IS DISTINCT FROM '0' OR actual->'actualInvoice'->>'pre_payment_credit_notes_amount' IS DISTINCT FROM '0'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualIntents') intent WHERE intent->>'status' IS DISTINCT FROM 'canceled' OR intent->>'amount_received' IS DISTINCT FROM '0')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0') THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_collection_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource_uuid uuid;collection_uuid uuid;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;
 o subscription_controlled_operations%ROWTYPE;creator subscription_controlled_operations%ROWTYPE;c subscription_controlled_calls%ROWTYPE;f subscription_controlled_facts%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='subscription_controlled_quotes' AND TG_OP='UPDATE' THEN
  -- Only a genuinely closed unaccepted zero-resource review can erase its
  -- private body in this first source boundary. Positive-target closure and
  -- its privacy receipt remain required before that separate path can erase.
  IF current_setting('freeholder.controlled_collection_privacy_v1',true)='1' AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
   AND NEW.input IS NULL AND NEW.review IS NULL AND(to_jsonb(NEW)-ARRAY['input','review','redacted_at'])=(to_jsonb(OLD)-ARRAY['input','review','redacted_at'])
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_collections WHERE quote_id=OLD.id)
   AND EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=OLD.resource_id AND kind='zero_transport') THEN RETURN NEW;END IF;
 END IF;
 IF TG_OP<>'INSERT' OR current_setting('freeholder.controlled_collection_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original controlled quote/economic acceptance/component/creator/item/read receipts are immutable; privacy needs actual original financial closure' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_quotes' THEN resource_uuid=NEW.resource_id;
 ELSIF TG_TABLE_NAME='subscription_controlled_collections' THEN SELECT resource_id INTO resource_uuid FROM subscription_controlled_quotes WHERE id=NEW.quote_id;collection_uuid=NEW.id;
 ELSIF TG_TABLE_NAME='subscription_controlled_item_receipts' THEN
  SELECT x.collection_id INTO collection_uuid FROM subscription_controlled_components x WHERE x.id=NEW.component_id;
  SELECT q0.resource_id INTO resource_uuid FROM subscription_controlled_collections c0 JOIN subscription_controlled_quotes q0 ON q0.id=c0.quote_id WHERE c0.id=collection_uuid;
 ELSE collection_uuid=NEW.collection_id;
  SELECT q0.resource_id INTO resource_uuid FROM subscription_controlled_collections c0 JOIN subscription_controlled_quotes q0 ON q0.id=c0.quote_id WHERE c0.id=collection_uuid;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('controlled-provider:'||resource_uuid::text));
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=resource_uuid FOR UPDATE;
 IF r.id IS NULL OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id) THEN
  RAISE EXCEPTION 'Missing or genuinely closed original resource cannot accept or adopt another target receipt' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='subscription_controlled_quotes' THEN
  IF NEW.redacted_at IS NOT NULL OR NEW.review->>'kind' IS DISTINCT FROM NEW.kind OR NEW.review->>'subscriptionId' IS DISTINCT FROM r.subscription_id::text
   OR NEW.review->>'previousTermsId' IS DISTINCT FROM NEW.previous_terms_id::text OR NEW.review->>'canonicalSourceId' IS DISTINCT FROM NEW.canonical_source_id
   OR NEW.review->>'quoteDigest' IS DISTINCT FROM NEW.quote_digest OR NEW.review->>'sourceRevision' IS DISTINCT FROM NEW.source_revision
   OR NEW.review->'controlled'->>'quoteId' IS DISTINCT FROM NEW.id::text OR NEW.review->'controlled'->>'resourceId' IS DISTINCT FROM r.id::text
   OR NEW.review->'controlled'->>'plannedCollectionId' IS DISTINCT FROM NEW.planned_collection_id::text
   OR nullif(NEW.review->'controlled'->>'plannedProrationId','')::uuid IS DISTINCT FROM NEW.planned_proration_id
   OR NEW.review->'controlled'->>'quotedParentRevision' IS DISTINCT FROM NEW.quoted_parent_revision
   OR NOT EXISTS(SELECT 1 FROM subscription_commercial_terms t WHERE t.id=NEW.previous_terms_id AND t.subscription_id=r.subscription_id)
   OR EXISTS(SELECT 1 FROM(VALUES(NEW.calendar_read_operation_id,'read_calendar'),(NEW.customer_financial_operation_id,'read_customer_financials'),
      (NEW.native_preview_operation_id,'preview_proration'),(NEW.update_preview_operation_id,'preview_update')) expected(id,kind)
    WHERE NOT EXISTS(SELECT 1 FROM subscription_controlled_operations actual JOIN subscription_controlled_verifications v ON v.operation_id=actual.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority') WHERE actual.id=expected.id AND actual.kind=expected.kind AND actual.resource_id=r.id)) THEN
   RAISE EXCEPTION 'Retain every actual independently returned original calendar/customer/native/update proof and exact explicit quote before acceptance' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME IN('subscription_controlled_invoice_bindings','subscription_controlled_item_receipts') THEN
  SELECT * INTO o FROM subscription_controlled_operations WHERE id=NEW.operation_id;SELECT * INTO creator FROM subscription_controlled_operations WHERE id=NEW.creator_operation_id;
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;SELECT * INTO f FROM subscription_controlled_facts WHERE id=NEW.fact_id;
  IF NEW.resource_id IS DISTINCT FROM r.id OR o.resource_id IS DISTINCT FROM r.id OR creator.resource_id IS DISTINCT FROM r.id OR c.operation_id IS DISTINCT FROM o.id OR f.call_id IS DISTINCT FROM c.id
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=creator.id) THEN
   RAISE EXCEPTION 'Original physical creator and actual observing operation/caller/raw fact remain distinct exact owners' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='subscription_controlled_invoice_bindings' THEN
   IF NEW.origin_kind NOT IN('created_draft','update_generated','calendar_generated')
    OR(NEW.origin_kind='created_draft' AND creator.kind<>'create_draft') OR(NEW.origin_kind<>'created_draft' AND creator.kind<>'update_calendar')
    OR NOT((f.actual->>'kind' IN('controlled_draft_created','invoice_read') AND f.actual->'raw'->>'id'=NEW.provider_invoice_ref)
      OR(f.actual->>'kind'='invoice_list_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(f.actual->'raw'->'data') actual WHERE actual->>'id'=NEW.provider_invoice_ref))) THEN
    RAISE EXCEPTION 'Only actual original draft/updated calendar creator plus exact authentic invoice observation can bind one canonical target' USING ERRCODE='23514';END IF;
  ELSE
   IF NEW.origin_kind NOT IN('invoice_item','subscription_line') OR f.actual->>'kind' IS DISTINCT FROM 'invoice_lines_read'
    OR(NEW.origin_kind='invoice_item' AND(creator.kind<>'add_invoice_component' OR NEW.provider_invoice_item_ref IS NULL))
    OR(NEW.origin_kind='subscription_line' AND(creator.kind<>'update_calendar' OR NEW.provider_invoice_line_ref IS NULL))
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.actual->'raw'->'data') actual WHERE actual->>'id'=NEW.provider_invoice_line_ref) THEN
    RAISE EXCEPTION 'Retain the actual original item or native subscription line without inventing ii_ ancestry or an original finish' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_invoice_proofs' THEN
  IF NOT EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
   JOIN subscription_controlled_invoice_bindings b ON b.collection_id=NEW.collection_id
   WHERE op.id=NEW.operation_id AND op.kind='read_manifest' AND op.resource_id=r.id AND v.call_id=NEW.call_id AND v.actual_result_digest=NEW.result_digest
    AND v.actual_result->>'exactManifest'='true' AND v.actual_result->>'providerInvoiceRef'=b.provider_invoice_ref
    AND v.actual_result->>'customerFinancialDigest'=NEW.customer_financial_digest) THEN
   RAISE EXCEPTION 'Exact complete manifest proof must remain the genuine original returned read and its actual signed caller' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_target_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;c subscription_controlled_collections%ROWTYPE;
 payload jsonb;target_id uuid;latest_read jsonb;read_ordinal bigint;original_update subscription_controlled_operations%ROWTYPE;manifest jsonb;proof jsonb;bound subscription_controlled_invoice_bindings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 payload=o.original_request->'payload';manifest=payload->'manifest';
 IF o.id IS NULL OR r.id IS NULL OR o.original_request->>'requiredProtocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR NOT coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR NOT freeholder_controlled_callers_closed(r.id) OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal) THEN RETURN false;END IF;
 SELECT v.actual_result,original.ordinal INTO latest_read,read_ordinal FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE original.resource_id=r.id AND original.kind='read_calendar' AND original.ordinal<o.ordinal ORDER BY original.ordinal DESC LIMIT 1;
 IF latest_read IS NULL OR (o.kind<>'read_manifest' AND(latest_read->>'collectionPausedAsDraft' IS DISTINCT FROM 'true' OR latest_read->>'calendarCanceled' IS DISTINCT FROM 'false'))
  OR latest_read->>'providerSubscriptionRef' IS DISTINCT FROM payload->>'providerSubscriptionRef' THEN RETURN false;END IF;
 IF o.kind IN('preview_proration','preview_update') THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'prorationAt' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.ordinal<o.ordinal
    AND later.ordinal>(SELECT max(original.ordinal) FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority') WHERE original.resource_id=r.id AND original.kind='read_calendar')
    AND later.kind IN('update_calendar','cancel_calendar'));
 END IF;
 IF NOT coalesce(o.original_request->>'targetFinancialRevision' ~ '^[a-f0-9]{64}$',false) THEN RETURN false;END IF;
 target_id=CASE WHEN o.kind='update_calendar' THEN(payload->>'collectionId')::uuid ELSE(manifest->>'collectionId')::uuid END;
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target_id;SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 IF c.id IS NULL OR q.resource_id IS DISTINCT FROM r.id OR NOT freeholder_controlled_collection_valid(c.id)
  OR(o.kind<>'read_manifest' AND((c.kind='proration' AND q.effective_at<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM subscriptions p JOIN module_settings m ON m.module='subscriptions' AND m.enabled WHERE p.id=r.subscription_id
    AND p.status IN('active','trialing') AND p.cancelled_at IS NULL AND NOT p.cancel_at_period_end)
  OR EXISTS(SELECT 1 FROM invoices i WHERE i.id=c.invoice_id AND(i.paid_minor<>0 OR i.refunded_minor<>0 OR i.status IN('draft','void','refunded'))))) THEN RETURN false;END IF;
 IF o.kind<>'read_manifest' AND c.invoice_id IS NOT NULL AND NOT freeholder_controlled_collection_inventory(o.id) THEN RETURN false;END IF;
 IF o.kind NOT IN('update_calendar','read_manifest') THEN
  IF(SELECT count(*) FROM subscription_controlled_operations creator WHERE creator.resource_id=r.id AND creator.kind='update_calendar'
    AND creator.original_request->'payload'->>'collectionId'=c.id::text AND EXISTS(SELECT 1 FROM subscription_controlled_calls physical WHERE physical.operation_id=creator.id))<>1 THEN RETURN false;END IF;
  SELECT * INTO original_update FROM subscription_controlled_operations creator WHERE creator.resource_id=r.id AND creator.kind='update_calendar'
   AND creator.original_request->'payload'->>'collectionId'=c.id::text AND EXISTS(SELECT 1 FROM subscription_controlled_calls physical WHERE physical.operation_id=creator.id);
  IF original_update.id IS NULL OR read_ordinal<=original_update.ordinal
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_price_epoch_id' IS DISTINCT FROM c.id::text
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_update_operation_id' IS DISTINCT FROM original_update.id::text
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_update_request_digest' IS DISTINCT FROM original_update.request_digest
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_accepted_quote_digest' IS DISTINCT FROM c.accepted_quote_digest
   OR latest_read->'actualRaw'->'metadata'->>'freeholder_controlled_collection_policy' IS DISTINCT FROM c.collection_policy THEN RETURN false;END IF;
 END IF;
 IF o.kind NOT IN('update_calendar','read_manifest') AND(
  payload->'calendar'->'originalComponents'->0->>'amountMinor' IS DISTINCT FROM q.review->'quote'->'snapshot'->>'periodAmountMinor'
  OR payload->'calendar'->'originalComponents'->0->>'providerProductRef' IS DISTINCT FROM r.original_scope->>'providerProductRef'
  OR payload->'calendar'->>'originalAnchor' IS DISTINCT FROM q.review->'calendar'->>'expectedProviderBillingAnchor'
  OR payload->'calendar'->>'originalProviderTrialEnd' IS DISTINCT FROM q.review->'calendar'->>'expectedProviderTrialEndsAt'
  OR NOT((payload->'calendar'->>'originalPeriodStart'=q.review->'calendar'->>'expectedProviderPeriodStart' AND payload->'calendar'->>'originalPeriodEnd'=q.review->'calendar'->>'expectedProviderPeriodEnd')
    OR(c.kind='period' AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.review->'calendar'->'nativeForecasts') forecast WHERE forecast->>'proration'='false'
      AND forecast->>'amountMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor' AND forecast->>'periodStart'=payload->'calendar'->>'originalPeriodStart' AND forecast->>'periodEnd'=payload->'calendar'->>'originalPeriodEnd')))
 ) THEN RETURN false;END IF;
 IF o.kind='update_calendar' THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'acceptedQuoteDigest'=c.accepted_quote_digest
   AND payload->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
   AND payload->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND payload->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='update_calendar' AND old.original_request->'payload'->>'collectionId'=c.id::text);
 END IF;
 IF manifest->>'protocol' IS DISTINCT FROM 'controlled_net_gross.v1' OR manifest->>'quoteId' IS DISTINCT FROM q.id::text OR manifest->>'canonicalInvoiceId' IS DISTINCT FROM c.invoice_id::text
  OR manifest->>'canonicalTargetDigest' IS DISTINCT FROM c.canonical_target_digest OR manifest->>'acceptedQuoteDigest' IS DISTINCT FROM c.accepted_quote_digest
  OR manifest->>'termsId' IS DISTINCT FROM c.terms_id::text OR manifest->>'grossMinor' IS DISTINCT FROM((q.review->>'debitNetMinor')::bigint+(q.review->>'debitTaxMinor')::bigint)::text
  OR manifest->>'creditedMinor' IS DISTINCT FROM q.review->>'creditAppliedMinor' OR manifest->>'cashDueMinor' IS DISTINCT FROM q.review->>'cashDueMinor'
  OR payload->'calendar'->>'currentReadDigest' IS DISTINCT FROM latest_read->>'currentReadDigest'
  OR jsonb_typeof(manifest->'components') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'components')<>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_components actual WHERE actual.collection_id=c.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'components') component
    WHERE component->>'id'=actual.id::text AND component->>'kind'=actual.kind AND component->>'amountMinor'=actual.amount_minor::text AND component->>'provenanceDigest'=actual.provenance_digest)) THEN RETURN false;END IF;
 SELECT * INTO bound FROM subscription_controlled_invoice_bindings WHERE collection_id=c.id;
 IF o.kind='create_draft' THEN
  RETURN bound.collection_id IS NULL AND payload->>'mode'='create' AND payload->'invoiceOrigin'->>'kind'='created_draft'
   AND payload->'invoiceOrigin'->>'creatorOperationId' IS NULL AND payload->'invoiceOrigin'->>'creatorRequestDigest' IS NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='create_draft' AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text);
 END IF;
 IF bound.collection_id IS NULL OR payload->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR payload->'invoiceOrigin'->>'creatorOperationId' IS DISTINCT FROM bound.creator_operation_id::text
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations creator WHERE creator.id=bound.creator_operation_id AND creator.request_digest=payload->'invoiceOrigin'->>'creatorRequestDigest'
   AND(bound.origin_kind='created_draft' OR(creator.original_request->'payload'->>'collectionId'=payload->'invoiceOrigin'->>'priceEpochCollectionId'
    AND creator.original_request->'payload'->>'acceptedQuoteDigest'=payload->'invoiceOrigin'->>'priceEpochAcceptedQuoteDigest'))) THEN RETURN false;END IF;
 IF o.kind='add_invoice_component' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_components component WHERE component.id::text=payload->>'componentId' AND component.collection_id=c.id
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_item_receipts item WHERE item.component_id=component.id))
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind='add_invoice_component'
    AND old.original_request->'payload'->>'componentId'=payload->>'componentId');
 END IF;
 IF(SELECT count(*) FROM subscription_controlled_item_receipts item JOIN subscription_controlled_components component ON component.id=item.component_id WHERE component.collection_id=c.id)
   <>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id) THEN RETURN false;END IF;
 IF o.kind IN('read_manifest','set_invoice_fee') THEN RETURN true;END IF;
 SELECT v.actual_result INTO proof FROM subscription_controlled_invoice_proofs retained JOIN subscription_controlled_operations original ON original.id=retained.operation_id
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority') WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
 IF proof IS NULL OR proof->>'exactManifest' IS DISTINCT FROM 'true' OR proof->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND EXISTS(SELECT 1 FROM subscription_controlled_calls actual_caller WHERE actual_caller.operation_id=old.id) AND old.kind=o.kind AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text) THEN RETURN false;END IF;
 IF c.kind='period' AND o.kind IN('finalize_invoice','pay_invoice')
  AND(clock_timestamp()<(q.review->'calendar'->>'proposedPeriodStart')::timestamptz
   OR(q.review->>'originalTrialEndsAt' IS NOT NULL AND clock_timestamp()<(q.review->>'originalTrialEndsAt')::timestamptz)) THEN RETURN false;END IF;
 IF o.kind='finalize_invoice' THEN RETURN proof->'inventory'->>'status'='draft' AND proof->'inventory'->>'paidMinor'='0';END IF;
 IF o.kind='pay_invoice' THEN RETURN proof->'inventory'->>'status'='open' AND proof->'inventory'->>'paidMinor'='0'
  AND(q.review->>'cashDueMinor')::bigint>0 AND proof->'inventory'->>'remainingMinor'=q.review->>'cashDueMinor';END IF;
 RETURN false;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_proration_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;
 native jsonb;updated jsonb;calendar jsonb;customer jsonb;request jsonb;native_request jsonb;update_request jsonb;
BEGIN
 SELECT * INTO q FROM subscription_controlled_quotes WHERE planned_proration_id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=q.previous_terms_id;
 IF q.id IS NULL OR q.kind IS DISTINCT FROM 'proration' OR r.id IS NULL OR p.id IS NULL OR t.id IS NULL OR p.billing_mode IS DISTINCT FROM 'provider'
  OR q.redacted_at IS NOT NULL OR q.input IS NULL OR q.review IS NULL OR q.effective_at<=clock_timestamp() OR NOT freeholder_controlled_callers_closed(r.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR q.review->>'kind' IS DISTINCT FROM 'proration' OR q.review->>'subscriptionId' IS DISTINCT FROM p.id::text
  OR q.review->>'previousTermsId' IS DISTINCT FROM t.id::text OR q.review->>'quoteDigest' IS DISTINCT FROM q.quote_digest
  OR q.review->'controlled'->>'protocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR q.review->'controlled'->>'plannedProrationId' IS DISTINCT FROM target::text OR q.review->'controlled'->>'quoteId' IS DISTINCT FROM q.id::text
  OR q.review->'controlled'->>'resourceId' IS DISTINCT FROM r.id::text OR q.review->'controlled'->>'plannedCollectionId' IS DISTINCT FROM q.planned_collection_id::text
  OR q.input->>'resourceId' IS DISTINCT FROM r.id::text OR q.input->>'id' IS DISTINCT FROM p.id::text
  OR q.input->>'effectiveAt' IS DISTINCT FROM q.review->>'effectiveAt' OR(q.input->>'effectiveAt')::timestamptz IS DISTINCT FROM q.effective_at
  OR q.review->'calendar'->>'originalApplicationPeriodStart' IS DISTINCT FROM to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->'calendar'->>'originalApplicationPeriodEnd' IS DISTINCT FROM to_char(p.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->'calendar'->>'originalTrialEndsAt' IS DISTINCT FROM q.review->'calendar'->>'proposedTrialEndsAt'
  OR t.subscription_id IS DISTINCT FROM p.id OR t.snapshot->>'proration' IS DISTINCT FROM 'create_prorations'
  OR EXISTS(SELECT 1 FROM subscription_provider_schedule_operations legacy_op WHERE legacy_op.subscription_id=p.id AND legacy_op.original_request->>'resourceKind' IS DISTINCT FROM 'phase_product') THEN RETURN false;END IF;
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.customer_financial_operation_id AND op.resource_id=r.id AND op.kind='read_customer_financials';
 request=native_request->'payload';
 RETURN coalesce(native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
  AND native_request->>'requiredProtocol'='controlled_net_gross.v1' AND update_request->>'requiredProtocol'='controlled_net_gross.v1'
  AND request=update_request->'payload' AND native_request->>'targetInputDigest'=update_request->>'targetInputDigest' AND native_request->>'economicQuoteDigest'=update_request->>'economicQuoteDigest'
  AND native_request->>'economicQuoteDigest'=q.review->'quote'->>'quoteDigest' AND request->>'prorationAt'=q.review->>'effectiveAt'
  AND request->>'currentReadDigest'=calendar->>'currentReadDigest' AND calendar->>'collectionPausedAsDraft'='true' AND calendar->>'calendarCanceled'='false'
  AND request->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
  AND request->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND request->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
  AND native->>'requestedProrationBehavior'='create_prorations' AND updated->>'requestedProrationBehavior'='none'
  AND native->>'suppliesPaidAuthority'='false' AND updated->>'suppliesPaidAuthority'='false'
  AND customer->>'balanceState'='known_zero' AND customer->>'completeCreditNotes'='true'
  AND customer->>'providerCustomerRef'=r.original_scope->>'providerCustomerRef' AND customer->>'inventoryDigest'=q.review->'controlled'->>'customerFinancialDigest'
  AND jsonb_typeof(native->'actualLines')='array' AND jsonb_typeof(updated->'actualLines')='array',false);
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_original_period_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;
 native_request jsonb;update_request jsonb;native jsonb;updated jsonb;calendar jsonb;customer jsonb;start_at timestamptz;end_at timestamptz;request jsonb;
BEGIN
 SELECT * INTO q FROM subscription_controlled_quotes WHERE id=target;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=q.previous_terms_id;
 IF q.id IS NULL OR q.kind IS DISTINCT FROM 'period' OR r.id IS NULL OR p.id IS NULL OR t.id IS NULL OR q.redacted_at IS NOT NULL
  OR p.billing_mode IS DISTINCT FROM 'provider' OR p.provider IS DISTINCT FROM 'stripe' OR p.merchant_scope_version IS DISTINCT FROM 1
  OR p.signup_pending OR p.status NOT IN('active','trialing') OR p.cancel_at_period_end OR p.cancelled_at IS NOT NULL
  OR t.subscription_id IS DISTINCT FROM p.id OR t.snapshot->>'billingMode' IS DISTINCT FROM 'provider'
  OR t.tax_destination IS NULL OR q.profile_id IS DISTINCT FROM t.profile_id OR q.profile_version IS DISTINCT FROM t.profile_version
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR q.review->>'kind' IS DISTINCT FROM 'period' OR q.review->>'subscriptionId' IS DISTINCT FROM p.id::text
  OR q.review->>'previousTermsId' IS DISTINCT FROM t.id::text OR q.review->'quote'->'snapshot' IS DISTINCT FROM t.snapshot
  OR q.review->'quote'->>'quoteDigest' IS DISTINCT FROM t.accepted_quote_digest
  OR q.review->'controlled'->>'originalPeriodConsentDigest' IS DISTINCT FROM t.accepted_quote_digest
  OR q.review->>'originalPeriodStart' IS DISTINCT FROM to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->>'originalPeriodEnd' IS DISTINCT FROM to_char(p.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR q.review->>'creditNetMinor' IS DISTINCT FROM '0' OR q.review->>'creditTaxMinor' IS DISTINCT FROM '0'
  OR q.review->>'creditAppliedMinor' IS DISTINCT FROM '0' OR q.review->>'residualCreditMinor' IS DISTINCT FROM '0' THEN RETURN false;END IF;
 start_at=(q.review->'calendar'->>'proposedPeriodStart')::timestamptz;end_at=(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz;
 IF start_at IS DISTINCT FROM q.effective_at OR start_at<p.current_period_end OR end_at<=start_at OR end_at<=clock_timestamp()
  OR q.canonical_source_id IS DISTINCT FROM p.id::text||':'||to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR(start_at<>p.current_period_end AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a JOIN subscription_commercial_terms accepted ON accepted.id=a.terms_id
    WHERE a.subscription_id=p.id AND a.state='activated' AND accepted.id=t.id AND accepted.effective_period_start=start_at)) THEN RETURN false;END IF;
 IF p.status='trialing' THEN
  IF p.trial_ends_at IS NULL OR p.trial_ends_at IS DISTINCT FROM p.current_period_end OR (t.snapshot->>'trialDays')::integer<=0
   OR r.original_scope->>'acceptedTrialEnd' IS DISTINCT FROM to_char(p.trial_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN RETURN false;END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM invoices original_invoice WHERE original_invoice.contact_id=p.contact_id AND original_invoice.currency=p.currency
   AND original_invoice.status='paid' AND original_invoice.paid_minor+original_invoice.credited_minor=original_invoice.total_minor AND original_invoice.refunded_minor=0
   AND(original_invoice.source_type='subscription' AND original_invoice.source_id=p.id::text||':'||to_char(p.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.subscription_id=p.id AND prior.state='applied' AND prior.plan_id=p.plan_id
     AND prior.proposed_period_end=p.current_period_end AND prior.debit_invoice_id=original_invoice.id))) THEN RETURN false;END IF;
 END IF;
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id AND freeholder_controlled_safe_call_admissible(v.call_id) AND freeholder_controlled_safe_response_valid(v.actual_result,'authority')
  WHERE op.id=q.customer_financial_operation_id AND op.resource_id=r.id AND op.kind='read_customer_financials';
 request=native_request->'payload';
 RETURN coalesce((native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
  AND request IS NOT DISTINCT FROM update_request->'payload' AND native_request->>'targetInputDigest'=q.input_digest AND update_request->>'targetInputDigest'=q.input_digest
  AND native_request->>'periodSourceId'=q.canonical_source_id AND update_request->>'periodSourceId'=q.canonical_source_id
  AND native_request->>'originalPeriodConsentDigest'=t.accepted_quote_digest AND update_request->>'originalPeriodConsentDigest'=t.accepted_quote_digest
  AND native_request->>'economicQuoteDigest'=t.accepted_quote_digest AND update_request->>'economicQuoteDigest'=t.accepted_quote_digest
  AND request->>'prorationAt'=q.input->>'previewAt' AND request->>'prorationAt'=q.review->'calendar'->>'prorationAt'
  AND request->'target'->>'principalMinor'=t.snapshot->>'periodAmountMinor' AND request->'target'->>'interval'=t.snapshot->>'interval'
  AND request->'target'->>'intervalCount'=t.snapshot->>'intervalCount' AND request->>'currentReadDigest'=calendar->>'currentReadDigest'
  AND calendar->>'collectionPausedAsDraft'='true' AND calendar->>'calendarCanceled'='false'
  AND customer->>'balanceState'='known_zero' AND customer->>'completeCreditNotes'='true'
  AND native->>'requestedProrationBehavior'='create_prorations' AND updated->>'requestedProrationBehavior'='none'
  AND native->>'prorationAt'=request->>'prorationAt' AND updated->>'prorationAt'=request->>'prorationAt'),false);
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_collection_inventory(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;listed subscription_controlled_operations%ROWTYPE;
 proof jsonb;listing jsonb;read_id jsonb;reader subscription_controlled_operations%ROWTYPE;observed_invoice jsonb;invoice_ref text;boundary bigint;
 parent_collection uuid;known subscription_controlled_collections%ROWTYPE;known_quote subscription_controlled_quotes%ROWTYPE;canonical invoices%ROWTYPE;
 first_update bigint;owned boolean;seen text[]='{}';read_ids text[]='{}';items bigint=0;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 proof=o.original_request->'collectionInventory';
 IF o.id IS NULL OR r.id IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object' OR NOT coalesce(proof->>'revision' ~ '^[a-f0-9]{64}$',false)
  OR jsonb_typeof(proof->'invoiceReadOperationIds') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'invoiceReadOperationIds')>5000
  OR NOT freeholder_controlled_callers_closed(r.id) THEN RETURN false;END IF;
 parent_collection=coalesce(o.original_request->'payload'->>'collectionId',o.original_request->'payload'->'manifest'->>'collectionId')::uuid;
 IF parent_collection IS NULL OR NOT EXISTS(SELECT 1 FROM subscription_controlled_collections collection JOIN subscription_controlled_quotes q ON q.id=collection.quote_id WHERE collection.id=parent_collection AND q.resource_id=r.id) THEN RETURN false;END IF;
 SELECT coalesce(max(prior.ordinal),0) INTO boundary FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id
  AND prior.kind IN('update_calendar','create_draft','add_invoice_component','set_invoice_fee','finalize_invoice','pay_invoice','cancel_calendar','pause_drafts')
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 IF proof->>'afterOrdinal' IS DISTINCT FROM boundary::text THEN RETURN false;END IF;
 SELECT * INTO listed FROM subscription_controlled_operations WHERE id::text=proof->>'listOperationId' AND resource_id=r.id AND kind='list_invoices' AND ordinal>boundary AND ordinal<o.ordinal;
 SELECT actual_result INTO listing FROM subscription_controlled_verifications WHERE operation_id=listed.id AND freeholder_controlled_safe_call_admissible(call_id) AND freeholder_controlled_safe_response_valid(actual_result,'authority');
 IF listed.id IS NULL OR listing->>'complete' IS DISTINCT FROM 'true' OR jsonb_typeof(listing->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(listing->'actualInvoices') IS DISTINCT FROM 'array' OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(listing->'actualInvoices')
  OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoiceReadOperationIds')
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='list_invoices' AND later.ordinal>listed.ordinal AND later.ordinal<o.ordinal) THEN RETURN false;END IF;
 SELECT min(prior.ordinal) INTO first_update FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id AND prior.kind='update_calendar'
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 FOR read_id IN SELECT value FROM jsonb_array_elements(proof->'invoiceReadOperationIds') LOOP
  SELECT * INTO reader FROM subscription_controlled_operations WHERE id::text=(read_id#>>'{}') AND resource_id=r.id AND kind='read_invoice' AND ordinal>listed.ordinal AND ordinal<o.ordinal;
  SELECT actual_result INTO observed_invoice FROM subscription_controlled_verifications WHERE operation_id=reader.id AND freeholder_controlled_safe_call_admissible(call_id) AND freeholder_controlled_safe_response_valid(actual_result,'authority');
  invoice_ref=reader.original_request->'payload'->>'providerInvoiceRef';
  IF reader.id IS NULL OR reader.id::text=ANY(read_ids) OR invoice_ref=ANY(seen) OR observed_invoice->>'providerInvoiceRef' IS DISTINCT FROM invoice_ref
   OR observed_invoice->>'providerSubscriptionRef' IS DISTINCT FROM listing->>'providerSubscriptionRef' OR observed_invoice->>'providerCustomerRef' IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
   OR observed_invoice->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR observed_invoice->>'completePayments' IS DISTINCT FROM 'true' OR observed_invoice->>'completeLines' IS DISTINCT FROM 'true'
   OR observed_invoice->'actualInvoice'->>'id' IS DISTINCT FROM invoice_ref OR observed_invoice->'actualInvoice'->>'total' IS DISTINCT FROM observed_invoice->>'totalMinor'
   OR observed_invoice->'actualInvoice'->>'amount_paid' IS DISTINCT FROM observed_invoice->>'paidMinor' OR observed_invoice->'actualInvoice'->>'amount_remaining' IS DISTINCT FROM observed_invoice->>'remainingMinor'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(listing->'providerInvoiceRefs') ref WHERE ref=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'actualInvoices') item WHERE item->>'id'=invoice_ref)
   OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='read_invoice' AND later.ordinal>reader.ordinal AND later.ordinal<o.ordinal AND later.original_request->'payload'->>'providerInvoiceRef'=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_facts fact JOIN subscription_controlled_calls caller ON caller.id=fact.call_id WHERE caller.operation_id=reader.id AND fact.actual->>'kind'='invoice_read' AND fact.actual->'raw'=observed_invoice->'actualInvoice') THEN RETURN false;END IF;
  read_ids=array_append(read_ids,reader.id::text);seen=array_append(seen,invoice_ref);
  IF EXISTS(SELECT 1 FROM(VALUES('actualCash'),('actualPayments'),('actualIntents'),('actualLines'),('actualPrices')) family(name) WHERE jsonb_typeof(observed_invoice->family.name) IS DISTINCT FROM 'array') THEN RETURN false;END IF;
  items=items+1+jsonb_array_length(observed_invoice->'actualCash')+jsonb_array_length(observed_invoice->'actualPayments')+jsonb_array_length(observed_invoice->'actualIntents')+jsonb_array_length(observed_invoice->'actualLines')+jsonb_array_length(observed_invoice->'actualPrices');
  IF items>5000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM subscription_controlled_invoice_bindings b WHERE b.collection_id=parent_collection AND b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref) THEN CONTINUE;END IF;
  owned=observed_invoice->>'status'='paid' AND observed_invoice->>'autoAdvance'='false' AND observed_invoice->>'totalMinor'='0' AND observed_invoice->>'paidMinor'='0' AND observed_invoice->>'remainingMinor'='0'
   AND observed_invoice->'actualInvoice'->>'amount_due'='0' AND observed_invoice->'actualInvoice'->>'starting_balance'='0' AND observed_invoice->'actualInvoice'->>'ending_balance'='0'
   AND observed_invoice->'actualInvoice'->>'pre_payment_credit_notes_amount'='0' AND observed_invoice->'actualInvoice'->>'post_payment_credit_notes_amount'='0'
   AND observed_invoice->'actualCash'='[]'::jsonb AND observed_invoice->'actualPayments'='[]'::jsonb AND observed_invoice->'actualIntents'='[]'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(observed_invoice->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(observed_invoice->'actualPrices') price WHERE price->>'unit_amount' IS DISTINCT FROM '0')
   AND(SELECT count(DISTINCT v.actual_result->>'providerInvoiceRef') FROM subscription_controlled_operations bootstrap_read JOIN subscription_controlled_verifications v ON v.operation_id=bootstrap_read.id
    WHERE bootstrap_read.resource_id=r.id AND bootstrap_read.kind='read_bootstrap' AND(first_update IS NULL OR bootstrap_read.ordinal<first_update)
     AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=listing->>'providerSubscriptionRef')=1
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations bootstrap_read JOIN subscription_controlled_verifications v ON v.operation_id=bootstrap_read.id
    WHERE bootstrap_read.resource_id=r.id AND bootstrap_read.kind='read_bootstrap' AND(first_update IS NULL OR bootstrap_read.ordinal<first_update)
     AND v.actual_result->>'completeZeroRecurringItem'='true' AND v.actual_result->>'providerSubscriptionRef'=listing->>'providerSubscriptionRef' AND v.actual_result->>'providerInvoiceRef'=invoice_ref);
  IF owned IS TRUE THEN CONTINUE;END IF;
  SELECT collection.* INTO known FROM subscription_controlled_invoice_bindings b JOIN subscription_controlled_collections collection ON collection.id=b.collection_id
   JOIN subscription_controlled_quotes q ON q.id=collection.quote_id WHERE b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref AND q.resource_id=r.id;
  SELECT * INTO known_quote FROM subscription_controlled_quotes WHERE id=known.quote_id;SELECT * INTO canonical FROM invoices WHERE id=known.invoice_id;
  IF known.id IS NULL OR known.id=parent_collection OR NOT freeholder_controlled_collection_valid(known.id) OR canonical.status IS DISTINCT FROM 'paid'
   OR canonical.paid_minor+canonical.credited_minor<>canonical.total_minor OR canonical.refunded_minor<>0 OR observed_invoice->>'status' IS DISTINCT FROM 'paid'
   OR observed_invoice->>'autoAdvance' IS DISTINCT FROM 'false' OR observed_invoice->>'remainingMinor' IS DISTINCT FROM '0'
   OR observed_invoice->>'totalMinor' IS DISTINCT FROM known_quote.review->>'cashDueMinor' OR observed_invoice->>'paidMinor' IS DISTINCT FROM observed_invoice->>'totalMinor' THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations calendar_read JOIN subscription_controlled_verifications v ON v.operation_id=calendar_read.id
  WHERE calendar_read.resource_id=r.id AND calendar_read.kind='read_calendar' AND calendar_read.ordinal=(SELECT max(latest.ordinal) FROM subscription_controlled_operations latest WHERE latest.resource_id=r.id AND latest.kind='read_calendar' AND latest.ordinal<o.ordinal)
   AND v.actual_result->>'providerInvoiceRef' IS NOT NULL AND NOT(v.actual_result->>'providerInvoiceRef'=ANY(seen))) THEN RETURN false;END IF;
 RETURN cardinality(seen)=jsonb_array_length(listing->'providerInvoiceRefs');
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_cash_application_shape(target uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE payment_row payments%ROWTYPE;invoice_row invoices%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;parent_row subscriptions%ROWTYPE;
 operation_row subscription_controlled_operations%ROWTYPE;call_row subscription_controlled_calls%ROWTYPE;fact_row subscription_controlled_facts%ROWTYPE;
 binding_row subscription_controlled_invoice_bindings%ROWTYPE;proof_row subscription_controlled_invoice_proofs%ROWTYPE;verification_row subscription_controlled_verifications%ROWTYPE;
 cash_rows numeric;cash_total numeric;bank jsonb;
 link_row controlled_cash_application_links%ROWTYPE;receipt_proof controlled_cash_application_receipts%ROWTYPE;batch_row controlled_cash_application_batches%ROWTYPE;current_batch controlled_cash_application_batches%ROWTYPE;terms_row subscription_commercial_terms%ROWTYPE;stage jsonb;current_batch_count integer;
BEGIN
 SELECT * INTO payment_row FROM payments WHERE id=target;
 SELECT * INTO invoice_row FROM invoices WHERE id=payment_row.invoice_id;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE invoice_id=invoice_row.id;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=quote_row.resource_id;
 SELECT * INTO parent_row FROM subscriptions WHERE id=resource_row.subscription_id;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE payment_id=payment_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=route_row.original_charge_receipt_id;
 SELECT * INTO origin_row FROM subscription_controlled_charge_origins WHERE receipt_id=receipt_row.id;
 SELECT * INTO operation_row FROM subscription_controlled_operations WHERE id=origin_row.operation_id;
 SELECT * INTO call_row FROM subscription_controlled_calls WHERE id=origin_row.call_id;
 SELECT * INTO fact_row FROM subscription_controlled_facts WHERE id=origin_row.fact_id;
 SELECT * INTO binding_row FROM subscription_controlled_invoice_bindings WHERE collection_id=collection_row.id;
 SELECT * INTO terms_row FROM subscription_commercial_terms WHERE id=collection_row.terms_id;
 IF payment_row.id IS NULL OR invoice_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL OR resource_row.id IS NULL OR parent_row.id IS NULL
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id
  OR invoice_row.source_type IS DISTINCT FROM 'subscription' OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id
  OR invoice_row.contact_id IS DISTINCT FROM parent_row.contact_id OR invoice_row.currency IS DISTINCT FROM parent_row.currency
  OR quote_row.redacted_at IS NOT NULL OR collection_row.accepted_quote_digest IS DISTINCT FROM quote_row.quote_digest
  OR terms_row.id IS NULL OR terms_row.subscription_id IS DISTINCT FROM parent_row.id
  OR(collection_row.kind='proration' AND collection_row.original_consent_digest IS DISTINCT FROM quote_row.quote_digest
   OR collection_row.kind='period' AND collection_row.original_consent_digest IS DISTINCT FROM terms_row.accepted_quote_digest) OR quote_row.resource_id IS DISTINCT FROM resource_row.id
  OR payment_row.provider IS DISTINCT FROM 'stripe' OR payment_row.method IS DISTINCT FROM 'provider_schedule'
  OR payment_row.amount_minor<=0 OR payment_row.currency IS DISTINCT FROM invoice_row.currency OR payment_row.status IS DISTINCT FROM 'succeeded'
  OR route_row.payment_id IS NULL OR route_row.subscription_id IS DISTINCT FROM parent_row.id OR route_row.origin_kind IS DISTINCT FROM 'provider_schedule'
  OR route_row.provider_api_version IS DISTINCT FROM '2026-10-28.endive' OR route_row.original_charge_receipt_id IS NULL
  OR receipt_row.id IS NULL OR receipt_row.subscription_id IS DISTINCT FROM parent_row.id OR receipt_row.provider_api_version IS DISTINCT FROM route_row.provider_api_version
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM route_row.provider_platform_account_id OR receipt_row.charge_account_id IS DISTINCT FROM route_row.charge_account_id
  OR receipt_row.provider_invoice_ref IS DISTINCT FROM route_row.provider_invoice_ref OR receipt_row.provider_subscription_ref IS DISTINCT FROM route_row.provider_subscription_ref
  OR receipt_row.provider_payment_intent_ref IS DISTINCT FROM route_row.provider_payment_intent_ref OR receipt_row.provider_charge_ref IS DISTINCT FROM route_row.provider_charge_ref
  OR receipt_row.provider_charge_ref IS NULL OR receipt_row.amount_minor IS DISTINCT FROM payment_row.amount_minor OR receipt_row.currency IS DISTINCT FROM payment_row.currency
  OR payment_row.provider_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM resource_row.original_scope->>'providerPlatformAccountId'
  OR receipt_row.charge_account_id IS DISTINCT FROM resource_row.original_scope->>'providerAccountId'
  OR origin_row.receipt_id IS NULL OR origin_row.resource_id IS DISTINCT FROM resource_row.id OR operation_row.resource_id IS DISTINCT FROM resource_row.id
  OR call_row.operation_id IS DISTINCT FROM operation_row.id OR fact_row.call_id IS DISTINCT FROM call_row.id OR fact_row.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR fact_row.actual->'raw'->'cash'->>'providerPaymentIntentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR fact_row.actual->'raw'->'cash'->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR fact_row.actual->'raw'->'cash'->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR fact_row.actual->'raw'->'cash'->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text
  OR fact_row.actual->'raw'->'cash'->>'currency' IS DISTINCT FROM receipt_row.currency
  OR binding_row.collection_id IS NULL OR binding_row.resource_id IS DISTINCT FROM resource_row.id OR binding_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR NOT coalesce(freeholder_controlled_callers_closed(resource_row.id),false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=resource_row.id)
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes sibling_route WHERE sibling_route.original_charge_receipt_id=receipt_row.id AND sibling_route.payment_id<>payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes sibling_route WHERE sibling_route.provider_platform_account_id=receipt_row.provider_platform_account_id
   AND sibling_route.charge_account_id IS NOT DISTINCT FROM receipt_row.charge_account_id AND sibling_route.provider_payment_intent_ref=receipt_row.provider_payment_intent_ref AND sibling_route.payment_id<>payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=payment_row.id)
  OR EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=payment_row.id) THEN RETURN false;END IF;
 SELECT count(*),coalesce(sum(prior_payment.amount_minor),0) INTO cash_rows,cash_total FROM payments prior_payment
  WHERE prior_payment.invoice_id=invoice_row.id AND prior_payment.status='succeeded';
 IF cash_rows>5000 OR cash_total IS DISTINCT FROM invoice_row.paid_minor::numeric OR cash_total+invoice_row.credited_minor>invoice_row.total_minor
  OR invoice_row.paid_minor<0 OR invoice_row.credited_minor<0 OR invoice_row.refunded_minor<>0 OR payment_row.refunded_minor<>0
  OR(invoice_row.status='paid') IS DISTINCT FROM(cash_total+invoice_row.credited_minor=invoice_row.total_minor)
  OR EXISTS(SELECT 1 FROM payments sibling_payment WHERE sibling_payment.invoice_id=invoice_row.id AND sibling_payment.id<>payment_row.id AND sibling_payment.status IN('created','processing')) THEN RETURN false;END IF;
 SELECT proof.* INTO proof_row FROM subscription_controlled_invoice_proofs proof JOIN subscription_controlled_operations original_read ON original_read.id=proof.operation_id
  WHERE proof.collection_id=collection_row.id ORDER BY original_read.ordinal DESC LIMIT 1;
 SELECT * INTO verification_row FROM subscription_controlled_verifications WHERE operation_id=proof_row.operation_id AND call_id=proof_row.call_id;
 IF NOT freeholder_controlled_safe_call_admissible(verification_row.call_id) OR NOT freeholder_controlled_safe_response_valid(verification_row.actual_result,'authority') THEN RETURN false;END IF;
 bank=verification_row.actual_result->'inventory';
 IF proof_row.id IS NULL OR proof_row.canonical_target_digest IS DISTINCT FROM collection_row.canonical_target_digest
  OR proof_row.result_digest IS DISTINCT FROM verification_row.actual_result_digest OR verification_row.actual_result->>'exactManifest' IS DISTINCT FROM 'true'
  OR verification_row.actual_result->>'providerInvoiceRef' IS DISTINCT FROM binding_row.provider_invoice_ref
  OR bank->>'completePayments' IS DISTINCT FROM 'true' OR bank->>'completeLines' IS DISTINCT FROM 'true' OR bank->>'autoAdvance' IS DISTINCT FROM 'false'
  OR bank->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref OR bank->>'providerSubscriptionRef' IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR bank->>'providerCustomerRef' IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef' OR bank->>'currency' IS DISTINCT FROM receipt_row.currency
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(bank->'actualCash')='array' THEN bank->'actualCash' ELSE '[]'::jsonb END) observed_cash
   WHERE observed_cash->>'providerPaymentIntentRef'=receipt_row.provider_payment_intent_ref AND observed_cash->>'providerInvoiceRef'=receipt_row.provider_invoice_ref
    AND observed_cash->>'providerChargeRef'=receipt_row.provider_charge_ref AND observed_cash->>'amountMinor'=receipt_row.amount_minor::text AND observed_cash->>'currency'=receipt_row.currency) THEN RETURN false;END IF;
 -- Structural/manifest membership remains necessary, but cannot authorize
 -- application. Bind the ACTUAL generated payment to its immutable real receipt
 -- proof, then prove the ENTIRE current transaction's normalized original graph.
 SELECT * INTO link_row FROM controlled_cash_application_links WHERE payment_id=payment_row.id;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE id=link_row.receipt_proof_id;
 SELECT * INTO batch_row FROM controlled_cash_application_batches WHERE id=link_row.batch_id;
 IF link_row.receipt_id IS NULL OR receipt_proof.id IS NULL OR batch_row.id IS NULL OR batch_row.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1')
  OR link_row.receipt_id IS DISTINCT FROM receipt_row.id OR receipt_proof.receipt_id IS DISTINCT FROM receipt_row.id OR receipt_proof.batch_id IS DISTINCT FROM batch_row.id
  OR batch_row.collection_id IS DISTINCT FROM collection_row.id OR batch_row.quote_id IS DISTINCT FROM quote_row.id OR batch_row.resource_id IS DISTINCT FROM resource_row.id
  OR batch_row.invoice_id IS DISTINCT FROM invoice_row.id OR batch_row.subscription_id IS DISTINCT FROM parent_row.id OR batch_row.terms_id IS DISTINCT FROM collection_row.terms_id
  OR payment_row.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_row.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR payment_row.processed_at IS DISTINCT FROM receipt_proof.processed_at OR payment_row.amount_minor IS DISTINCT FROM receipt_proof.amount_minor
  OR route_row.application_fee_minor IS DISTINCT FROM receipt_proof.fee_minor THEN RETURN false;END IF;
 -- An earlier committed partial receipt may remain in this invoice. It never
 -- reuses its old transaction grant: the NEW current batch must authenticate
 -- its full unchanged before-row and all real bank/parent debt independently.
 SELECT count(*) INTO current_batch_count FROM controlled_cash_application_batches admitted WHERE admitted.invoice_id=invoice_row.id AND admitted.admission_transaction_id=txid_current()::text;
 IF current_batch_count<>1 THEN RETURN false;END IF;
 SELECT * INTO current_batch FROM controlled_cash_application_batches admitted WHERE admitted.invoice_id=invoice_row.id AND admitted.admission_transaction_id=txid_current()::text;
 IF current_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR current_batch.collection_id IS DISTINCT FROM collection_row.id THEN RETURN false;END IF;
 IF batch_row.id<>current_batch.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_batch.before_entries) original_entry
  WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_row.id::text
   AND original_entry->>'fingerprint'=encode(sha256(convert_to(to_jsonb(payment_row)::text,'UTF8')),'hex')) THEN RETURN false;END IF;
 stage=freeholder_controlled_cash_stage(current_batch.id,null,null);
 RETURN stage->>'complete'='true' AND stage->>'batchId'=current_batch.id::text
  AND stage->>'normalizedParentRevision'=current_batch.parent_pg_revision;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_cash_bank_invoice(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
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
 IF NOT freeholder_controlled_safe_call_admissible(actual_verification.call_id) OR NOT freeholder_controlled_safe_response_valid(actual_verification.actual_result,'authority') THEN RETURN NULL;END IF;
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
 total_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'totalMinor',false) THEN (actual_inventory->'totalMinor' #>> '{}')::bigint ELSE NULL END);paid_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'paidMinor',false) THEN (actual_inventory->'paidMinor' #>> '{}')::bigint ELSE NULL END);remaining_minor=(CASE WHEN freeholder_controlled_bank_minor(actual_inventory->'remainingMinor',false) THEN (actual_inventory->'remainingMinor' #>> '{}')::bigint ELSE NULL END);
 IF total_minor IS NULL OR paid_minor IS NULL OR remaining_minor IS NULL OR total_minor IS DISTINCT FROM (CASE WHEN freeholder_controlled_bank_minor(actual_manifest->'cashDueMinor',false) THEN (actual_manifest->'cashDueMinor' #>> '{}')::bigint ELSE NULL END)
  OR paid_minor::numeric+remaining_minor::numeric IS DISTINCT FROM total_minor::numeric OR actual_inventory->>'status'='paid' AND remaining_minor<>0 OR actual_inventory->>'status'='open' AND remaining_minor=0
  OR actual_invoice->'amount_paid' IS DISTINCT FROM to_jsonb(paid_minor) OR actual_invoice->'amount_remaining' IS DISTINCT FROM to_jsonb(remaining_minor) THEN
  RAISE EXCEPTION 'Actual paid and remaining consideration must conserve the frozen gross-minus-locked-credit bank total without clipping' USING ERRCODE='23514';END IF;
 FOR intent_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualIntents') LOOP
  intent_ref=freeholder_controlled_cash_ref(intent_atom->'id');received_minor=(CASE WHEN freeholder_controlled_bank_minor(intent_atom->'amount_received',false) THEN (intent_atom->'amount_received' #>> '{}')::bigint ELSE NULL END);
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
   payment_minor=(CASE WHEN freeholder_controlled_bank_minor(payment_atom->'amount_paid',false) THEN (payment_atom->'amount_paid' #>> '{}')::bigint ELSE NULL END);IF payment_minor IS NULL THEN RAISE EXCEPTION 'Retain imprecise invoice-payment amounts as review' USING ERRCODE='23514';END IF;
   payment_sum=payment_sum+payment_minor;
  END LOOP;
  IF payment_sum IS DISTINCT FROM received_minor::numeric THEN RAISE EXCEPTION 'Complete actual invoice-payment atoms must account for the exact original captured PI, never aggregate amount adoption' USING ERRCODE='23514';END IF;
  positive_receipts=array_append(positive_receipts,actual_receipt.id);total_received=total_received+received_minor;
 END LOOP;
 FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') LOOP
  payment_ref=freeholder_controlled_cash_ref(payment_atom->'id');payment_minor=(CASE WHEN freeholder_controlled_bank_minor(payment_atom->'amount_paid',false) THEN (payment_atom->'amount_paid' #>> '{}')::bigint ELSE NULL END);intent_ref=freeholder_controlled_cash_ref(payment_atom->'payment'->'payment_intent');
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

CREATE OR REPLACE FUNCTION freeholder_controlled_receipt_bank_observation(target_collection_uuid uuid,target_receipt_uuid uuid)
RETURNS TABLE(actual_inspection_id uuid,actual_observation_id uuid,current_evidence jsonb,original_expectation jsonb,bank_witness jsonb,bank_fingerprint text,immutable_bank_fingerprint text,admitted_source_history_digest text)
LANGUAGE plpgsql STABLE AS $$
DECLARE receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;origin_operation subscription_controlled_operations%ROWTYPE;origin_call subscription_controlled_calls%ROWTYPE;origin_fact subscription_controlled_facts%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;binding_row subscription_controlled_invoice_bindings%ROWTYPE;
 inspection_row merchant_cash_return_inspections%ROWTYPE;finish_row merchant_cash_return_inspection_finishes%ROWTYPE;state_row merchant_cash_return_observations%ROWTYPE;
 admitted_observation subscription_provider_charge_observations%ROWTYPE;source_cash jsonb;bank jsonb;state_count bigint;state_max integer;primary_count bigint;witness_count bigint;
 namespace_platform text;namespace_account text;namespace_intent text;
BEGIN
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=target_receipt_uuid;
 SELECT * INTO origin_row FROM subscription_controlled_charge_origins WHERE receipt_id=target_receipt_uuid;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=origin_row.resource_id;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO binding_row FROM subscription_controlled_invoice_bindings WHERE collection_id=collection_row.id;
 SELECT * INTO origin_operation FROM subscription_controlled_operations WHERE id=origin_row.operation_id;
 SELECT * INTO origin_call FROM subscription_controlled_calls WHERE id=origin_row.call_id;
 SELECT * INTO origin_fact FROM subscription_controlled_facts WHERE id=origin_row.fact_id;
 source_cash=origin_fact.actual->'raw'->'cash';
 IF origin_fact.actual->'raw' ? '_freeholder_projection'
  AND NOT freeholder_controlled_safe_response_valid(origin_fact.actual->'raw','authority') THEN RETURN;END IF;
 IF receipt_row.id IS NULL OR origin_row.receipt_id IS NULL OR resource_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL
  OR quote_row.resource_id IS DISTINCT FROM resource_row.id OR binding_row.resource_id IS DISTINCT FROM resource_row.id
  OR binding_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref OR receipt_row.subscription_id IS DISTINCT FROM resource_row.subscription_id
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR quote_row.redacted_at IS NOT NULL
  OR receipt_row.provider_api_version IS DISTINCT FROM '2026-10-28.endive' OR receipt_row.provider_charge_ref IS NULL
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM resource_row.original_scope->>'providerPlatformAccountId'
  OR receipt_row.charge_account_id IS DISTINCT FROM resource_row.original_scope->>'providerAccountId'
  OR receipt_row.actual_destination_account_id IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR receipt_row.actual_settlement_merchant_account_id IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR origin_operation.resource_id IS DISTINCT FROM resource_row.id OR origin_call.operation_id IS DISTINCT FROM origin_operation.id
  OR origin_fact.call_id IS DISTINCT FROM origin_call.id OR origin_fact.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR source_cash->>'subscriptionId' IS DISTINCT FROM receipt_row.subscription_id::text
  OR source_cash->>'providerPaymentIntentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR source_cash->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR source_cash->>'providerSubscriptionRef' IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR(source_cash->>'providerChargeRef' IS NOT NULL AND source_cash->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'destinationAccountId' IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR source_cash->>'settlementMerchantAccountId' IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR source_cash->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id OR source_cash->>'providerAccountId' IS DISTINCT FROM receipt_row.charge_account_id
  OR source_cash->>'providerCustomerRef' IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR origin_fact.actual->'raw'->'invoice'->>'id' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR origin_fact.actual->'raw'->'intent'->>'id' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'subscription'),freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR origin_fact.actual->'raw'->'intent'->>'amount_received' IS DISTINCT FROM receipt_row.amount_minor::text
  OR upper(origin_fact.actual->'raw'->'intent'->>'currency') IS DISTINCT FROM receipt_row.currency
  OR(freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS NOT NULL AND freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR source_cash->>'currency' IS DISTINCT FROM receipt_row.currency
  OR source_cash->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR source_cash->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb
  OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified OR NOT coalesce(freeholder_controlled_callers_closed(resource_row.id),false) THEN RETURN;END IF;
 namespace_platform=receipt_row.provider_platform_account_id;namespace_account=receipt_row.charge_account_id;namespace_intent=receipt_row.provider_payment_intent_ref;
 -- Real namespace-locked admission sequence and authenticated closed history,
 -- never transaction-start timestamps or UUID tie breaking. Unknown/later
 -- unsequenced or unfinished/negative reads cannot revive an older bank state.
 SELECT * INTO inspection_row FROM merchant_cash_return_inspections inspection
  WHERE inspection.id=freeholder_controlled_cash_read_latest(receipt_row.id)
   AND inspection.provider_platform_account_id=namespace_platform AND inspection.charge_account_id IS NOT DISTINCT FROM namespace_account AND inspection.original_payment_ref=namespace_intent;
 IF NOT EXISTS(SELECT 1 FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id
  AND actual_lineage.resource_id=resource_row.id AND actual_lineage.receipt_id=receipt_row.id
  AND actual_lineage.caller_instance_id::text=inspection_row.caller->>'id'
  AND actual_lineage.admission_fingerprint=encode(sha256(convert_to(to_jsonb(inspection_row)::text,'UTF8')),'hex')) THEN RETURN;END IF;
 IF inspection_row.id IS NULL OR inspection_row.subscription_charge_receipt_id IS DISTINCT FROM receipt_row.id OR inspection_row.payment_id IS NOT NULL
  OR inspection_row.original_observation_id IS NOT NULL OR inspection_row.original_cash_amount_minor IS DISTINCT FROM receipt_row.amount_minor
  OR inspection_row.currency IS DISTINCT FROM receipt_row.currency OR inspection_row.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version THEN RETURN;END IF;
 SELECT * INTO admitted_observation FROM subscription_provider_charge_observations WHERE id=inspection_row.subscription_charge_observation_id;
 IF admitted_observation.id IS NULL OR admitted_observation.subscription_id IS DISTINCT FROM receipt_row.subscription_id
  OR admitted_observation.provider_platform_account_id IS DISTINCT FROM namespace_platform OR admitted_observation.charge_account_id IS DISTINCT FROM namespace_account
  OR admitted_observation.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version OR admitted_observation.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR admitted_observation.provider_subscription_ref IS DISTINCT FROM receipt_row.provider_subscription_ref OR admitted_observation.provider_payment_intent_ref IS DISTINCT FROM namespace_intent
  OR admitted_observation.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref OR admitted_observation.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR admitted_observation.currency IS DISTINCT FROM receipt_row.currency THEN RETURN;END IF;
 SELECT * INTO finish_row FROM merchant_cash_return_inspection_finishes WHERE inspection_id=inspection_row.id;
 IF finish_row.inspection_id IS NULL OR finish_row.caller_instance_id::text IS DISTINCT FROM inspection_row.caller->>'id' OR finish_row.outcome IS DISTINCT FROM 'returned'
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops WHERE inspection_id=inspection_row.id) THEN RETURN;END IF;
 -- A stop closes ONLY the actual older caller. It cannot supply selected bank evidence.
 IF EXISTS(SELECT 1 FROM merchant_cash_return_inspections admitted
  LEFT JOIN merchant_cash_return_inspection_finishes finished ON finished.inspection_id=admitted.id
  LEFT JOIN merchant_cash_return_inspection_stops stopped ON stopped.inspection_id=admitted.id
  WHERE admitted.provider_platform_account_id=namespace_platform AND admitted.charge_account_id IS NOT DISTINCT FROM namespace_account AND admitted.original_payment_ref=namespace_intent
   AND((finished.inspection_id IS NOT NULL AND stopped.inspection_id IS NOT NULL)
    OR(finished.inspection_id IS NOT NULL AND(finished.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id' OR finished.outcome NOT IN('returned','threw')))
    OR(stopped.inspection_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id'
      OR stopped.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(admitted)::text,'UTF8')),'hex') OR stopped.mechanical_check IS DISTINCT FROM 'original_process_absent'))
    OR(finished.inspection_id IS NULL AND stopped.inspection_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_dispatches dispatched JOIN merchant_refund_requests requested ON requested.id=dispatched.request_id
  LEFT JOIN merchant_refund_dispatch_finishes finished ON finished.dispatch_id=dispatched.id
  LEFT JOIN merchant_refund_dispatch_stops stopped ON stopped.dispatch_id=dispatched.id
  WHERE requested.provider_platform_account_id=namespace_platform AND requested.charge_account_id IS NOT DISTINCT FROM namespace_account AND requested.original_payment_ref=namespace_intent
   AND((finished.dispatch_id IS NOT NULL AND stopped.dispatch_id IS NOT NULL)
    OR(finished.dispatch_id IS NOT NULL AND finished.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id')
    OR(stopped.dispatch_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id' OR stopped.request_digest IS DISTINCT FROM dispatched.request_digest))
    OR(finished.dispatch_id IS NULL AND stopped.dispatch_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM original_cash_recovery_operations physical_call JOIN original_cash_recoveries physical_owner ON physical_owner.id=physical_call.recovery_id
  WHERE physical_owner.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND physical_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account
   AND physical_owner.owner->'cash'->>'providerRef'=namespace_intent AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts actual_finish WHERE actual_finish.operation_id=physical_call.id
    AND(actual_finish.kind='finish' AND actual_finish.evidence->>'callerInstanceId'=physical_call.caller->>'id' AND actual_finish.evidence->>'outcome' IN('returned','threw')
     OR actual_finish.kind='stop' AND actual_finish.evidence->>'operationDigest'=physical_call.digest))) THEN RETURN;END IF;
 SELECT count(*),max(sequence) INTO state_count,state_max FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id;
 SELECT * INTO state_row FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id ORDER BY sequence DESC LIMIT 1;
 SELECT count(*) INTO primary_count FROM merchant_cash_return_primary_observations WHERE inspection_id=inspection_row.id;
 IF state_count<1 OR state_count>5000 OR state_max IS DISTINCT FROM state_count OR primary_count<1 OR primary_count>5000
  OR EXISTS(SELECT 1 FROM merchant_cash_return_observations state WHERE state.inspection_id=inspection_row.id AND(state.sequence<1 OR state.sequence>state_count))
  OR EXISTS(SELECT 1 FROM merchant_cash_return_primary_observations primary_row WHERE primary_row.inspection_id=inspection_row.id
   AND(NOT freeholder_controlled_bank_minor(primary_row.evidence->'amountMinor',true) OR primary_row.evidence->>'providerRef' IS DISTINCT FROM namespace_intent
    OR NOT coalesce(primary_row.evidence->>'status'='succeeded' OR(primary_row.evidence->>'status'='failed' AND state_row.evidence->>'paymentIntentStatus'='canceled'),false)
    OR primary_row.evidence->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR primary_row.evidence->>'providerAccountId' IS DISTINCT FROM namespace_account
    OR primary_row.evidence->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR primary_row.evidence->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text
    OR primary_row.evidence->>'currency' IS DISTINCT FROM receipt_row.currency OR primary_row.evidence->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)) THEN RETURN;END IF;
 bank=state_row.evidence;
 IF jsonb_typeof(bank) IS DISTINCT FROM 'object' OR bank->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR bank->>'chargeAccountId' IS DISTINCT FROM namespace_account
  OR bank->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR bank->>'paymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR bank->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'currency' IS DISTINCT FROM receipt_row.currency
  OR bank->>'chargePaymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'chargeAmountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'chargeCurrency' IS DISTINCT FROM receipt_row.currency
  OR bank->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR bank->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(bank->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank->'disputes') IS DISTINCT FROM 'array' THEN RETURN;END IF;
 IF jsonb_array_length(bank->'refunds')>1000 OR jsonb_array_length(bank->'disputes')>1000 THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_observations refund_row WHERE refund_row.inspection_id=inspection_row.id
  AND(refund_row.provider_platform_account_id IS DISTINCT FROM namespace_platform OR refund_row.charge_account_id IS DISTINCT FROM namespace_account
   OR refund_row.payment_provider_ref IS DISTINCT FROM namespace_intent OR refund_row.currency IS DISTINCT FROM receipt_row.currency
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'refunds') actual_refund WHERE actual_refund->>'providerRef'=refund_row.provider_ref
    AND actual_refund->>'paymentProviderRef'=refund_row.payment_provider_ref AND actual_refund->>'chargeRef'=refund_row.provider_charge_ref
    AND actual_refund->>'amountMinor'=refund_row.amount_minor::text AND actual_refund->>'currency'=refund_row.currency AND actual_refund->>'status'=refund_row.status))) THEN RETURN;END IF;
 immutable_bank_fingerprint=encode(sha256(convert_to(jsonb_build_object('receiptId',receipt_row.id,'origin',to_jsonb(origin_row),'originalOperation',to_jsonb(origin_operation),
  'originalCall',to_jsonb(origin_call),'originalFact',to_jsonb(origin_fact),'inspection',to_jsonb(inspection_row),'finish',to_jsonb(finish_row),'latestState',to_jsonb(state_row),
  'actualAdmissionLineage',(SELECT to_jsonb(actual_lineage) FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id),
  'primary',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM merchant_cash_return_primary_observations p WHERE p.inspection_id=inspection_row.id),
  'ownRefunds',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM merchant_refund_observations r WHERE r.inspection_id=inspection_row.id))::text,'UTF8')),'hex');
 WITH namespace_inspections AS(SELECT i.* FROM merchant_cash_return_inspections i WHERE i.provider_platform_account_id=namespace_platform AND i.charge_account_id IS NOT DISTINCT FROM namespace_account AND i.original_payment_ref=namespace_intent),
 resource_calls AS(SELECT c.* FROM subscription_controlled_calls c JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE o.resource_id=resource_row.id),
 namespace_requests AS(SELECT r.* FROM merchant_refund_requests r WHERE r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent),
 namespace_aliases AS(SELECT r.* FROM merchant_agreement_payment_routes r WHERE r.original_charge_receipt_id=receipt_row.id),
 namespace_payments AS(SELECT p.* FROM payments p WHERE p.id IN(SELECT payment_id FROM namespace_aliases)
  OR p.id IN(SELECT m.payment_id FROM merchant_payment_observations m WHERE m.provider_platform_account_id=namespace_platform AND m.charge_account_id IS NOT DISTINCT FROM namespace_account AND m.provider_ref=namespace_intent)),
 namespace_fees AS(SELECT f.* FROM merchant_fee_refunds f WHERE f.original_charge_receipt_id=receipt_row.id OR f.payment_id IN(SELECT id FROM namespace_payments)),
 namespace_owners AS(SELECT o.* FROM original_cash_recoveries o WHERE o.subscription_charge_receipt_id=receipt_row.id
  OR(o.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND o.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account AND o.owner->'cash'->>'providerRef'=namespace_intent)),
 namespace_resolutions AS(SELECT r.* FROM merchant_unapplied_charge_resolutions r WHERE r.subscription_charge_receipt_id=receipt_row.id
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent)),
 refund_rows AS(SELECT r.* FROM merchant_refund_observations r WHERE r.inspection_id IN(SELECT id FROM namespace_inspections)
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.payment_provider_ref=namespace_intent)),
 physical_rows AS(
  SELECT 'subscription_provider_charge_receipts'::text family,receipt_row.id::text identity,encode(sha256(convert_to(to_jsonb(receipt_row)::text,'UTF8')),'hex') fingerprint
  UNION ALL SELECT 'subscription_controlled_resources',resource_row.id::text,encode(sha256(convert_to(to_jsonb(resource_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_collections',collection_row.id::text,encode(sha256(convert_to(to_jsonb(collection_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_quotes',quote_row.id::text,encode(sha256(convert_to(to_jsonb(quote_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_invoice_bindings',binding_row.collection_id::text,encode(sha256(convert_to(to_jsonb(binding_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_operations o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_calls',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM resource_calls c
  UNION ALL SELECT 'subscription_controlled_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_facts f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_finishes',f.call_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_finishes f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_stops',s.call_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM subscription_controlled_stops s WHERE s.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_verifications',v.operation_id::text,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') FROM subscription_controlled_verifications v WHERE v.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_charge_origins',o.receipt_id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_charge_origins o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_closures',c.resource_id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM subscription_controlled_closures c WHERE c.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_provider_charge_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_provider_charge_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_payment_intent_ref=namespace_intent
  UNION ALL SELECT 'merchant_cash_return_inspections',i.id::text,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex') FROM namespace_inspections i
  UNION ALL SELECT 'merchant_cash_return_inspection_finishes',f.inspection_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_finishes f WHERE f.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'subscription_controlled_cash_inspection_lineages',actual_lineage.inspection_id::text,encode(sha256(convert_to(to_jsonb(actual_lineage)::text,'UTF8')),'hex') FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_inspection_stops',s.inspection_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_primary_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM merchant_cash_return_primary_observations p WHERE p.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_observations s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_refund_observations',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM refund_rows r
  UNION ALL SELECT 'merchant_refund_observation_captures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM merchant_refund_observation_captures c WHERE c.observation_id IN(SELECT id FROM refund_rows)
  UNION ALL SELECT 'merchant_agreement_payment_routes',a.payment_id::text,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') FROM namespace_aliases a
  UNION ALL SELECT 'payments',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM namespace_payments p
  UNION ALL SELECT 'merchant_payment_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_payment_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_ref=namespace_intent
  UNION ALL SELECT 'merchant_fee_refunds',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM namespace_fees f
  UNION ALL SELECT 'merchant_fee_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_fee_observations o WHERE o.operation_id IN(SELECT id FROM namespace_fees)
  UNION ALL SELECT 'merchant_refund_requests',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_requests r
  UNION ALL SELECT 'merchant_refund_reservation_retirements',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_reservation_retirements r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatches',d.id::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') FROM merchant_refund_dispatches d WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_finishes',f.dispatch_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_finishes f JOIN merchant_refund_dispatches d ON d.id=f.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_stops',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_stops s JOIN merchant_refund_dispatches d ON d.id=s.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_creation_refusals',r.dispatch_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_creation_refusals r JOIN merchant_refund_dispatches d ON d.id=r.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_terminal_receipts',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_terminal_receipts r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_resource_bindings',b.id::text,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'original_cash_recoveries',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM namespace_owners o
  UNION ALL SELECT 'original_cash_recovery_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM original_cash_recovery_operations o WHERE o.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM original_cash_recovery_facts f WHERE f.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_closures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM original_cash_recovery_closures c WHERE c.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'merchant_unapplied_charge_resolutions',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_resolutions r
  UNION ALL SELECT 'merchant_unapplied_charge_resolution_refunds',r.resolution_id::text||':'||r.observation_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_unapplied_charge_resolution_refunds r WHERE r.resolution_id IN(SELECT id FROM namespace_resolutions)
  UNION ALL SELECT 'legacy_bank_feedback',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM legacy_bank_feedback f
   WHERE f.evidence->>'observedChargeAccountId' IS NOT DISTINCT FROM namespace_account
    AND(f.evidence->>'observedPlatformAccountId' IS NULL OR f.evidence->>'observedPlatformAccountId'=namespace_platform)
    AND(f.evidence->>'observedPaymentRef'=namespace_intent OR(f.evidence->>'observedPaymentRef' IS NULL AND f.evidence->>'observedChargeRef'=receipt_row.provider_charge_ref)
     OR f.evidence->>'observedRefundRef' IN(SELECT b.provider_ref FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests))
     OR f.evidence->>'observedRefundRef' IN(SELECT f2.evidence->>'providerRef' FROM original_cash_recovery_facts f2 WHERE f2.recovery_id IN(SELECT id FROM namespace_owners) AND f2.kind='refund'))
 ),bounded_physical_rows AS(SELECT * FROM physical_rows ORDER BY family,identity LIMIT 5001)
 SELECT count(*),jsonb_agg(jsonb_build_object('table',family,'id',identity,'fingerprint',fingerprint) ORDER BY family,identity),
  encode(sha256(convert_to(string_agg(family||':'||identity||':'||fingerprint,E'\n' ORDER BY family,identity),'UTF8')),'hex') INTO witness_count,bank_witness,bank_fingerprint FROM bounded_physical_rows;
 IF witness_count>5000 THEN RETURN;END IF;
 actual_inspection_id=inspection_row.id;actual_observation_id=state_row.id;current_evidence=bank;admitted_source_history_digest=inspection_row.source_history_digest;
 original_expectation=resource_row.original_scope||jsonb_build_object('providerRef',namespace_intent,'chargeRef',receipt_row.provider_charge_ref,'amountMinor',receipt_row.amount_minor,'currency',receipt_row.currency,
  'originalFeeRef',receipt_row.application_fee_ref,'customerChargeVerified',receipt_row.customer_charge_verified,'merchantRouteVerified',receipt_row.merchant_route_verified);
 RETURN NEXT;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_atomic_auxiliary_fee_prepost_bank(target_auxiliary_uuid uuid)
RETURNS TABLE(actual_inspection_id uuid,actual_observation_id uuid,current_evidence jsonb,original_expectation jsonb,bank_witness jsonb,bank_fingerprint text,immutable_bank_fingerprint text,admitted_source_history_digest text)
LANGUAGE plpgsql STABLE AS $$
DECLARE own_call original_cash_recovery_operations%ROWTYPE;target_fact original_cash_recovery_facts%ROWTYPE;target_owner original_cash_recoveries%ROWTYPE;own_request jsonb;
 target_collection_uuid uuid;target_receipt_uuid uuid;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;origin_operation subscription_controlled_operations%ROWTYPE;origin_call subscription_controlled_calls%ROWTYPE;origin_fact subscription_controlled_facts%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;binding_row subscription_controlled_invoice_bindings%ROWTYPE;
 inspection_row merchant_cash_return_inspections%ROWTYPE;finish_row merchant_cash_return_inspection_finishes%ROWTYPE;state_row merchant_cash_return_observations%ROWTYPE;
 admitted_observation subscription_provider_charge_observations%ROWTYPE;source_cash jsonb;bank jsonb;state_count bigint;state_max integer;primary_count bigint;witness_count bigint;
 namespace_platform text;namespace_account text;namespace_intent text;
BEGIN
 -- This is ONLY the actual retained auxiliary's pre-POST bank view. The full
 -- namespace remains in bank_witness; no generic bank reader is relaxed.
 SELECT * INTO own_call FROM original_cash_recovery_operations WHERE id=target_auxiliary_uuid;
 own_request:=own_call.request;
 SELECT * INTO target_fact FROM original_cash_recovery_facts WHERE id=(own_request->>'targetFactId')::uuid AND kind='atomic_fee_target';
 SELECT * INTO target_owner FROM original_cash_recoveries WHERE id=own_call.recovery_id;
 IF own_call.id IS NULL OR target_fact.id IS NULL OR target_owner.id IS NULL
  OR own_call.kind IS DISTINCT FROM 'fee' OR target_fact.recovery_id IS DISTINCT FROM own_call.recovery_id
  OR target_fact.evidence->>'protocol' IS DISTINCT FROM 'freeholder.original-cash-atomic-fee-target.v1'
  OR own_request->>'atomicFeeProtocol' IS DISTINCT FROM 'freeholder.original-cash-atomic-fee-operation.v1'
  OR own_request->>'operationId' IS DISTINCT FROM own_call.id::text OR own_request->>'kind' IS DISTINCT FROM 'fee'
  OR own_call.nonce_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(current_setting('freeholder.original_atomic_fee_nonce',true),''),'UTF8')),'hex')
  OR coalesce(current_setting('freeholder.original_atomic_fee_nonce',true),'')=''
  OR jsonb_typeof(own_call.caller) IS DISTINCT FROM 'object' OR coalesce(own_call.caller->>'id','')!~'^[0-9a-f-]{36}$'
  OR own_request->>'providerPlatformAccountId' IS DISTINCT FROM target_fact.evidence->>'platform'
  OR own_request->>'originalChargeRef' IS DISTINCT FROM target_fact.evidence->>'chargeRef'
  OR own_request->>'originalAccountId' IS DISTINCT FROM target_fact.evidence->>'account'
  OR own_request->>'parentRef' IS DISTINCT FROM target_fact.evidence->>'feeRef'
  OR own_request->>'currency' IS DISTINCT FROM target_fact.evidence->>'currency'
  OR own_request->'originalAmountMinor' IS DISTINCT FROM target_fact.evidence->'originalFeeMinor'
  OR own_request->'alreadyReturnedMinor' IS DISTINCT FROM target_fact.evidence->'priorReturnedMinor'
  OR own_request->'amountMinor' IS DISTINCT FROM target_fact.evidence->'amountMinor'
  OR own_request->>'idempotencyKey' IS DISTINCT FROM 'original-cash-atomic-fee:'||target_fact.id::text
  OR own_request->>'frozenBody' IS DISTINCT FROM 'amount='||(target_fact.evidence->>'amountMinor')||'&metadata%5Bfreeholder_cash_auxiliary_id%5D='||own_call.id::text
  OR own_request->>'providerApiVersion' IS DISTINCT FROM target_owner.owner->'cash'->>'providerApiVersion'
  OR EXISTS(SELECT 1 FROM original_cash_recovery_facts terminal WHERE terminal.operation_id=own_call.id AND terminal.kind IN('finish','stop','ack','resource'))
  OR (SELECT count(*) FROM original_cash_recovery_facts observed WHERE observed.operation_id=own_call.id AND observed.kind='parent')<>1
  OR NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts observed WHERE observed.operation_id=own_call.id AND observed.kind='parent'
   AND observed.evidence->>'providerRef'=target_fact.evidence->>'feeRef' AND observed.evidence->>'accountId'=target_fact.evidence->>'account'
   AND observed.evidence->>'chargeRef'=target_fact.evidence->>'chargeRef' AND observed.evidence->'amountMinor'=target_fact.evidence->'originalFeeMinor'
   AND observed.evidence->'returnedMinor'=target_fact.evidence->'priorReturnedMinor' AND observed.evidence->>'currency'=target_fact.evidence->>'currency') THEN RETURN;END IF;
 target_collection_uuid:=(target_fact.evidence->>'collectionId')::uuid;target_receipt_uuid:=(target_fact.evidence->>'receiptId')::uuid;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=target_receipt_uuid;
 SELECT * INTO origin_row FROM subscription_controlled_charge_origins WHERE receipt_id=target_receipt_uuid;
 SELECT * INTO resource_row FROM subscription_controlled_resources WHERE id=origin_row.resource_id;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO quote_row FROM subscription_controlled_quotes WHERE id=collection_row.quote_id;
 SELECT * INTO binding_row FROM subscription_controlled_invoice_bindings WHERE collection_id=collection_row.id;
 SELECT * INTO origin_operation FROM subscription_controlled_operations WHERE id=origin_row.operation_id;
 SELECT * INTO origin_call FROM subscription_controlled_calls WHERE id=origin_row.call_id;
 SELECT * INTO origin_fact FROM subscription_controlled_facts WHERE id=origin_row.fact_id;
 source_cash=origin_fact.actual->'raw'->'cash';
 IF origin_fact.actual->'raw' ? '_freeholder_projection'
  AND NOT freeholder_controlled_safe_response_valid(origin_fact.actual->'raw','authority') THEN RETURN;END IF;
 IF receipt_row.id IS NULL OR origin_row.receipt_id IS NULL OR resource_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL
  OR quote_row.resource_id IS DISTINCT FROM resource_row.id OR binding_row.resource_id IS DISTINCT FROM resource_row.id
  OR binding_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref OR receipt_row.subscription_id IS DISTINCT FROM resource_row.subscription_id
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR quote_row.redacted_at IS NOT NULL
  OR receipt_row.provider_api_version IS DISTINCT FROM '2026-10-28.endive' OR receipt_row.provider_charge_ref IS NULL
  OR receipt_row.provider_platform_account_id IS DISTINCT FROM resource_row.original_scope->>'providerPlatformAccountId'
  OR receipt_row.charge_account_id IS DISTINCT FROM resource_row.original_scope->>'providerAccountId'
  OR receipt_row.actual_destination_account_id IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR receipt_row.actual_settlement_merchant_account_id IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR origin_operation.resource_id IS DISTINCT FROM resource_row.id OR origin_call.operation_id IS DISTINCT FROM origin_operation.id
  OR origin_fact.call_id IS DISTINCT FROM origin_call.id OR origin_fact.actual->>'kind' IS DISTINCT FROM 'cash_observed'
  OR source_cash->>'subscriptionId' IS DISTINCT FROM receipt_row.subscription_id::text
  OR source_cash->>'providerPaymentIntentRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR source_cash->>'providerInvoiceRef' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR source_cash->>'providerSubscriptionRef' IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR(source_cash->>'providerChargeRef' IS NOT NULL AND source_cash->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'destinationAccountId' IS DISTINCT FROM resource_row.original_scope->>'destinationAccountId'
  OR source_cash->>'settlementMerchantAccountId' IS DISTINCT FROM resource_row.original_scope->>'settlementMerchantAccountId'
  OR source_cash->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id OR source_cash->>'providerAccountId' IS DISTINCT FROM receipt_row.charge_account_id
  OR source_cash->>'providerCustomerRef' IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR origin_fact.actual->'raw'->'invoice'->>'id' IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR origin_fact.actual->'raw'->'intent'->>'id' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'customer') IS DISTINCT FROM resource_row.original_scope->>'providerCustomerRef'
  OR coalesce(freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'subscription'),freeholder_controlled_ref(origin_fact.actual->'raw'->'invoice'->'parent'->'subscription_details'->'subscription')) IS DISTINCT FROM receipt_row.provider_subscription_ref
  OR origin_fact.actual->'raw'->'intent'->>'amount_received' IS DISTINCT FROM receipt_row.amount_minor::text
  OR upper(origin_fact.actual->'raw'->'intent'->>'currency') IS DISTINCT FROM receipt_row.currency
  OR(freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS NOT NULL AND freeholder_controlled_ref(origin_fact.actual->'raw'->'intent'->'latest_charge') IS DISTINCT FROM receipt_row.provider_charge_ref)
  OR source_cash->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR source_cash->>'currency' IS DISTINCT FROM receipt_row.currency
  OR source_cash->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR source_cash->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb
  OR NOT receipt_row.customer_charge_verified OR NOT receipt_row.merchant_route_verified OR NOT coalesce(freeholder_controlled_callers_closed(resource_row.id),false) THEN RETURN;END IF;
 IF NOT coalesce(target_owner.payment_id::text=target_fact.evidence->>'paymentId'
  OR(target_owner.payment_id IS NULL AND target_owner.subscription_charge_receipt_id=receipt_row.id),false)
  OR target_owner.owner->'cash'->>'providerRef' IS DISTINCT FROM receipt_row.provider_payment_intent_ref
  OR target_owner.owner->'cash'->>'providerPlatformAccountId' IS DISTINCT FROM receipt_row.provider_platform_account_id
  OR target_owner.owner->'cash'->>'chargeAccountId' IS DISTINCT FROM receipt_row.charge_account_id
  OR NOT EXISTS(SELECT 1 FROM payments actual_payment JOIN merchant_agreement_payment_routes actual_route ON actual_route.payment_id=actual_payment.id
   WHERE actual_payment.id=(target_fact.evidence->>'paymentId')::uuid AND actual_payment.invoice_id=collection_row.invoice_id
    AND actual_route.original_charge_receipt_id=receipt_row.id AND actual_payment.provider_ref=receipt_row.provider_payment_intent_ref) THEN RETURN;END IF;
 namespace_platform=receipt_row.provider_platform_account_id;namespace_account=receipt_row.charge_account_id;namespace_intent=receipt_row.provider_payment_intent_ref;
 -- Real namespace-locked admission sequence and authenticated closed history,
 -- never transaction-start timestamps or UUID tie breaking. Unknown/later
 -- unsequenced or unfinished/negative reads cannot revive an older bank state.
 SELECT * INTO inspection_row FROM merchant_cash_return_inspections inspection
  WHERE inspection.id=freeholder_controlled_cash_read_latest(receipt_row.id)
   AND inspection.provider_platform_account_id=namespace_platform AND inspection.charge_account_id IS NOT DISTINCT FROM namespace_account AND inspection.original_payment_ref=namespace_intent;
 IF NOT EXISTS(SELECT 1 FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id
  AND actual_lineage.resource_id=resource_row.id AND actual_lineage.receipt_id=receipt_row.id
  AND actual_lineage.caller_instance_id::text=inspection_row.caller->>'id'
  AND actual_lineage.admission_fingerprint=encode(sha256(convert_to(to_jsonb(inspection_row)::text,'UTF8')),'hex')) THEN RETURN;END IF;
 IF inspection_row.id IS NULL OR inspection_row.subscription_charge_receipt_id IS DISTINCT FROM receipt_row.id OR inspection_row.payment_id IS NOT NULL
  OR inspection_row.original_observation_id IS NOT NULL OR inspection_row.original_cash_amount_minor IS DISTINCT FROM receipt_row.amount_minor
  OR inspection_row.currency IS DISTINCT FROM receipt_row.currency OR inspection_row.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version THEN RETURN;END IF;
 SELECT * INTO admitted_observation FROM subscription_provider_charge_observations WHERE id=inspection_row.subscription_charge_observation_id;
 IF admitted_observation.id IS NULL OR admitted_observation.subscription_id IS DISTINCT FROM receipt_row.subscription_id
  OR admitted_observation.provider_platform_account_id IS DISTINCT FROM namespace_platform OR admitted_observation.charge_account_id IS DISTINCT FROM namespace_account
  OR admitted_observation.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version OR admitted_observation.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref
  OR admitted_observation.provider_subscription_ref IS DISTINCT FROM receipt_row.provider_subscription_ref OR admitted_observation.provider_payment_intent_ref IS DISTINCT FROM namespace_intent
  OR admitted_observation.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref OR admitted_observation.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR admitted_observation.currency IS DISTINCT FROM receipt_row.currency THEN RETURN;END IF;
 SELECT * INTO finish_row FROM merchant_cash_return_inspection_finishes WHERE inspection_id=inspection_row.id;
 IF finish_row.inspection_id IS NULL OR finish_row.caller_instance_id::text IS DISTINCT FROM inspection_row.caller->>'id' OR finish_row.outcome IS DISTINCT FROM 'returned'
  OR EXISTS(SELECT 1 FROM merchant_cash_return_inspection_stops WHERE inspection_id=inspection_row.id) THEN RETURN;END IF;
 -- A stop closes ONLY the actual older caller. It cannot supply selected bank evidence.
 IF EXISTS(SELECT 1 FROM merchant_cash_return_inspections admitted
  LEFT JOIN merchant_cash_return_inspection_finishes finished ON finished.inspection_id=admitted.id
  LEFT JOIN merchant_cash_return_inspection_stops stopped ON stopped.inspection_id=admitted.id
  WHERE admitted.provider_platform_account_id=namespace_platform AND admitted.charge_account_id IS NOT DISTINCT FROM namespace_account AND admitted.original_payment_ref=namespace_intent
   AND((finished.inspection_id IS NOT NULL AND stopped.inspection_id IS NOT NULL)
    OR(finished.inspection_id IS NOT NULL AND(finished.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id' OR finished.outcome NOT IN('returned','threw')))
    OR(stopped.inspection_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM admitted.caller->>'id'
      OR stopped.admission_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(admitted)::text,'UTF8')),'hex') OR stopped.mechanical_check IS DISTINCT FROM 'original_process_absent'))
    OR(finished.inspection_id IS NULL AND stopped.inspection_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_dispatches dispatched JOIN merchant_refund_requests requested ON requested.id=dispatched.request_id
  LEFT JOIN merchant_refund_dispatch_finishes finished ON finished.dispatch_id=dispatched.id
  LEFT JOIN merchant_refund_dispatch_stops stopped ON stopped.dispatch_id=dispatched.id
  WHERE requested.provider_platform_account_id=namespace_platform AND requested.charge_account_id IS NOT DISTINCT FROM namespace_account AND requested.original_payment_ref=namespace_intent
   AND((finished.dispatch_id IS NOT NULL AND stopped.dispatch_id IS NOT NULL)
    OR(finished.dispatch_id IS NOT NULL AND finished.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id')
    OR(stopped.dispatch_id IS NOT NULL AND(stopped.caller_instance_id::text IS DISTINCT FROM dispatched.caller->>'id' OR stopped.request_digest IS DISTINCT FROM dispatched.request_digest))
    OR(finished.dispatch_id IS NULL AND stopped.dispatch_id IS NULL))) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM original_cash_recovery_operations physical_call JOIN original_cash_recoveries physical_owner ON physical_owner.id=physical_call.recovery_id
  WHERE physical_owner.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND physical_owner.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account
   AND physical_owner.owner->'cash'->>'providerRef'=namespace_intent AND physical_call.id<>own_call.id AND NOT EXISTS(SELECT 1 FROM original_cash_recovery_facts actual_finish WHERE actual_finish.operation_id=physical_call.id
    AND(actual_finish.kind='finish' AND actual_finish.evidence->>'callerInstanceId'=physical_call.caller->>'id' AND actual_finish.evidence->>'outcome' IN('returned','threw')
     OR actual_finish.kind='stop' AND actual_finish.evidence->>'operationDigest'=physical_call.digest))) THEN RETURN;END IF;
 SELECT count(*),max(sequence) INTO state_count,state_max FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id;
 SELECT * INTO state_row FROM merchant_cash_return_observations WHERE inspection_id=inspection_row.id ORDER BY sequence DESC LIMIT 1;
 SELECT count(*) INTO primary_count FROM merchant_cash_return_primary_observations WHERE inspection_id=inspection_row.id;
 IF state_count<1 OR state_count>5000 OR state_max IS DISTINCT FROM state_count OR primary_count<1 OR primary_count>5000
  OR EXISTS(SELECT 1 FROM merchant_cash_return_observations state WHERE state.inspection_id=inspection_row.id AND(state.sequence<1 OR state.sequence>state_count))
  OR EXISTS(SELECT 1 FROM merchant_cash_return_primary_observations primary_row WHERE primary_row.inspection_id=inspection_row.id
   AND(NOT freeholder_controlled_bank_minor(primary_row.evidence->'amountMinor',true) OR primary_row.evidence->>'providerRef' IS DISTINCT FROM namespace_intent
    OR NOT coalesce(primary_row.evidence->>'status'='succeeded' OR(primary_row.evidence->>'status'='failed' AND state_row.evidence->>'paymentIntentStatus'='canceled'),false)
    OR primary_row.evidence->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR primary_row.evidence->>'providerAccountId' IS DISTINCT FROM namespace_account
    OR primary_row.evidence->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR primary_row.evidence->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text
    OR primary_row.evidence->>'currency' IS DISTINCT FROM receipt_row.currency OR primary_row.evidence->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref)) THEN RETURN;END IF;
 bank=state_row.evidence;
 IF jsonb_typeof(bank) IS DISTINCT FROM 'object' OR bank->>'providerPlatformAccountId' IS DISTINCT FROM namespace_platform OR bank->>'chargeAccountId' IS DISTINCT FROM namespace_account
  OR bank->>'providerApiVersion' IS DISTINCT FROM receipt_row.provider_api_version OR bank->>'paymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'providerChargeRef' IS DISTINCT FROM receipt_row.provider_charge_ref
  OR bank->>'amountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'currency' IS DISTINCT FROM receipt_row.currency
  OR bank->>'chargePaymentProviderRef' IS DISTINCT FROM namespace_intent OR bank->>'chargeAmountMinor' IS DISTINCT FROM receipt_row.amount_minor::text OR bank->>'chargeCurrency' IS DISTINCT FROM receipt_row.currency
  OR bank->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR bank->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(bank->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(bank->'disputes') IS DISTINCT FROM 'array' THEN RETURN;END IF;
 IF jsonb_array_length(bank->'refunds')>1000 OR jsonb_array_length(bank->'disputes')>1000 THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM merchant_refund_observations refund_row WHERE refund_row.inspection_id=inspection_row.id
  AND(refund_row.provider_platform_account_id IS DISTINCT FROM namespace_platform OR refund_row.charge_account_id IS DISTINCT FROM namespace_account
   OR refund_row.payment_provider_ref IS DISTINCT FROM namespace_intent OR refund_row.currency IS DISTINCT FROM receipt_row.currency
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bank->'refunds') actual_refund WHERE actual_refund->>'providerRef'=refund_row.provider_ref
    AND actual_refund->>'paymentProviderRef'=refund_row.payment_provider_ref AND actual_refund->>'chargeRef'=refund_row.provider_charge_ref
    AND actual_refund->>'amountMinor'=refund_row.amount_minor::text AND actual_refund->>'currency'=refund_row.currency AND actual_refund->>'status'=refund_row.status))) THEN RETURN;END IF;
 immutable_bank_fingerprint=encode(sha256(convert_to(jsonb_build_object('receiptId',receipt_row.id,'origin',to_jsonb(origin_row),'originalOperation',to_jsonb(origin_operation),
  'originalCall',to_jsonb(origin_call),'originalFact',to_jsonb(origin_fact),'inspection',to_jsonb(inspection_row),'finish',to_jsonb(finish_row),'latestState',to_jsonb(state_row),
  'actualAdmissionLineage',(SELECT to_jsonb(actual_lineage) FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id=inspection_row.id),
  'primary',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM merchant_cash_return_primary_observations p WHERE p.inspection_id=inspection_row.id),
  'ownRefunds',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM merchant_refund_observations r WHERE r.inspection_id=inspection_row.id))::text,'UTF8')),'hex');
 WITH namespace_inspections AS(SELECT i.* FROM merchant_cash_return_inspections i WHERE i.provider_platform_account_id=namespace_platform AND i.charge_account_id IS NOT DISTINCT FROM namespace_account AND i.original_payment_ref=namespace_intent),
 resource_calls AS(SELECT c.* FROM subscription_controlled_calls c JOIN subscription_controlled_operations o ON o.id=c.operation_id WHERE o.resource_id=resource_row.id),
 namespace_requests AS(SELECT r.* FROM merchant_refund_requests r WHERE r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent),
 namespace_aliases AS(SELECT r.* FROM merchant_agreement_payment_routes r WHERE r.original_charge_receipt_id=receipt_row.id),
 namespace_payments AS(SELECT p.* FROM payments p WHERE p.id IN(SELECT payment_id FROM namespace_aliases)
  OR p.id IN(SELECT m.payment_id FROM merchant_payment_observations m WHERE m.provider_platform_account_id=namespace_platform AND m.charge_account_id IS NOT DISTINCT FROM namespace_account AND m.provider_ref=namespace_intent)),
 namespace_fees AS(SELECT f.* FROM merchant_fee_refunds f WHERE f.original_charge_receipt_id=receipt_row.id OR f.payment_id IN(SELECT id FROM namespace_payments)),
 namespace_owners AS(SELECT o.* FROM original_cash_recoveries o WHERE o.subscription_charge_receipt_id=receipt_row.id
  OR(o.owner->'cash'->>'providerPlatformAccountId'=namespace_platform AND o.owner->'cash'->>'chargeAccountId' IS NOT DISTINCT FROM namespace_account AND o.owner->'cash'->>'providerRef'=namespace_intent)),
 namespace_resolutions AS(SELECT r.* FROM merchant_unapplied_charge_resolutions r WHERE r.subscription_charge_receipt_id=receipt_row.id
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.original_payment_ref=namespace_intent)),
 refund_rows AS(SELECT r.* FROM merchant_refund_observations r WHERE r.inspection_id IN(SELECT id FROM namespace_inspections)
  OR(r.provider_platform_account_id=namespace_platform AND r.charge_account_id IS NOT DISTINCT FROM namespace_account AND r.payment_provider_ref=namespace_intent)),
 physical_rows AS(
  SELECT 'subscription_provider_charge_receipts'::text family,receipt_row.id::text identity,encode(sha256(convert_to(to_jsonb(receipt_row)::text,'UTF8')),'hex') fingerprint
  UNION ALL SELECT 'subscription_controlled_resources',resource_row.id::text,encode(sha256(convert_to(to_jsonb(resource_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_collections',collection_row.id::text,encode(sha256(convert_to(to_jsonb(collection_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_quotes',quote_row.id::text,encode(sha256(convert_to(to_jsonb(quote_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_invoice_bindings',binding_row.collection_id::text,encode(sha256(convert_to(to_jsonb(binding_row)::text,'UTF8')),'hex')
  UNION ALL SELECT 'subscription_controlled_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_operations o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_calls',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM resource_calls c
  UNION ALL SELECT 'subscription_controlled_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_facts f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_finishes',f.call_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM subscription_controlled_finishes f WHERE f.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_stops',s.call_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM subscription_controlled_stops s WHERE s.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_verifications',v.operation_id::text,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') FROM subscription_controlled_verifications v WHERE v.call_id IN(SELECT id FROM resource_calls)
  UNION ALL SELECT 'subscription_controlled_charge_origins',o.receipt_id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_controlled_charge_origins o WHERE o.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_controlled_closures',c.resource_id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM subscription_controlled_closures c WHERE c.resource_id=resource_row.id
  UNION ALL SELECT 'subscription_provider_charge_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM subscription_provider_charge_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_payment_intent_ref=namespace_intent
  UNION ALL SELECT 'merchant_cash_return_inspections',i.id::text,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex') FROM namespace_inspections i
  UNION ALL SELECT 'merchant_cash_return_inspection_finishes',f.inspection_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_finishes f WHERE f.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'subscription_controlled_cash_inspection_lineages',actual_lineage.inspection_id::text,encode(sha256(convert_to(to_jsonb(actual_lineage)::text,'UTF8')),'hex') FROM subscription_controlled_cash_inspection_lineages actual_lineage WHERE actual_lineage.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_inspection_stops',s.inspection_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_inspection_stops s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_primary_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM merchant_cash_return_primary_observations p WHERE p.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_cash_return_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_cash_return_observations s WHERE s.inspection_id IN(SELECT id FROM namespace_inspections)
  UNION ALL SELECT 'merchant_refund_observations',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM refund_rows r
  UNION ALL SELECT 'merchant_refund_observation_captures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM merchant_refund_observation_captures c WHERE c.observation_id IN(SELECT id FROM refund_rows)
  UNION ALL SELECT 'merchant_agreement_payment_routes',a.payment_id::text,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') FROM namespace_aliases a
  UNION ALL SELECT 'payments',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') FROM namespace_payments p
  UNION ALL SELECT 'merchant_payment_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_payment_observations o WHERE o.provider_platform_account_id=namespace_platform AND o.charge_account_id IS NOT DISTINCT FROM namespace_account AND o.provider_ref=namespace_intent
  UNION ALL SELECT 'merchant_fee_refunds',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM namespace_fees f
  UNION ALL SELECT 'merchant_fee_observations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM merchant_fee_observations o WHERE o.operation_id IN(SELECT id FROM namespace_fees)
  UNION ALL SELECT 'merchant_refund_requests',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_requests r
  UNION ALL SELECT 'merchant_refund_reservation_retirements',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_reservation_retirements r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatches',d.id::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') FROM merchant_refund_dispatches d WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_finishes',f.dispatch_id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_finishes f JOIN merchant_refund_dispatches d ON d.id=f.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_dispatch_stops',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM merchant_refund_dispatch_stops s JOIN merchant_refund_dispatches d ON d.id=s.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_creation_refusals',r.dispatch_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_creation_refusals r JOIN merchant_refund_dispatches d ON d.id=r.dispatch_id WHERE d.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_terminal_receipts',r.request_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_refund_terminal_receipts r WHERE r.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'merchant_refund_resource_bindings',b.id::text,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests)
  UNION ALL SELECT 'original_cash_recoveries',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM namespace_owners o
  UNION ALL SELECT 'original_cash_recovery_operations',o.id::text,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') FROM original_cash_recovery_operations o WHERE o.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_facts',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM original_cash_recovery_facts f WHERE f.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'original_cash_recovery_closures',c.id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM original_cash_recovery_closures c WHERE c.recovery_id IN(SELECT id FROM namespace_owners)
  UNION ALL SELECT 'merchant_unapplied_charge_resolutions',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM namespace_resolutions r
  UNION ALL SELECT 'merchant_unapplied_charge_resolution_refunds',r.resolution_id::text||':'||r.observation_id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') FROM merchant_unapplied_charge_resolution_refunds r WHERE r.resolution_id IN(SELECT id FROM namespace_resolutions)
  UNION ALL SELECT 'legacy_bank_feedback',f.id::text,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') FROM legacy_bank_feedback f
   WHERE f.evidence->>'observedChargeAccountId' IS NOT DISTINCT FROM namespace_account
    AND(f.evidence->>'observedPlatformAccountId' IS NULL OR f.evidence->>'observedPlatformAccountId'=namespace_platform)
    AND(f.evidence->>'observedPaymentRef'=namespace_intent OR(f.evidence->>'observedPaymentRef' IS NULL AND f.evidence->>'observedChargeRef'=receipt_row.provider_charge_ref)
     OR f.evidence->>'observedRefundRef' IN(SELECT b.provider_ref FROM merchant_refund_resource_bindings b WHERE b.request_id IN(SELECT id FROM namespace_requests))
     OR f.evidence->>'observedRefundRef' IN(SELECT f2.evidence->>'providerRef' FROM original_cash_recovery_facts f2 WHERE f2.recovery_id IN(SELECT id FROM namespace_owners) AND f2.kind='refund'))
 ),bounded_physical_rows AS(SELECT * FROM physical_rows ORDER BY family,identity LIMIT 5001)
 SELECT count(*),jsonb_agg(jsonb_build_object('table',family,'id',identity,'fingerprint',fingerprint) ORDER BY family,identity),
  encode(sha256(convert_to(string_agg(family||':'||identity||':'||fingerprint,E'\n' ORDER BY family,identity),'UTF8')),'hex') INTO witness_count,bank_witness,bank_fingerprint FROM bounded_physical_rows;
 IF witness_count>5000 THEN RETURN;END IF;
 actual_inspection_id=inspection_row.id;actual_observation_id=state_row.id;current_evidence=bank;admitted_source_history_digest=inspection_row.source_history_digest;
 original_expectation=resource_row.original_scope||jsonb_build_object('providerRef',namespace_intent,'chargeRef',receipt_row.provider_charge_ref,'amountMinor',receipt_row.amount_minor,'currency',receipt_row.currency,
  'originalFeeRef',receipt_row.application_fee_ref,'customerChargeVerified',receipt_row.customer_charge_verified,'merchantRouteVerified',receipt_row.merchant_route_verified);
 RETURN NEXT;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_controlled_subscription_route_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(freeholder_controlled_safe_response_ready() AND 
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_subscription_route_valid(jsonb)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c43cf639e0f7ff4840a87aa219cd597b4463b4eb4e4be2d33b399e8022647d1a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_agreement_payment_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1499929d2e393ff2eadd4c43f1a601044be62ea60ac72a41713e9dcff420829a')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5315979c10ffba43177521dccf94ab401442f724f9bb372eb24802327d391c6f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_batch()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d4eec6cffbc37e319f492d16e1c1914bc1fae9cc2ead53d66f184805d73cd524')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_guard_receipt()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='69cc878883175b6353bfa7a7caafedb3198627b3d7061ec626e49badf466d959')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_receipts_complete(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a92e7fdbbff4386fd0944ebcae90a7f25dff9d27f47fcf6ec4ae777eb0eb5af0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_before_settlement(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='49bcc680eb768f599b569ca8238e7223403bada4bb90881028f034d166966b9f')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_stage(uuid,uuid,uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a40dd083ee120f238c2c58b19890e4f2f20110c6cc3af12eaa90f203413af7d6')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_application_shape(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='027064eb6d584f33c68dee5e671d2184affa381d9673fcd0706a467839c9929e')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_atomic_fee_valid(uuid,bigint,numeric,numeric)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8b6c12df24f5758a11af8b3dce53a045b86f488c13409e49f88c41084548dce0')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_guard_agreement_fee()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d91fd819a23c05940a0392b407d8bae1a107afb980264fbb67cbc2ce47628d57')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_cash_bank_invoice(uuid)') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='924bc14757d4a81109e06e151f5aee93678bdd2274e927bbbfd56e7ba2e41bcd')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_bank_minor(jsonb,boolean)') AND p.provolatile='i' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='05d891ce5a52f018a9c5b6f21d9c3ae43f68d7abd7e831fb2cf512cff476a68e')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_subscription_period_cash_application()') AND p.provolatile='v' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='45821c8b9b091cd3af998039a832e38fdbf04a4861793afd95bb3a31f527064d')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_period_lineage' AND t.tgfoid=to_regprocedure('freeholder_subscription_period_cash_application()') AND t.tgenabled IN('O','A') AND t.tgtype=7 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freeholder_atomic_auxiliary_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(freeholder_controlled_safe_response_ready() AND 
  EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_prepost_bank(uuid)') AND installed.provolatile='s' AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='cc411ba4d6fb3dad97e075a5db65c0b5557e1aa1f438bf4666360391b4ef8377')
  AND   EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_fee_return_resources(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='91fd305274ea123483945235f43f2bfc5cf18207eb7701f590f056c08cebdb4f')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_bank_state(uuid)') AND installed.provolatile='s' AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='e79e9ded007256dc64ebfe80a2e19c2e93b20dd47c0b137f1b51d7467ba54f59')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_target_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='9c00662eaf2303b5eb83c03cf7101fb827caaddeb3966bc0eef2e0776af70828')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_operation_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='1f4065b9702072d0eb8454f70c26a8895e75ba0070e18ded3831cfcd6e185814')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_atomic_auxiliary_fee_closure_valid(jsonb)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='dcd015356603867feb6e173b7d082d057dd6112485b72dec31fc528ee1902ec2')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='1971de37dfc39be8ca4178ee86c9684e699c92e875b1de35f5d4d4b3d83758fc')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='da88bad09a1b87c8abc12856586fe9e1debfe0b72e192e46971677f4fad92eeb')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_controlled_atomic_refund_fee_state(uuid)') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='7564bec682b47fba4517097002e7c1e92da6aca21f4a7c678ddb080da08a4f3d')
  AND EXISTS(SELECT 1 FROM pg_proc installed WHERE installed.oid=to_regprocedure('freeholder_merchant_fee_invocations_ready()') AND encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')='98a0b6c71aafd07c27bb3b7b198040041ba80e80ab3161e09497041cbc5da047')
  AND freeholder_merchant_fee_invocations_ready()
  AND (SELECT count(*) FROM pg_trigger installed WHERE installed.tgname='original_cash_recovery_guard' AND installed.tgrelid IN('original_cash_recoveries'::regclass,'original_cash_recovery_operations'::regclass,'original_cash_recovery_facts'::regclass,'original_cash_recovery_closures'::regclass) AND installed.tgfoid=to_regprocedure('freeholder_guard_original_cash_recovery()') AND installed.tgtype=31 AND installed.tgenabled IN('O','A') AND NOT installed.tgisinternal)=4
  AND EXISTS(SELECT 1 FROM pg_constraint installed WHERE installed.conrelid='original_cash_recovery_facts'::regclass AND installed.conname='original_cash_recovery_facts_kind' AND installed.contype='c' AND installed.convalidated AND pg_get_expr(installed.conbin,installed.conrelid)='(kind = ANY (ARRAY[''primary''::text, ''refund''::text, ''state''::text, ''parent''::text, ''ack''::text, ''resource''::text, ''finish''::text, ''stop''::text, ''legacy_fee_stop''::text, ''customer_request''::text, ''partial_target''::text, ''partial_closure''::text, ''unassigned_refund_review''::text, ''atomic_fee_target''::text, ''atomic_fee_closure''::text]))')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_target' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetKey''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_target''::text)')
  AND EXISTS(SELECT 1 FROM pg_index installed JOIN pg_class idx ON idx.oid=installed.indexrelid WHERE installed.indrelid='original_cash_recovery_facts'::regclass AND idx.relname='original_cash_atomic_fee_closure' AND installed.indisunique AND installed.indisvalid AND installed.indisready AND installed.indkey::text='2 0 0' AND pg_get_expr(installed.indexprs,installed.indrelid)='(evidence ->> ''targetFactId''::text), (evidence ->> ''revision''::text)' AND pg_get_expr(installed.indpred,installed.indrelid)='(kind = ''atomic_fee_closure''::text)'),false);
$$;
--> statement-breakpoint
