-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: compose INSIDE0080; this is not a separate journal entry.
-- Warm older readers must actually stop/drain. These triggers are not SELECT
-- fences or a security boundary against the trusted database owner.
CREATE TABLE merchant_tax_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_user_id uuid, seller_key text NOT NULL,
 contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
 current_version integer NOT NULL DEFAULT 0 CHECK(current_version>=0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','erased')),
 created_at timestamptz NOT NULL DEFAULT now(), erased_at timestamptz,
 CHECK((seller_user_id IS NULL AND seller_key='site' AND contact_id IS NULL)
  OR(seller_user_id IS NOT NULL AND seller_key='seller:'||seller_user_id::text AND(contact_id IS NOT NULL OR state='erased')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_tax_profiles_owner_idx ON merchant_tax_profiles(seller_key);
--> statement-breakpoint
CREATE INDEX merchant_tax_profiles_contact_idx ON merchant_tax_profiles(contact_id);
--> statement-breakpoint
CREATE TABLE merchant_tax_profile_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), request_key uuid NOT NULL,
 liability text NOT NULL CHECK(liability IN ('platform','seller')),
 origin jsonb NOT NULL, collection_status text NOT NULL CHECK(collection_status IN ('registered','not_registered')),
 non_collection_reason text, rules_snapshot jsonb NOT NULL CHECK(jsonb_typeof(rules_snapshot)='array' AND jsonb_array_length(rules_snapshot)<=1000),
 merchant_name text, merchant_support jsonb, declaration_digest text NOT NULL CHECK(declaration_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), erased_at timestamptz,
 CHECK(erased_at IS NOT NULL OR(jsonb_typeof(origin)='object' AND coalesce((origin->>'country') ~ '^[A-Z]{2}$',false))),
 CHECK(erased_at IS NOT NULL OR collection_status<>'not_registered' OR coalesce(length(trim(non_collection_reason)) BETWEEN 3 AND 1000,false))
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_tax_profile_versions_version_idx ON merchant_tax_profile_versions(profile_id,version);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_tax_profile_versions_request_idx ON merchant_tax_profile_versions(profile_id,request_key);
--> statement-breakpoint
ALTER TABLE tax_registrations ADD COLUMN merchant_profile_id uuid REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE tax_exemptions ADD COLUMN merchant_profile_id uuid REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX tax_registrations_merchant_idx ON tax_registrations(merchant_profile_id,zone_id,status);
--> statement-breakpoint
CREATE INDEX tax_exemptions_merchant_idx ON tax_exemptions(merchant_profile_id,contact_id,zone_id);
--> statement-breakpoint
CREATE TABLE invoice_merchant_tax_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
 seller_user_id uuid, seller_key text NOT NULL,
 profile_id uuid NOT NULL REFERENCES merchant_tax_profiles(id) ON DELETE RESTRICT, profile_version integer NOT NULL CHECK(profile_version>0),
 liability text NOT NULL CHECK(liability IN ('platform','seller')), evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),occurred_at timestamptz NOT NULL,
 shipping_minor bigint NOT NULL CHECK(shipping_minor BETWEEN 0 AND 9007199254740991),
 shipping_tax_minor bigint NOT NULL CHECK(shipping_tax_minor BETWEEN 0 AND 9007199254740991),
 tax_minor bigint NOT NULL CHECK(tax_minor BETWEEN 0 AND 9007199254740991), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_merchant_tax_quotes_version_fk FOREIGN KEY(profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CHECK((seller_user_id IS NULL AND seller_key='site') OR(seller_user_id IS NOT NULL AND seller_key='seller:'||seller_user_id::text))
);
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_merchant_tax_quotes_party_idx ON invoice_merchant_tax_quotes(invoice_id,seller_key);
--> statement-breakpoint
CREATE INDEX invoice_merchant_tax_quotes_profile_idx ON invoice_merchant_tax_quotes(profile_id);
--> statement-breakpoint
CREATE TABLE invoice_merchant_tax_quote_lines (
 invoice_line_id uuid PRIMARY KEY REFERENCES invoice_lines(id) ON DELETE CASCADE,
 quote_id uuid NOT NULL REFERENCES invoice_merchant_tax_quotes(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX invoice_merchant_tax_quote_lines_quote_idx ON invoice_merchant_tax_quote_lines(quote_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_tax_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner merchant_tax_profiles;
BEGIN
 IF current_setting('freeholder.merchant_tax_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Merchant tax configuration requires its shared writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original tax business evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='merchant_tax_profiles' THEN
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.id,NEW.seller_user_id,NEW.seller_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.seller_user_id,OLD.seller_key,OLD.created_at)
    OR NEW.current_version<OLD.current_version OR NEW.current_version>OLD.current_version+1
    OR(OLD.state='erased' AND ROW(NEW.state,NEW.erased_at,NEW.contact_id) IS DISTINCT FROM ROW(OLD.state,OLD.erased_at,OLD.contact_id)) THEN
    RAISE EXCEPTION 'Original tax business identity is immutable' USING ERRCODE='23514';
   END IF;
   IF NEW.current_version<>OLD.current_version AND NOT EXISTS(SELECT 1 FROM merchant_tax_profile_versions WHERE profile_id=NEW.id AND version=NEW.current_version AND erased_at IS NULL) THEN
    RAISE EXCEPTION 'A tax configuration version must exist before activation' USING ERRCODE='23514';
   END IF;
   IF NEW.state='erased' AND(NEW.erased_at IS NULL OR NEW.contact_id IS NOT NULL OR current_setting('freeholder.merchant_tax_privacy_v1',true) IS DISTINCT FROM '1') THEN
    RAISE EXCEPTION 'Tax business minimization requires original privacy authority' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF current_setting('freeholder.merchant_tax_privacy_v1',true) IS DISTINCT FROM '1'
    OR NEW.erased_at IS NULL OR NEW.origin<>'{}'::jsonb OR NEW.rules_snapshot<>'[]'::jsonb
    OR NEW.non_collection_reason IS NOT NULL OR NEW.merchant_name IS NOT NULL OR NEW.merchant_support IS NOT NULL
    OR(to_jsonb(NEW)-ARRAY['origin','rules_snapshot','non_collection_reason','merchant_name','merchant_support','erased_at'])
      IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['origin','rules_snapshot','non_collection_reason','merchant_name','merchant_support','erased_at'])
    OR(OLD.erased_at IS NOT NULL AND NEW.erased_at IS DISTINCT FROM OLD.erased_at) THEN
    RAISE EXCEPTION 'Original tax declarations are immutable except verified minimization' USING ERRCODE='23514';
   END IF;
  ELSE
   SELECT * INTO owner FROM merchant_tax_profiles WHERE id=NEW.profile_id;
   IF NOT FOUND OR owner.state<>'active' OR NEW.version<>owner.current_version+1
    OR NEW.liability<>(CASE WHEN owner.seller_user_id IS NULL THEN 'platform' ELSE 'seller' END)
    OR(owner.seller_user_id IS NULL AND(NEW.merchant_name IS NULL OR NEW.merchant_support IS NULL))
    OR(owner.seller_user_id IS NOT NULL AND(NEW.merchant_name IS NOT NULL OR NEW.merchant_support IS NOT NULL)) THEN
    RAISE EXCEPTION 'Tax declarations require their exact original business and liability' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_tax_profiles_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_tax_profiles FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_profile_guard();
--> statement-breakpoint
CREATE TRIGGER merchant_tax_profile_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_tax_profile_versions FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_profile_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_tax_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.merchant_profile_id IS DISTINCT FROM OLD.merchant_profile_id THEN
  RAISE EXCEPTION 'Original tax registration or exemption ownership cannot be rebound' USING ERRCODE='23514';
 END IF;
 IF (CASE WHEN TG_OP='DELETE' THEN OLD.merchant_profile_id ELSE NEW.merchant_profile_id END) IS NOT NULL
  AND current_setting('freeholder.merchant_tax_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Merchant-owned tax records require their scoped shared writer' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tax_registrations_merchant_guard BEFORE INSERT OR UPDATE OR DELETE ON tax_registrations FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_current_guard();
--> statement-breakpoint
CREATE TRIGGER tax_exemptions_merchant_guard BEFORE INSERT OR UPDATE OR DELETE ON tax_exemptions FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_current_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_tax_quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; original invoice_merchant_tax_quotes; business merchant_tax_profiles; declaration merchant_tax_profile_versions;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='invoice_merchant_tax_quotes' THEN parent_id=OLD.invoice_id;
  ELSE SELECT invoice_id INTO parent_id FROM invoice_merchant_tax_quotes WHERE id=OLD.quote_id; END IF;
  IF parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM invoices WHERE id=parent_id) THEN
   RAISE EXCEPTION 'Original invoice tax ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP<>'INSERT' OR current_setting('freeholder.merchant_tax_writes_v1',true) IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'Original invoice tax receipts require their shared capture' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='invoice_merchant_tax_quotes' THEN
  SELECT * INTO business FROM merchant_tax_profiles WHERE id=NEW.profile_id;
  SELECT * INTO declaration FROM merchant_tax_profile_versions WHERE profile_id=NEW.profile_id AND version=NEW.profile_version;
  IF business.id IS NULL OR business.state<>'active' OR business.current_version<>NEW.profile_version OR declaration.id IS NULL OR declaration.erased_at IS NOT NULL
   OR business.seller_key<>NEW.seller_key OR declaration.liability<>NEW.liability
   OR NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND status='draft') THEN
   RAISE EXCEPTION 'Invoice tax receipt does not match its original draft and business' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO original FROM invoice_merchant_tax_quotes WHERE id=NEW.quote_id;
  IF original.id IS NULL OR NOT EXISTS(SELECT 1 FROM invoice_lines line JOIN invoices invoice ON invoice.id=line.invoice_id
   WHERE line.id=NEW.invoice_line_id AND invoice.id=original.invoice_id AND invoice.status='draft') THEN
   RAISE EXCEPTION 'Invoice tax line belongs to another original invoice' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_tax_quotes_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_merchant_tax_quotes FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_quote_guard();
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_tax_quote_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_merchant_tax_quote_lines FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_quote_guard();
--> statement-breakpoint
CREATE FUNCTION freeholder_merchant_collection_runtime_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('freeholder.merchant_collection_runtime_v1',true) IS DISTINCT FROM '1' THEN
  IF TG_OP='UPDATE' AND NEW.instance_id=OLD.instance_id
   AND((OLD.state='running' AND NEW.state IN('draining','stopped')) OR(OLD.state='draining' AND NEW.state IN('draining','drained','stopped'))
    OR(OLD.state='drained' AND NEW.state IN('drained','stopped')) OR(OLD.state='stopped' AND NEW.state='stopped'))
   AND(NEW.hold_operation_id IS NOT DISTINCT FROM OLD.hold_operation_id OR EXISTS(SELECT 1 FROM deployment_admission_holds hold WHERE hold.operation_id=NEW.hold_operation_id AND hold.released_at IS NULL)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'The merchant schema requires its current runtime' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_collection_runtime_admission BEFORE INSERT OR UPDATE ON deployment_admission_runtimes FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_collection_runtime_admission();

--> statement-breakpoint
-- Older merge writers cannot create or undo a move without the original tax
-- witness. No historical reference_state is backfilled from today's owners.
CREATE FUNCTION freeholder_merchant_tax_merge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM merchant_tax_profiles p WHERE p.contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='merchant_tax_profiles') THEN
   RAISE EXCEPTION 'This contact merge requires original business tax ownership evidence' USING ERRCODE='23514';
  END IF;
 ELSE
  IF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL
   AND EXISTS(SELECT 1 FROM merchant_tax_profiles p WHERE p.contact_id IN(OLD.duplicate_contact_id,OLD.surviving_contact_id))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.reference_state) e WHERE e->>'table'='merchant_tax_profiles') THEN
   RAISE EXCEPTION 'This historical merge has no original business tax ownership witness' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_tax_merge_guard BEFORE INSERT OR UPDATE OF undone_at ON contact_merge_operations
 FOR EACH ROW EXECUTE FUNCTION freeholder_merchant_tax_merge_guard();
