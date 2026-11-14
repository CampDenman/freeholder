-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33/C1.08: ordinary refund timestamp; no new cash authority.
-- Append after the complete725367-byte qualified160 prefix; old guards unchanged.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment_uuid uuid;target_invoice_uuid uuid;before_row jsonb;after_row jsonb;candidate record;
BEGIN
 after_row=to_jsonb(NEW);IF TG_OP='UPDATE' THEN before_row=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='payments' THEN
  -- Existing refund counters/statuses do not create a new cash application.
  IF TG_OP='UPDATE' AND(before_row-ARRAY['refunded_minor','failure_code','failure_message'])=(after_row-ARRAY['refunded_minor','failure_code','failure_message']) THEN RETURN NEW;END IF;
  -- A genuine ordinary refund also carries the canonical database-TX timestamp.
  -- This branch grants no refund authority and cannot change cash/origin identity.
  IF TG_OP='UPDATE' AND NEW.updated_at=now()
   AND(before_row-ARRAY['refunded_minor','failure_code','failure_message','updated_at'])=(after_row-ARRAY['refunded_minor','failure_code','failure_message','updated_at']) THEN RETURN NEW;END IF;
  target_payment_uuid=(after_row->>'id')::uuid;target_invoice_uuid=(after_row->>'invoice_id')::uuid;
  IF TG_OP='UPDATE' AND before_row->>'invoice_id' IS DISTINCT FROM after_row->>'invoice_id'
   AND EXISTS(SELECT 1 FROM subscription_controlled_collections accepted_before WHERE accepted_before.invoice_id=(before_row->>'invoice_id')::uuid) THEN
   RAISE EXCEPTION 'An original controlled canonical payment cannot leave its accepted target' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='merchant_agreement_payment_routes' THEN
  target_payment_uuid=(after_row->>'payment_id')::uuid;SELECT p.invoice_id INTO target_invoice_uuid FROM payments p WHERE p.id=target_payment_uuid;
 ELSIF TG_TABLE_NAME='invoices' THEN
  target_invoice_uuid=(after_row->>'id')::uuid;
  IF TG_OP='UPDATE' AND before_row->>'paid_minor' IS NOT DISTINCT FROM after_row->>'paid_minor'
   AND before_row->>'paid_at' IS NOT DISTINCT FROM after_row->>'paid_at'
   AND(before_row->>'status' IS NOT DISTINCT FROM after_row->>'status' OR after_row->>'status'<>'paid') THEN RETURN NEW;END IF;
  -- Zero cash/credit-only invoice completion retains its separate existing
  -- canonical issued-credit guards; it cannot invent a receipt/payment here.
  IF (after_row->>'paid_minor')::bigint=0 THEN RETURN NEW;END IF;
 ELSE RAISE EXCEPTION 'Unknown controlled cash application boundary' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM subscription_controlled_collections accepted_target WHERE accepted_target.invoice_id=target_invoice_uuid) THEN RETURN NEW;END IF;
 IF target_payment_uuid IS NOT NULL THEN
  IF freeholder_controlled_cash_application_shape(target_payment_uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Controlled cash needs its genuine same-receipt current bank and parent application proof; marker, amount or manifest alone is insufficient' USING ERRCODE='23514';END IF;
 ELSE
  FOR candidate IN SELECT p.id FROM payments p WHERE p.invoice_id=target_invoice_uuid AND p.status='succeeded' LOOP
   IF freeholder_controlled_cash_application_shape(candidate.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Every actually paid controlled receipt needs its independent complete original application proof' USING ERRCODE='23514';END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=target_invoice_uuid AND p.status='succeeded') THEN RAISE EXCEPTION 'A paid controlled cash balance cannot be invented without its real receipt-owned payment' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
