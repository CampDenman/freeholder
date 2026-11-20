-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C9.13: compose into unpublished 0080; no historical fee backfill.
ALTER TABLE subscriptions ADD COLUMN accepted_setup_fee_minor bigint;
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN setup_fee_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_accepted_setup_fee CHECK(accepted_setup_fee_minor IS NULL OR accepted_setup_fee_minor BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_setup_fee_invoice CHECK(setup_fee_invoice_id IS NULL OR accepted_setup_fee_minor IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION freeholder_subscription_setup_fee_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.setup_fee_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'The original setup invoice must be issued before its obligation is discharged' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.accepted_setup_fee_minor IS DISTINCT FROM OLD.accepted_setup_fee_minor THEN
  RAISE EXCEPTION 'The accepted setup fee cannot change or be backfilled from a later plan' USING ERRCODE='23514';
 END IF;
 IF NEW.setup_fee_invoice_id IS DISTINCT FROM OLD.setup_fee_invoice_id THEN
  IF current_setting('freeholder.subscription_setup_fee_v1',true) IS DISTINCT FROM '1'
   OR OLD.setup_fee_invoice_id IS NOT NULL OR NEW.setup_fee_invoice_id IS NULL
   OR NEW.accepted_setup_fee_minor IS NULL OR NEW.accepted_setup_fee_minor<=0
   OR NOT EXISTS(SELECT 1 FROM invoices i JOIN invoice_lines l ON l.invoice_id=i.id
    WHERE i.id=NEW.setup_fee_invoice_id AND i.source_type='subscription'
     AND split_part(i.source_id,':',1)=NEW.id::text AND i.contact_id=NEW.contact_id AND i.currency=NEW.currency
     AND i.issued_at IS NOT NULL AND i.status NOT IN('draft','void')
     AND l.position=1 AND l.source_type='subscription' AND l.source_id=NEW.id::text
     AND l.quantity_micros=1000000 AND l.unit_amount_minor=NEW.accepted_setup_fee_minor) THEN
   RAISE EXCEPTION 'The setup obligation requires its exact original issued component and buyer' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_original_setup_fee BEFORE INSERT OR UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION freeholder_subscription_setup_fee_receipt();
