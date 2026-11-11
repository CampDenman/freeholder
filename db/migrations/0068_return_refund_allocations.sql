-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking Prepared return refunds require the new trusted confirmation path; the previous image remains readable but its generic settlement path must fail closed. Restore the pre-upgrade database and objects for a complete rollback.
-- C5.19: freeze the original tender allocation before any refund operation.
CREATE TABLE return_refund_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 return_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
 payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL,
 currency text NOT NULL,
 provider text NOT NULL,
 provider_account_id text NOT NULL DEFAULT '',
 application_fee_minor bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT return_refund_allocations_amount_check CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
 CONSTRAINT return_refund_allocations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
 CONSTRAINT return_refund_allocations_fee_check CHECK (application_fee_minor BETWEEN 0 AND 9007199254740991),
 CONSTRAINT return_refund_allocations_account_check CHECK (provider_account_id='' OR (provider='stripe' AND provider_account_id ~ '^acct_[A-Za-z0-9]+$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX return_refund_allocations_payment_idx ON return_refund_allocations(return_id,payment_id);
--> statement-breakpoint
CREATE FUNCTION guard_return_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'A return refund allocation is immutable.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_refund_allocation_immutable BEFORE UPDATE ON return_refund_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_return_refund_allocation();
--> statement-breakpoint
-- Failed/cancelled attempts release their ledger reservation, but their
-- original tender allocation remains owed. Protect it from other refunds,
-- including writes from the immediately previous application image.
CREATE FUNCTION freeholder_refund_amount_available(target_payment uuid, request_key text, requested_minor bigint)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH active AS (
  SELECT amount_minor,idempotency_key FROM refunds
  WHERE payment_id=target_payment AND status IN ('created','processing','succeeded')
 ), plans AS (
  SELECT a.amount_minor,
   COALESCE((SELECT sum(r.amount_minor) FROM active r WHERE
    r.idempotency_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%'
    OR r.idempotency_key='return:'||a.return_id::text||':refund:'||a.payment_id::text
    OR r.idempotency_key LIKE 'return:'||a.return_id::text||':provider:%:'||a.payment_id::text),0) AS represented,
   (request_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%'
    OR request_key='return:'||a.return_id::text||':refund:'||a.payment_id::text
    OR request_key LIKE 'return:'||a.return_id::text||':provider:%:'||a.payment_id::text) AS claimant
  FROM return_refund_allocations a WHERE a.payment_id=target_payment
 )
 SELECT COALESCE((SELECT requested_minor>0
  AND NOT EXISTS (SELECT 1 FROM plans WHERE represented>amount_minor OR (claimant AND represented+requested_minor>amount_minor))
  AND COALESCE((SELECT sum(amount_minor) FROM active),0)+requested_minor+
   COALESCE((SELECT sum(greatest(amount_minor-represented-CASE WHEN claimant THEN requested_minor ELSE 0 END,0)) FROM plans),0)
   <=p.amount_minor
  FROM payments p WHERE p.id=target_payment AND p.status='succeeded'),false);
$$;
--> statement-breakpoint
CREATE FUNCTION guard_refund_original_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('payment:'||NEW.payment_id::text));
 IF NEW.status IN ('created','processing','succeeded') AND NOT freeholder_refund_amount_available(NEW.payment_id,NEW.idempotency_key,NEW.amount_minor) THEN
  RAISE EXCEPTION 'The original payment amount is reserved for a prepared return.'
   USING ERRCODE='23514',CONSTRAINT='refund_return_allocation_budget';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_original_allocation_budget BEFORE INSERT ON refunds
 FOR EACH ROW EXECUTE FUNCTION guard_refund_original_allocation();
--> statement-breakpoint
CREATE FUNCTION freeholder_refund_is_prepared_return(target_refund uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM refunds r JOIN return_refund_allocations a ON a.payment_id=r.payment_id
 WHERE r.id=target_refund AND (
  r.idempotency_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%'
  OR r.idempotency_key='return:'||a.return_id::text||':refund:'||a.payment_id::text
  OR r.idempotency_key LIKE 'return:'||a.return_id::text||':provider:%:'||a.payment_id::text));
$$;
--> statement-breakpoint
-- The previous image must fail closed on a new prepared return, rather than
-- accepting a generic financial command as provider or offline confirmation.
CREATE FUNCTION guard_prepared_return_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='succeeded' AND OLD.status<>'succeeded'
  AND freeholder_refund_is_prepared_return(NEW.id)
  AND current_setting('freeholder.confirmed_return_refund',true) IS DISTINCT FROM NEW.id::text THEN
  RAISE EXCEPTION 'A prepared return needs its verified original payment confirmation.'
   USING ERRCODE='23514',CONSTRAINT='prepared_return_refund_confirmation';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prepared_return_refund_confirmation BEFORE UPDATE ON refunds
 FOR EACH ROW EXECUTE FUNCTION guard_prepared_return_confirmation();
