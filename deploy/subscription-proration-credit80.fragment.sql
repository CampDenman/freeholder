-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C9.33/C12.38: OWNED UNAPPLIED lifecycle tail AFTER1da78852ed7ba94a2e77596fe8b41bebc3ce3c174d79dacc7a60c933a98b4d46.
-- Root owns new assembly/hash/NEW normal DB. Earlier schemas and all original evidence stay frozen.
ALTER TABLE invoices ADD COLUMN credited_minor bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Preserve exact existing model CHECK identities when original noncash credit
-- becomes canonical consideration. A separate credited bound does not replace
-- the full named invoice amount/consideration invariants.
ALTER TABLE invoices DROP CONSTRAINT invoices_amounts_nonnegative;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_nonnegative CHECK(subtotal_minor>=0 AND discount_minor>=0 AND shipping_minor>=0 AND tax_minor>=0 AND total_minor>=0 AND paid_minor>=0 AND credited_minor>=0 AND refunded_minor>=0);
--> statement-breakpoint
ALTER TABLE invoices DROP CONSTRAINT invoices_paid_bounded;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_bounded CHECK(paid_minor+credited_minor<=total_minor);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_credited_bounded CHECK(credited_minor between 0 and 9007199254740991 AND paid_minor+credited_minor<=total_minor);
--> statement-breakpoint
ALTER TABLE invoices DROP CONSTRAINT invoices_paid_consistent;
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_consistent CHECK(status<>'paid' OR(paid_minor+credited_minor=total_minor AND paid_at IS NOT NULL));
--> statement-breakpoint
CREATE TABLE invoice_credit_funding (
 id uuid PRIMARY KEY,credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE RESTRICT,credit_note_line_id uuid NOT NULL REFERENCES credit_note_lines(id) ON DELETE RESTRICT,
 source_invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,source_payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,source_application_id uuid,
 proration_id uuid NOT NULL,amount_minor bigint NOT NULL,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_credit_funding_amount CHECK(amount_minor between 1 and 9007199254740991 AND original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX invoice_credit_funding_note ON invoice_credit_funding(credit_note_id);
--> statement-breakpoint
CREATE INDEX invoice_credit_funding_payment ON invoice_credit_funding(source_payment_id);
--> statement-breakpoint
CREATE INDEX invoice_credit_funding_origin ON invoice_credit_funding(proration_id);
--> statement-breakpoint
CREATE TABLE invoice_credit_reservations (
 id uuid PRIMARY KEY,funding_id uuid NOT NULL REFERENCES invoice_credit_funding(id) ON DELETE RESTRICT,target_source_id text NOT NULL,amount_minor bigint NOT NULL,
 idempotency_key text NOT NULL,request_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_credit_reservations_amount CHECK(amount_minor between 1 and 9007199254740991 AND request_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_credit_reservations_key ON invoice_credit_reservations(idempotency_key);
--> statement-breakpoint
CREATE INDEX invoice_credit_reservations_funding ON invoice_credit_reservations(funding_id);
--> statement-breakpoint
CREATE INDEX invoice_credit_reservations_source ON invoice_credit_reservations(target_source_id);
--> statement-breakpoint
CREATE TABLE invoice_credit_applications (
 reservation_id uuid PRIMARY KEY REFERENCES invoice_credit_reservations(id) ON DELETE RESTRICT,invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 original_owner_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT invoice_credit_applications_owner CHECK(original_owner_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX invoice_credit_applications_invoice ON invoice_credit_applications(invoice_id);
--> statement-breakpoint
ALTER TABLE invoice_credit_funding ADD CONSTRAINT invoice_credit_funding_source_application FOREIGN KEY(source_application_id) REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE invoice_credit_releases (
 reservation_id uuid PRIMARY KEY REFERENCES invoice_credit_reservations(id) ON DELETE RESTRICT,reviewed_by text NOT NULL,reason_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_credit_releases_actor CHECK(reviewed_by ~ '^(user:|agent:|system$)' AND reason_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
-- Issuing a noncash credit reserves principal even before it is applied. A
-- released target reservation leaves the issued customer credit promise intact.
CREATE FUNCTION freeholder_credit_principal_reserved(target uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(f.amount_minor),0)::bigint FROM invoice_credit_funding f JOIN credit_notes c ON c.id=f.credit_note_id WHERE f.source_payment_id=target AND f.source_application_id IS NULL AND c.status='issued'
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_refund_capacity(target uuid,request_key text,requested bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH active AS(SELECT amount_minor,idempotency_key FROM refunds WHERE payment_id=target AND status IN('created','processing','succeeded')),
 plans AS(SELECT a.amount_minor,coalesce((SELECT sum(r.amount_minor) FROM active r WHERE
   r.idempotency_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%'
   OR r.idempotency_key='return:'||a.return_id::text||':refund:'||a.payment_id::text OR r.idempotency_key LIKE 'return:'||a.return_id::text||':provider:%:'||a.payment_id::text),0) represented,
   (request_key LIKE 'return:'||a.return_id::text||':allocation:'||a.id::text||':%' OR request_key='return:'||a.return_id::text||':refund:'||a.payment_id::text
    OR request_key LIKE 'return:'||a.return_id::text||':provider:%:'||a.payment_id::text) claimant
  FROM return_refund_allocations a WHERE a.payment_id=target)
 SELECT coalesce((SELECT coalesce((SELECT sum(amount_minor) FROM active),0)+requested
  +coalesce((SELECT sum(greatest(amount_minor-represented-CASE WHEN claimant THEN requested ELSE 0 END,0)) FROM plans),0)
  +freeholder_credit_principal_reserved(target)<=p.amount_minor FROM payments p WHERE p.id=target AND p.status='succeeded'),false)
$$;
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_refund_credit_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('payment:'||NEW.payment_id::text));
 IF NEW.status IN('created','processing','succeeded') AND NOT freeholder_credit_refund_capacity(NEW.payment_id,NEW.idempotency_key,NEW.amount_minor) THEN
  RAISE EXCEPTION 'The exact original payment principal also backs an issued noncash credit; it cannot be returned again' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_credit_principal_guard BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION freeholder_guard_refund_credit_principal();
--> statement-breakpoint
CREATE FUNCTION freeholder_guard_invoice_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE funding invoice_credit_funding%ROWTYPE; reservation invoice_credit_reservations%ROWTYPE; note credit_notes%ROWTYPE; line credit_note_lines%ROWTYPE;
 source invoices%ROWTYPE; target invoices%ROWTYPE; payment payments%ROWTYPE; used bigint; parent_application invoice_credit_applications%ROWTYPE; parent_reservation invoice_credit_reservations%ROWTYPE; parent_funding invoice_credit_funding%ROWTYPE;
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
   IF reservation.id IS NULL OR target.id IS NULL OR target.source_type<>'subscription' OR target.source_id IS DISTINCT FROM reservation.target_source_id
    OR target.contact_id IS DISTINCT FROM source.contact_id OR target.currency IS DISTINCT FROM source.currency OR source.refunded_minor<>0
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
--> statement-breakpoint
CREATE TRIGGER invoice_credit_funding_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_credit_funding FOR EACH ROW EXECUTE FUNCTION freeholder_guard_invoice_credit();
--> statement-breakpoint
CREATE TRIGGER invoice_credit_reservations_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_credit_reservations FOR EACH ROW EXECUTE FUNCTION freeholder_guard_invoice_credit();
--> statement-breakpoint
CREATE TRIGGER invoice_credit_applications_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_credit_applications FOR EACH ROW EXECUTE FUNCTION freeholder_guard_invoice_credit();
--> statement-breakpoint
CREATE TRIGGER invoice_credit_releases_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_credit_releases FOR EACH ROW EXECUTE FUNCTION freeholder_guard_invoice_credit();
--> statement-breakpoint
CREATE FUNCTION freeholder_invoice_credit_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual bigint;
BEGIN
 SELECT coalesce(sum(r.amount_minor),0) INTO actual FROM invoice_credit_applications a JOIN invoice_credit_reservations r ON r.id=a.reservation_id WHERE a.invoice_id=NEW.id;
 IF NEW.credited_minor IS DISTINCT FROM actual OR(TG_OP='UPDATE' AND NEW.credited_minor IS DISTINCT FROM OLD.credited_minor AND current_setting('freeholder.invoice_credit_v1',true) IS DISTINCT FROM '1') THEN
  RAISE EXCEPTION 'Invoice credited principal is exactly its immutable noncash application receipts; cash remains separate' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_credit_projection_guard BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION freeholder_invoice_credit_projection();
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_note_live_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='void' AND OLD.status IS DISTINCT FROM 'void' AND EXISTS(SELECT 1 FROM invoice_credit_funding f JOIN invoice_credit_reservations r ON r.funding_id=f.id
  LEFT JOIN invoice_credit_releases released ON released.reservation_id=r.id WHERE f.credit_note_id=NEW.id AND released.reservation_id IS NULL) THEN
  RAISE EXCEPTION 'The exact issued credit still has reserved/applied principal and cannot be voided away' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_note_live_disposition_guard BEFORE UPDATE ON credit_notes FOR EACH ROW EXECUTE FUNCTION freeholder_credit_note_live_disposition();
--> statement-breakpoint
CREATE FUNCTION freeholder_rma_credit_reverse_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original credit_notes%ROWTYPE; payment uuid;
BEGIN
 IF NEW.credit_note_id IS NULL OR(TG_OP='UPDATE' AND NEW.credit_note_id IS NOT DISTINCT FROM OLD.credit_note_id) THEN RETURN NEW; END IF;
 SELECT * INTO original FROM credit_notes WHERE id=NEW.credit_note_id;
 FOR payment IN SELECT p.id FROM payments p WHERE p.invoice_id=original.invoice_id ORDER BY p.id LOOP PERFORM pg_advisory_xact_lock(hashtext('payment:'||payment::text)); END LOOP;
 PERFORM pg_advisory_xact_lock(hashtext('invoice:'||original.invoice_id::text));
 PERFORM pg_advisory_xact_lock(hashtext('credit-note:'||NEW.credit_note_id::text));
 IF EXISTS(SELECT 1 FROM invoice_credit_funding WHERE credit_note_id=NEW.credit_note_id) THEN
  RAISE EXCEPTION 'This exact credit already has independent noncash funding/disposition history; it cannot also become an RMA refund promise' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_credit_reverse_owner_guard BEFORE INSERT OR UPDATE ON return_requests FOR EACH ROW EXECUTE FUNCTION freeholder_rma_credit_reverse_owner();
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_funding_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE note credit_notes%ROWTYPE; line credit_note_lines%ROWTYPE; funded bigint;
BEGIN
 SELECT * INTO note FROM credit_notes WHERE id=NEW.credit_note_id;
 SELECT coalesce(sum(amount_minor),0) INTO funded FROM invoice_credit_funding WHERE credit_note_id=note.id;
 IF funded<>note.total_minor THEN RAISE EXCEPTION 'The whole exact issued credit requires complete original principal ownership' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT * FROM credit_note_lines WHERE credit_note_id=note.id LOOP
  SELECT coalesce(sum(amount_minor),0) INTO funded FROM invoice_credit_funding WHERE credit_note_line_id=line.id;
  IF funded<>line.total_minor THEN RAISE EXCEPTION 'Each original credit line requires complete own principal ownership' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoice_credit_funding_complete AFTER INSERT ON invoice_credit_funding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_credit_funding_complete();
--> statement-breakpoint
CREATE FUNCTION freeholder_credit_application_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice invoices%ROWTYPE; actual bigint;
BEGIN
 SELECT * INTO invoice FROM invoices WHERE id=NEW.invoice_id;
 SELECT coalesce(sum(r.amount_minor),0) INTO actual FROM invoice_credit_applications a JOIN invoice_credit_reservations r ON r.id=a.reservation_id WHERE a.invoice_id=NEW.invoice_id;
 IF invoice.id IS NULL OR invoice.credited_minor<>actual THEN RAISE EXCEPTION 'Applying original credit must update its exact noncash invoice projection in the same transaction' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoice_credit_application_projection AFTER INSERT ON invoice_credit_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_credit_application_projection();
