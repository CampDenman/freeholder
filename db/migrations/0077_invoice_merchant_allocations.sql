-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking New member order invoices require original seller portions before issue. Stop old writers before upgrade; restore the pre-upgrade database and objects for rollback.
-- C12.38: existing money is deliberately NOT allocated using today's seller,
-- account or fee settings. Version0 is original unallocated history only.
ALTER TABLE invoice_market_policies ADD COLUMN allocation_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE invoice_market_policies ALTER COLUMN allocation_version SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoice_market_policies ADD CONSTRAINT invoice_market_policies_allocation_version CHECK(allocation_version IN(0,1));
--> statement-breakpoint
CREATE TABLE invoice_merchant_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES invoice_market_policies(invoice_id) ON DELETE RESTRICT,
 seller_key text NOT NULL, seller_user_id uuid,
 merchant_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
 subtotal_minor bigint NOT NULL DEFAULT 0, discount_minor bigint NOT NULL DEFAULT 0,
 shipping_minor bigint NOT NULL DEFAULT 0, tax_minor bigint NOT NULL DEFAULT 0,
 total_minor bigint NOT NULL DEFAULT 0, revenue_minor bigint NOT NULL DEFAULT 0,
 fee_minor bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_merchant_allocations_owner CHECK (
  (seller_user_id IS NULL AND seller_key='site' AND merchant_contact_id IS NULL AND fee_minor=0)
  OR (seller_user_id IS NOT NULL AND seller_key='seller:' || seller_user_id::text)),
 CONSTRAINT invoice_merchant_allocations_amounts CHECK (
  subtotal_minor>=0 AND discount_minor BETWEEN 0 AND subtotal_minor
  AND shipping_minor>=0 AND tax_minor>=0 AND revenue_minor=subtotal_minor-discount_minor
  AND total_minor=revenue_minor+shipping_minor+tax_minor AND fee_minor BETWEEN 0 AND revenue_minor)
);
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_merchant_allocations_seller_idx ON invoice_merchant_allocations(invoice_id,seller_key);
--> statement-breakpoint
CREATE INDEX invoice_merchant_allocations_contact_idx ON invoice_merchant_allocations(merchant_contact_id);
--> statement-breakpoint
CREATE TABLE invoice_merchant_allocation_lines (
 invoice_line_id uuid PRIMARY KEY REFERENCES invoice_lines(id) ON DELETE RESTRICT,
 allocation_id uuid NOT NULL REFERENCES invoice_merchant_allocations(id) ON DELETE RESTRICT,
 requires_shipping boolean NOT NULL,
 revenue_minor bigint NOT NULL DEFAULT 0, fee_minor bigint NOT NULL DEFAULT 0,
 CONSTRAINT invoice_merchant_allocation_lines_amounts CHECK(revenue_minor>=0 AND fee_minor BETWEEN 0 AND revenue_minor)
);
--> statement-breakpoint
CREATE INDEX invoice_merchant_allocation_lines_allocation_idx ON invoice_merchant_allocation_lines(allocation_id);
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  -- Contact merge/undo may repoint ownership; original money and seller may
  -- never be rewritten by a new account, product edit or privacy request.
  IF (to_jsonb(NEW)-'merchant_contact_id') IS DISTINCT FROM (to_jsonb(OLD)-'merchant_contact_id') THEN
   RAISE EXCEPTION 'Original invoice merchant portions are immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Original invoice merchant portions are retained financial evidence.' USING ERRCODE='23514';
 END IF;
 SELECT * INTO parent FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=NEW.invoice_id;
 IF parent.id IS NULL OR parent.status<>'draft' OR parent.source_type<>'order' OR policy.allocation_version<>1 THEN
  RAISE EXCEPTION 'Capture proven merchant portions on the original draft order invoice.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_merchant_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_allocation();
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_allocation_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE part invoice_merchant_allocations%ROWTYPE; original invoice_lines%ROWTYPE; policy invoice_market_policies%ROWTYPE; state text; original_owners integer;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Original invoice merchant line ownership is immutable.' USING ERRCODE='23514';
 END IF;
 SELECT * INTO part FROM invoice_merchant_allocations WHERE id=NEW.allocation_id;
 SELECT * INTO original FROM invoice_lines WHERE id=NEW.invoice_line_id;
 SELECT status INTO state FROM invoices WHERE id=part.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=part.invoice_id;
 SELECT count(*) INTO original_owners FROM order_items item JOIN invoices i ON i.id=part.invoice_id
 WHERE i.source_type='order' AND item.order_id::text=i.source_id
  AND item.snapshot->>'invoiceLineId'=NEW.invoice_line_id::text
  AND item.snapshot->'sellerUserId'=COALESCE(to_jsonb(part.seller_user_id),'null'::jsonb)
  AND item.snapshot->'requiresShipping'=to_jsonb(NEW.requires_shipping)
  AND original.source_type='variant' AND original.source_id=item.variant_id::text
  AND original.quantity_micros::numeric=item.quantity::numeric*1000000 AND original.unit_amount_minor=item.unit_amount_minor;
 IF part.id IS NULL OR original.id IS NULL OR original.invoice_id<>part.invoice_id OR state<>'draft'
  OR original_owners<>1
  OR NEW.revenue_minor<>original.subtotal_minor-original.discount_minor
  OR NEW.fee_minor<>(CASE WHEN part.seller_user_id IS NULL THEN 0 ELSE floor(NEW.revenue_minor::numeric*policy.site_fee_bps/10000)::bigint END) THEN
  RAISE EXCEPTION 'Merchant line ownership must match its original invoice and exact fee.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_allocation_line_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_merchant_allocation_lines
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_allocation_line();
--> statement-breakpoint
CREATE FUNCTION guard_allocated_original_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM invoice_merchant_allocation_lines b WHERE b.invoice_line_id=OLD.id) THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['description','snapshot']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['description','snapshot']) THEN
   RAISE EXCEPTION 'An allocated original invoice line is retained financial evidence.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocated_original_invoice_line_guard BEFORE UPDATE OR DELETE ON invoice_lines
 FOR EACH ROW EXECUTE FUNCTION guard_allocated_original_invoice_line();
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_allocation_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy invoice_market_policies%ROWTYPE; portions record;
BEGIN
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=NEW.id;
 IF EXISTS(SELECT 1 FROM invoice_merchant_allocations a WHERE a.invoice_id=OLD.id)
 AND (NEW.currency IS DISTINCT FROM OLD.currency OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id) THEN
  RAISE EXCEPTION 'The allocated original invoice currency and source are immutable.' USING ERRCODE='23514';
 END IF;
 IF NEW.status='draft' OR NEW.source_type<>'order' OR policy.invoice_id IS NULL OR policy.allocation_version=0 THEN RETURN NEW; END IF;
 SELECT count(*) AS count, sum(subtotal_minor) AS subtotal, sum(discount_minor) AS discount,
  sum(shipping_minor) AS shipping, sum(tax_minor) AS tax, sum(total_minor) AS total, sum(fee_minor) AS fee
  INTO portions FROM invoice_merchant_allocations WHERE invoice_id=NEW.id;
 IF portions.count=0 OR portions.subtotal<>NEW.subtotal_minor OR portions.discount<>NEW.discount_minor
  OR portions.shipping<>NEW.shipping_minor OR portions.tax<>NEW.tax_minor OR portions.total<>NEW.total_minor OR portions.fee<>policy.fee_minor
  OR EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=NEW.id AND NOT EXISTS(SELECT 1 FROM invoice_merchant_allocation_lines b JOIN invoice_merchant_allocations a ON a.id=b.allocation_id WHERE b.invoice_line_id=l.id AND a.invoice_id=NEW.id))
  OR EXISTS(SELECT 1 FROM invoice_merchant_allocations a WHERE a.invoice_id=NEW.id AND (
   a.revenue_minor<>COALESCE((SELECT sum(b.revenue_minor) FROM invoice_merchant_allocation_lines b WHERE b.allocation_id=a.id),-1)
   OR a.fee_minor<>COALESCE((SELECT sum(b.fee_minor) FROM invoice_merchant_allocation_lines b WHERE b.allocation_id=a.id),-1))) THEN
  RAISE EXCEPTION 'This member order invoice needs complete original seller portions before issue.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_allocation_issue BEFORE UPDATE ON invoices
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_allocation_issue();
--> statement-breakpoint
CREATE FUNCTION guard_invoice_merchant_allocation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.allocation_version IS DISTINCT FROM OLD.allocation_version OR (
  EXISTS(SELECT 1 FROM invoice_merchant_allocations a WHERE a.invoice_id=OLD.invoice_id)
  AND (to_jsonb(NEW)-ARRAY['merchant_contact_id','merchant_name','merchant_support']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['merchant_contact_id','merchant_name','merchant_support'])
 )) THEN
  RAISE EXCEPTION 'Original allocated invoice collection terms are immutable.' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.allocation_version<>1 THEN
  RAISE EXCEPTION 'New invoice policies require the current merchant allocation version.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_allocation_policy_guard BEFORE INSERT OR UPDATE ON invoice_market_policies
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_allocation_policy();
--> statement-breakpoint
-- An older merge writer cannot move a new contact pointer without recording
-- its bounded undo witness. Do not invent history for pre77 merge receipts.
CREATE FUNCTION guard_invoice_merchant_allocation_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM invoice_merchant_allocations a WHERE a.merchant_contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='invoice_merchant_allocations') THEN
  RAISE EXCEPTION 'This contact merge requires its original invoice merchant portion witness.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_allocation_merge_guard BEFORE INSERT ON contact_merge_operations
 FOR EACH ROW EXECUTE FUNCTION guard_invoice_merchant_allocation_merge();
