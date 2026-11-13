-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: compose after the tax fragment inside0080, never as another journal.
ALTER TABLE orders ADD COLUMN commercial_epoch integer NOT NULL DEFAULT 0 CHECK(commercial_epoch IN(0,1));
--> statement-breakpoint
CREATE TABLE order_commercial_policies (
 order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
 model text NOT NULL CHECK(model IN('hold','instant','seller_merchant')),adapter text NOT NULL,
 site_fee_bps integer NOT NULL CHECK(site_fee_bps BETWEEN 0 AND 10000),hold_days integer NOT NULL CHECK(hold_days BETWEEN 0 AND 365),
 collection_kind text CHECK(collection_kind IN('direct','destination')),provider_platform_account_id text,
 tax_destination jsonb,accepted_quote_digest text CHECK(accepted_quote_digest ~ '^[a-f0-9]{64}$'),accepted_commercial_digest text CHECK(accepted_commercial_digest ~ '^[a-f0-9]{64}$'),buyer_erased_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(model<>'seller_merchant' OR(adapter='stripe_connect' AND collection_kind IS NOT NULL AND provider_platform_account_id IS NOT NULL AND accepted_quote_digest IS NOT NULL AND accepted_commercial_digest IS NOT NULL AND(tax_destination IS NOT NULL OR buyer_erased_at IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE order_commercial_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES order_commercial_policies(order_id) ON DELETE CASCADE,
 seller_user_id uuid,seller_key text NOT NULL,merchant_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
 merchant_name text NOT NULL,merchant_support jsonb,recipient_account_id text,
 profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,profile_version integer NOT NULL CHECK(profile_version>0),
 liability text NOT NULL CHECK(liability IN('platform','seller')),shipping_minor bigint NOT NULL CHECK(shipping_minor BETWEEN 0 AND 9007199254740991),
 merchant_erased_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT order_commercial_parties_tax_version_fk FOREIGN KEY(profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CHECK((seller_user_id IS NULL AND seller_key='site' AND merchant_contact_id IS NULL AND liability='platform' AND recipient_account_id IS NULL)
  OR(seller_user_id IS NOT NULL AND seller_key='seller:'||seller_user_id::text AND liability='seller' AND(merchant_contact_id IS NOT NULL OR merchant_erased_at IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_commercial_parties_owner_idx ON order_commercial_parties(order_id,seller_key);
--> statement-breakpoint
CREATE INDEX order_commercial_parties_contact_idx ON order_commercial_parties(merchant_contact_id);
--> statement-breakpoint
CREATE TABLE order_commercial_lines (
 order_item_id uuid PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES order_commercial_parties(id) ON DELETE CASCADE,position integer NOT NULL CHECK(position>=0)
);
--> statement-breakpoint
CREATE INDEX order_commercial_lines_party_idx ON order_commercial_lines(party_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_order_commercial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; original_party order_commercial_parties; business merchant_tax_profiles;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='order_commercial_policies' THEN parent_id=OLD.order_id;
  ELSIF TG_TABLE_NAME='order_commercial_parties' THEN parent_id=OLD.order_id;
  ELSE SELECT order_id INTO parent_id FROM order_commercial_parties WHERE id=OLD.party_id; END IF;
  IF parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM orders WHERE id=parent_id) THEN
   RAISE EXCEPTION 'Original order commercial evidence is retained with its order' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF current_setting('freeholder.order_commercial_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original order commercial evidence requires its shared writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='order_commercial_lines' THEN RAISE EXCEPTION 'Original order commercial lines are immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='order_commercial_policies' THEN
   IF current_setting('freeholder.order_commercial_privacy_v1',true) IS DISTINCT FROM '1' OR NEW.tax_destination IS NOT NULL OR NEW.buyer_erased_at IS NULL
    OR(to_jsonb(NEW)-ARRAY['tax_destination','buyer_erased_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','buyer_erased_at'])
    OR(OLD.buyer_erased_at IS NOT NULL AND NEW.buyer_erased_at IS DISTINCT FROM OLD.buyer_erased_at) THEN
    RAISE EXCEPTION 'Original order terms can only minimize buyer tax location' USING ERRCODE='23514';
   END IF;
  ELSE
   IF(to_jsonb(NEW)-ARRAY['merchant_contact_id','merchant_name','merchant_support','merchant_erased_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['merchant_contact_id','merchant_name','merchant_support','merchant_erased_at']) THEN
    RAISE EXCEPTION 'Original order merchant and tax authority is immutable' USING ERRCODE='23514';
   END IF;
   IF ROW(NEW.merchant_name,NEW.merchant_support,NEW.merchant_erased_at) IS DISTINCT FROM ROW(OLD.merchant_name,OLD.merchant_support,OLD.merchant_erased_at)
    AND(current_setting('freeholder.order_commercial_privacy_v1',true) IS DISTINCT FROM '1' OR NEW.merchant_name<>'Erased merchant' OR NEW.merchant_support IS NOT NULL OR NEW.merchant_erased_at IS NULL OR NEW.merchant_contact_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Original merchant identity can only be minimized by privacy' USING ERRCODE='23514';
   END IF;
   IF OLD.merchant_erased_at IS NOT NULL AND ROW(NEW.merchant_contact_id,NEW.merchant_name,NEW.merchant_support,NEW.merchant_erased_at) IS DISTINCT FROM ROW(OLD.merchant_contact_id,OLD.merchant_name,OLD.merchant_support,OLD.merchant_erased_at) THEN
    RAISE EXCEPTION 'Erased original merchant identity cannot be recreated' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='order_commercial_lines' THEN
  SELECT * INTO original_party FROM order_commercial_parties WHERE id=NEW.party_id;
  IF original_party.id IS NULL OR NOT EXISTS(SELECT 1 FROM order_items i WHERE i.id=NEW.order_item_id AND i.order_id=original_party.order_id)
   OR EXISTS(SELECT 1 FROM order_commercial_lines l JOIN order_commercial_parties p ON p.id=l.party_id WHERE p.order_id=original_party.order_id AND l.position=NEW.position) THEN
   RAISE EXCEPTION 'Original order commercial line has duplicate or unrelated ownership' USING ERRCODE='23514';
  END IF;
  parent_id=original_party.order_id;
 ELSE
  parent_id=NEW.order_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM orders WHERE id=parent_id AND commercial_epoch=1 AND invoice_id IS NULL) THEN
  RAISE EXCEPTION 'Only a new unbilled order can capture original commercial authority' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='order_commercial_parties' THEN
  SELECT * INTO business FROM merchant_tax_profiles WHERE id=NEW.profile_id;
  IF business.id IS NULL OR business.state<>'active' OR business.seller_key<>NEW.seller_key OR business.current_version<>NEW.profile_version
   OR NOT EXISTS(SELECT 1 FROM merchant_tax_profile_versions WHERE profile_id=NEW.profile_id AND version=NEW.profile_version AND liability=NEW.liability AND erased_at IS NULL) THEN
   RAISE EXCEPTION 'Original order tax authority does not match its actual business' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_commercial_policies_guard BEFORE INSERT OR UPDATE OR DELETE ON order_commercial_policies FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_guard();
--> statement-breakpoint
CREATE TRIGGER order_commercial_parties_guard BEFORE INSERT OR UPDATE OR DELETE ON order_commercial_parties FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_guard();
--> statement-breakpoint
CREATE TRIGGER order_commercial_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON order_commercial_lines FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_order_commercial_epoch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.commercial_epoch IS DISTINCT FROM OLD.commercial_epoch THEN RAISE EXCEPTION 'Historical orders cannot adopt a new commercial authority epoch' USING ERRCODE='23514'; END IF;
 IF OLD.commercial_epoch=1 AND(NEW.checkout_payment_snapshot IS DISTINCT FROM OLD.checkout_payment_snapshot) THEN
  RAISE EXCEPTION 'Original accepted order payment terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_commercial_epoch_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_epoch_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_order_commercial_merge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM order_commercial_parties p WHERE p.merchant_contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='order_commercial_parties') THEN
   RAISE EXCEPTION 'This merge requires its original order commercial witness' USING ERRCODE='23514';
  END IF;
 ELSE
  IF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL
   AND EXISTS(SELECT 1 FROM order_commercial_parties p WHERE p.merchant_contact_id IN(OLD.duplicate_contact_id,OLD.surviving_contact_id))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.reference_state) e WHERE e->>'table'='order_commercial_parties') THEN
   RAISE EXCEPTION 'This historical merge has no original order commercial witness' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_commercial_merge_guard BEFORE INSERT OR UPDATE OF undone_at ON contact_merge_operations FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_merge_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_order_commercial_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_order uuid; linked boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM order_commercial_policies WHERE order_id=NEW.order_id) THEN
   RAISE EXCEPTION 'Accepted original commercial orders cannot gain new items' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 original_order=OLD.order_id;
 SELECT EXISTS(SELECT 1 FROM order_commercial_lines WHERE order_item_id=OLD.id) INTO linked;
 IF NOT linked THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM orders WHERE id=original_order) THEN RAISE EXCEPTION 'Accepted original commercial order items are immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF(to_jsonb(NEW)-'snapshot') IS DISTINCT FROM(to_jsonb(OLD)-'snapshot') THEN
  RAISE EXCEPTION 'Accepted original commercial item money and source are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
  IF current_setting('freeholder.order_commercial_privacy_v1',true)='1'
   AND NEW.snapshot->>'sellerUserId'='00000000-0000-4000-8000-00000000e5ed'
   AND(NEW.snapshot-'sellerUserId') IS NOT DISTINCT FROM(OLD.snapshot-'sellerUserId') THEN RETURN NEW; END IF;
  IF(NEW.snapshot-'invoiceLineId') IS DISTINCT FROM(OLD.snapshot-'invoiceLineId')
   OR OLD.snapshot ? 'invoiceLineId'
   OR NOT EXISTS(SELECT 1 FROM invoice_lines line JOIN invoices invoice ON invoice.id=line.invoice_id
     WHERE line.id::text=NEW.snapshot->>'invoiceLineId' AND invoice.source_type='order' AND invoice.source_id=original_order::text AND invoice.status='draft'
     AND line.position=(OLD.snapshot->>'linePosition')::integer) THEN
   RAISE EXCEPTION 'Accepted original commercial item terms cannot be rebound' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_commercial_item_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION freeholder_order_commercial_item_guard();
