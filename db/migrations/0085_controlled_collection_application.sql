-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTER ee87f2a0b88822119798ea5d202771675e02294e181d323489af1e6f8f296881.
-- SOURCE ONLY / UNQUALIFIED. Root owns new assembly/hash/database. No 0--81 edits.
-- A quote is NOT credit capacity. Actual canonical reservation begins only at acceptance.
CREATE TABLE subscription_controlled_quotes (
 id uuid PRIMARY KEY,kind text NOT NULL,canonical_source_id text NOT NULL,resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 previous_terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,planned_proration_id uuid,planned_collection_id uuid NOT NULL,
 profile_id uuid NOT NULL,profile_version integer NOT NULL,
 calendar_read_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 customer_financial_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 native_preview_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 update_preview_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 input jsonb,review jsonb,input_digest text NOT NULL,review_digest text NOT NULL,redacted_at timestamptz,
 quoted_parent_revision text NOT NULL,source_revision text NOT NULL,quote_digest text NOT NULL,effective_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_quotes_profile_version FOREIGN KEY(profile_id,profile_version) REFERENCES merchant_tax_profile_versions(profile_id,version) ON DELETE RESTRICT,
 CONSTRAINT subscription_controlled_quotes_original CHECK(quoted_parent_revision ~ '^[a-f0-9]{64}$' AND profile_version>0 AND source_revision ~ '^[a-f0-9]{64}$' AND quote_digest ~ '^[a-f0-9]{64}$'
  AND input_digest ~ '^[a-f0-9]{64}$' AND review_digest ~ '^[a-f0-9]{64}$'
  AND ((redacted_at IS NULL AND jsonb_typeof(input)='object' AND jsonb_typeof(review)='object') OR (redacted_at IS NOT NULL AND input IS NULL AND review IS NULL))
  AND ((kind='period' AND planned_proration_id IS NULL) OR (kind='proration' AND planned_proration_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX subscription_controlled_quotes_resource ON subscription_controlled_quotes(resource_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_quotes_proration ON subscription_controlled_quotes(planned_proration_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_quotes_collection ON subscription_controlled_quotes(planned_collection_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_collections (
 id uuid PRIMARY KEY,kind text NOT NULL,quote_id uuid NOT NULL REFERENCES subscription_controlled_quotes(id) ON DELETE RESTRICT,
 proration_id uuid REFERENCES subscription_prorations(id) ON DELETE RESTRICT,invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,credit_note_id uuid REFERENCES credit_notes(id) ON DELETE RESTRICT,
 canonical_target_digest text NOT NULL,accepted_current_parent_revision text NOT NULL,acceptance_kind text NOT NULL,original_consent_digest text NOT NULL,
 accepted_by text NOT NULL,accepted_quote_digest text NOT NULL,collection_policy text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_collections_original CHECK(canonical_target_digest ~ '^[a-f0-9]{64}$' AND accepted_current_parent_revision ~ '^[a-f0-9]{64}$'
  AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND original_consent_digest ~ '^[a-f0-9]{64}$' AND collection_policy='canonical_gross_target_locked_credit_no_wallet'
  AND ((kind='period' AND proration_id IS NULL AND invoice_id IS NOT NULL) OR (kind='proration' AND proration_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_collections_quote ON subscription_controlled_collections(quote_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_collections_proration ON subscription_controlled_collections(proration_id);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_collections_invoice ON subscription_controlled_collections(invoice_id);
--> statement-breakpoint
CREATE TABLE subscription_controlled_components (
 id uuid PRIMARY KEY,collection_id uuid NOT NULL REFERENCES subscription_controlled_collections(id) ON DELETE RESTRICT,position integer NOT NULL,kind text NOT NULL,
 amount_minor bigint NOT NULL,currency text NOT NULL,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,provenance jsonb NOT NULL,provenance_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_components_original CHECK(position>=0 AND currency ~ '^[A-Z]{3}$' AND period_end>period_start AND provenance_digest ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(provenance)='object' AND amount_minor BETWEEN -9007199254740991 AND 9007199254740991
  AND ((kind IN('net','merchant_declared_tax_collection') AND amount_minor>=0) OR(kind='locked_canonical_credit' AND amount_minor<0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_components_position ON subscription_controlled_components(collection_id,position);
--> statement-breakpoint
CREATE TABLE subscription_controlled_invoice_bindings (
 collection_id uuid PRIMARY KEY REFERENCES subscription_controlled_collections(id) ON DELETE RESTRICT,resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 origin_kind text NOT NULL,creator_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,provider_invoice_ref text NOT NULL,
 operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,
 fact_id uuid NOT NULL REFERENCES subscription_controlled_facts(id) ON DELETE RESTRICT,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_invoice_bindings_original CHECK(provider_invoice_ref ~ '^in_[A-Za-z0-9_]{1,196}$' AND original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_invoice_bindings_invoice ON subscription_controlled_invoice_bindings(resource_id,provider_invoice_ref);
--> statement-breakpoint
CREATE TABLE subscription_controlled_item_receipts (
 component_id uuid PRIMARY KEY REFERENCES subscription_controlled_components(id) ON DELETE RESTRICT,resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 origin_kind text NOT NULL,creator_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 provider_invoice_item_ref text,provider_invoice_line_ref text,provider_price_ref text,
 operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,
 fact_id uuid NOT NULL REFERENCES subscription_controlled_facts(id) ON DELETE RESTRICT,original_evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_item_receipts_original CHECK((provider_invoice_item_ref IS NULL OR provider_invoice_item_ref ~ '^ii_[A-Za-z0-9_]{1,196}$')
  AND(provider_invoice_line_ref IS NULL OR provider_invoice_line_ref ~ '^il_[A-Za-z0-9_]{1,196}$') AND(provider_invoice_item_ref IS NOT NULL OR provider_invoice_line_ref IS NOT NULL)
  AND(provider_price_ref IS NULL OR provider_price_ref ~ '^price_[A-Za-z0-9_]{1,195}$') AND original_evidence_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_item_receipts_item ON subscription_controlled_item_receipts(resource_id,provider_invoice_item_ref);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_item_receipts_line ON subscription_controlled_item_receipts(resource_id,provider_invoice_line_ref);
--> statement-breakpoint
CREATE TABLE subscription_controlled_invoice_proofs (
 id uuid PRIMARY KEY,collection_id uuid NOT NULL REFERENCES subscription_controlled_invoice_bindings(collection_id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,
 result_digest text NOT NULL,canonical_target_digest text NOT NULL,customer_financial_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_controlled_invoice_proofs_original CHECK(result_digest ~ '^[a-f0-9]{64}$' AND canonical_target_digest ~ '^[a-f0-9]{64}$' AND customer_financial_digest ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_controlled_invoice_proofs_operation ON subscription_controlled_invoice_proofs(operation_id);
--> statement-breakpoint
CREATE INDEX subscription_controlled_invoice_proofs_collection ON subscription_controlled_invoice_proofs(collection_id);
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_collection_valid(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c subscription_controlled_collections%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;
 p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;i invoices%ROWTYPE;
BEGIN
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target;
 SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=c.terms_id;
 IF c.id IS NULL OR q.id IS NULL OR r.id IS NULL OR p.id IS NULL OR t.subscription_id IS DISTINCT FROM p.id OR q.redacted_at IS NOT NULL
  OR c.kind IS DISTINCT FROM q.kind OR c.id IS DISTINCT FROM q.planned_collection_id OR c.proration_id IS DISTINCT FROM q.planned_proration_id
  OR c.accepted_quote_digest IS DISTINCT FROM q.quote_digest OR c.original_consent_digest IS DISTINCT FROM q.quote_digest
  OR (c.kind='period' AND c.acceptance_kind IS DISTINCT FROM 'original_period_mandate')
  OR (c.kind='proration' AND(c.acceptance_kind IS DISTINCT FROM 'explicit_change' OR t.accepted_quote_digest IS DISTINCT FROM q.quote_digest))
  OR t.snapshot IS DISTINCT FROM q.review->'quote'->'snapshot' THEN RETURN false;END IF;
 IF c.kind='proration' AND NOT EXISTS(SELECT 1 FROM subscription_prorations a WHERE a.id=c.proration_id AND a.subscription_id=p.id
  AND a.previous_terms_id=q.previous_terms_id AND a.terms_id=c.terms_id AND a.debit_invoice_id IS NOT DISTINCT FROM c.invoice_id AND a.credit_note_id IS NOT DISTINCT FROM c.credit_note_id
  AND a.accepted_quote_digest=c.accepted_quote_digest AND a.effective_at=q.effective_at) THEN RETURN false;END IF;
 IF c.invoice_id IS NULL THEN
  RETURN c.kind='proration' AND (q.review->>'debitNetMinor')::bigint=0 AND(q.review->>'debitTaxMinor')::bigint=0
   AND(q.review->>'creditAppliedMinor')::bigint=0 AND c.credit_note_id IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_controlled_components WHERE collection_id=c.id);
 END IF;
 SELECT * INTO i FROM invoices WHERE id=c.invoice_id;
 IF i.id IS NULL OR i.source_type IS DISTINCT FROM 'subscription' OR i.source_id IS DISTINCT FROM q.canonical_source_id OR i.contact_id IS DISTINCT FROM p.contact_id
  OR i.currency IS DISTINCT FROM p.currency OR i.issued_at IS NULL OR i.shipping_minor<>0
  OR i.subtotal_minor-i.discount_minor IS DISTINCT FROM (q.review->>'debitNetMinor')::bigint OR i.tax_minor IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR i.total_minor IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint+(q.review->>'debitTaxMinor')::bigint
  OR i.credited_minor IS DISTINCT FROM(q.review->>'creditAppliedMinor')::bigint
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_tax_quotes tax WHERE tax.invoice_id=i.id AND tax.profile_id=q.profile_id AND tax.profile_version=q.profile_version)
  OR (c.credit_note_id IS NOT NULL AND EXISTS(SELECT 1 FROM return_requests WHERE credit_note_id=c.credit_note_id)) THEN RETURN false;END IF;
 IF coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='net'),0) IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='merchant_declared_tax_collection'),0) IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='locked_canonical_credit'),0) IS DISTINCT FROM -(q.review->>'creditAppliedMinor')::bigint
  OR EXISTS(SELECT 1 FROM subscription_controlled_components x WHERE x.collection_id=c.id AND(x.currency<>i.currency OR x.kind IS DISTINCT FROM x.provenance->>'kind'
   OR(x.kind='merchant_declared_tax_collection' AND(x.provenance->>'profileId' IS DISTINCT FROM q.profile_id::text OR x.provenance->>'profileVersion' IS DISTINCT FROM q.profile_version::text))
   OR(x.kind='locked_canonical_credit' AND(x.provenance->>'creditNoteId' IS DISTINCT FROM c.credit_note_id::text OR jsonb_typeof(x.provenance->'applicationIds') IS DISTINCT FROM 'array'
    OR (SELECT coalesce(sum(res.amount_minor),0) FROM invoice_credit_applications app JOIN invoice_credit_reservations res ON res.id=app.reservation_id JOIN invoice_credit_funding fund ON fund.id=res.funding_id
      WHERE app.invoice_id=i.id AND fund.credit_note_id=c.credit_note_id AND res.target_source_id=i.source_id AND res.id::text IN(SELECT jsonb_array_elements_text(x.provenance->'applicationIds')))
       IS DISTINCT FROM -x.amount_minor)))) THEN RETURN false;END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_collection_writer() RETURNS trigger LANGUAGE plpgsql AS $$
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
    WHERE NOT EXISTS(SELECT 1 FROM subscription_controlled_operations actual JOIN subscription_controlled_verifications v ON v.operation_id=actual.id WHERE actual.id=expected.id AND actual.kind=expected.kind AND actual.resource_id=r.id)) THEN
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
  IF NOT EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
   JOIN subscription_controlled_invoice_bindings b ON b.collection_id=NEW.collection_id
   WHERE op.id=NEW.operation_id AND op.kind='read_manifest' AND op.resource_id=r.id AND v.call_id=NEW.call_id AND v.actual_result_digest=NEW.result_digest
    AND v.actual_result->>'exactManifest'='true' AND v.actual_result->>'providerInvoiceRef'=b.provider_invoice_ref
    AND v.actual_result->>'customerFinancialDigest'=NEW.customer_financial_digest) THEN
   RAISE EXCEPTION 'Exact complete manifest proof must remain the genuine original returned read and its actual signed caller' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_collection_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='subscription_controlled_quotes' THEN SELECT id INTO target FROM subscription_controlled_collections WHERE quote_id=NEW.id;
 ELSIF TG_TABLE_NAME='subscription_controlled_collections' THEN target=NEW.id;
 ELSIF TG_TABLE_NAME='subscription_controlled_item_receipts' THEN SELECT collection_id INTO target FROM subscription_controlled_components WHERE id=NEW.component_id;
 ELSE target=NEW.collection_id;END IF;
 IF target IS NOT NULL AND NOT freeholder_controlled_collection_valid(target) THEN
  RAISE EXCEPTION 'Complete actual canonical period/proration debit, dated tax, whole locked credit and immutable fee promises must compose atomically' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_quotes_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_quotes FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_quotes_complete AFTER INSERT OR UPDATE ON subscription_controlled_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_collections_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_collections FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_collections_complete AFTER INSERT OR UPDATE ON subscription_controlled_collections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_components_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_components FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_components_complete AFTER INSERT OR UPDATE ON subscription_controlled_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_invoice_bindings_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_invoice_bindings FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_invoice_bindings_complete AFTER INSERT OR UPDATE ON subscription_controlled_invoice_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_item_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_item_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_item_receipts_complete AFTER INSERT OR UPDATE ON subscription_controlled_item_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_invoice_proofs_guard BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_invoice_proofs FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_writer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_invoice_proofs_complete AFTER INSERT OR UPDATE ON subscription_controlled_invoice_proofs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_collection_complete();
--> statement-breakpoint
ALTER TABLE subscription_controlled_operations DROP CONSTRAINT subscription_controlled_operations_kind;
--> statement-breakpoint
ALTER TABLE subscription_controlled_operations ADD CONSTRAINT subscription_controlled_operations_kind CHECK(kind IN('create_product','read_product','discover_bootstrap','bootstrap','pause_drafts','read_bootstrap','create_schedule','read_calendar','preview_proration','preview_update','update_calendar','create_draft','add_invoice_component','read_manifest','read_invoice','read_customer_financials','list_invoices','set_invoice_fee','finalize_invoice','pay_invoice','cancel_calendar','void_invoice','delete_draft'));
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_target_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;c subscription_controlled_collections%ROWTYPE;
 payload jsonb;target_id uuid;latest_read jsonb;manifest jsonb;proof jsonb;bound subscription_controlled_invoice_bindings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 payload=o.original_request->'payload';manifest=payload->'manifest';
 IF o.id IS NULL OR r.id IS NULL OR o.original_request->>'requiredProtocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR NOT coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR NOT freeholder_controlled_callers_closed(r.id) OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal) THEN RETURN false;END IF;
 SELECT v.actual_result INTO latest_read FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id
  WHERE original.resource_id=r.id AND original.kind='read_calendar' AND original.ordinal<o.ordinal ORDER BY original.ordinal DESC LIMIT 1;
 IF latest_read IS NULL OR latest_read->>'collectionPausedAsDraft' IS DISTINCT FROM 'true' OR latest_read->>'calendarCanceled' IS DISTINCT FROM 'false'
  OR latest_read->>'providerSubscriptionRef' IS DISTINCT FROM payload->>'providerSubscriptionRef' THEN RETURN false;END IF;
 IF o.kind IN('preview_proration','preview_update') THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'prorationAt' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.ordinal<o.ordinal
    AND later.ordinal>(SELECT max(original.ordinal) FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE original.resource_id=r.id AND original.kind='read_calendar')
    AND later.kind IN('update_calendar','cancel_calendar'));
 END IF;
 IF NOT coalesce(o.original_request->>'targetFinancialRevision' ~ '^[a-f0-9]{64}$',false) THEN RETURN false;END IF;
 target_id=CASE WHEN o.kind='update_calendar' THEN(payload->>'collectionId')::uuid ELSE(manifest->>'collectionId')::uuid END;
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target_id;SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 IF c.id IS NULL OR q.resource_id IS DISTINCT FROM r.id OR NOT freeholder_controlled_collection_valid(c.id)
  OR(c.kind='proration' AND q.effective_at<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM subscriptions p JOIN module_settings m ON m.module='subscriptions' AND m.enabled WHERE p.id=r.subscription_id
    AND p.status IN('active','trialing') AND p.cancelled_at IS NULL AND NOT p.cancel_at_period_end)
  OR EXISTS(SELECT 1 FROM invoices i WHERE i.id=c.invoice_id AND(i.paid_minor<>0 OR i.refunded_minor<>0 OR i.status IN('draft','void','refunded'))) THEN RETURN false;END IF;
 IF o.kind='update_calendar' THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'acceptedQuoteDigest'=c.accepted_quote_digest
   AND payload->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
   AND payload->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND payload->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='update_calendar' AND old.original_request->'payload'->>'collectionId'=c.id::text);
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
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='create_draft' AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text)
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations old JOIN subscription_controlled_verifications v ON v.operation_id=old.id WHERE old.resource_id=r.id AND old.kind='update_calendar'
     AND old.original_request->'payload'->>'collectionId'=c.id::text AND v.actual_result->>'providerInvoiceRef' IS NULL);
 END IF;
 IF bound.collection_id IS NULL OR payload->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR payload->'invoiceOrigin'->>'creatorOperationId' IS DISTINCT FROM bound.creator_operation_id::text
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations creator WHERE creator.id=bound.creator_operation_id AND creator.request_digest=payload->'invoiceOrigin'->>'creatorRequestDigest') THEN RETURN false;END IF;
 IF o.kind='add_invoice_component' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_components component WHERE component.id::text=payload->>'componentId' AND component.collection_id=c.id
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_item_receipts item WHERE item.component_id=component.id))
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='add_invoice_component'
    AND old.original_request->'payload'->>'componentId'=payload->>'componentId');
 END IF;
 IF(SELECT count(*) FROM subscription_controlled_item_receipts item JOIN subscription_controlled_components component ON component.id=item.component_id WHERE component.collection_id=c.id)
   <>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id) THEN RETURN false;END IF;
 IF o.kind IN('read_manifest','set_invoice_fee') THEN RETURN true;END IF;
 SELECT v.actual_result INTO proof FROM subscription_controlled_invoice_proofs retained JOIN subscription_controlled_operations original ON original.id=retained.operation_id
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
 IF proof IS NULL OR proof->>'exactManifest' IS DISTINCT FROM 'true' OR proof->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind=o.kind AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text) THEN RETURN false;END IF;
 IF o.kind='finalize_invoice' THEN RETURN proof->'inventory'->>'status'='draft' AND proof->'inventory'->>'paidMinor'='0';END IF;
 IF o.kind='pay_invoice' THEN RETURN proof->'inventory'->>'status'='open' AND proof->'inventory'->>'paidMinor'='0'
  AND(q.review->>'cashDueMinor')::bigint>0 AND proof->'inventory'->>'remainingMinor'=q.review->>'cashDueMinor';END IF;
 RETURN false;
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
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id
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
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_operations prior JOIN subscription_controlled_verifications v ON v.operation_id=prior.id
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
  IF NOT freeholder_controlled_operation_admissible(o.id) OR body->>'version' IS DISTINCT FROM '1' OR body->>'kind' IS DISTINCT FROM 'admission'
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
  IF c.id IS NULL OR NEW.ordinal<>last_ordinal+1 OR EXISTS(SELECT 1 FROM subscription_controlled_finishes WHERE call_id=c.id)
   OR EXISTS(SELECT 1 FROM subscription_controlled_stops WHERE call_id=c.id) OR octet_length(NEW.actual::text)>256000
   OR NOT coalesce(NEW.actual->>'kind' IN('bootstrap_subscription','pause_subscription','subscription_read','invoice_read','proration_preview','intent_read','cash_observed','invoice_payments_read','invoice_lines_read','price_read','product_created','product_read','subscription_list_read','calendar_updated','calendar_canceled','invoice_list_read','customer_financial_read','customer_credit_notes_read','controlled_draft_created','controlled_item_created','controlled_invoice_updated','controlled_invoice_finalized','controlled_invoice_paid'),false)
   OR jsonb_typeof(NEW.actual->'raw') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Only an actual unfinished, unstopped original caller can retain its next bounded raw occurrence; late callbacks remain refused' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='subscription_controlled_verifications' THEN
  SELECT * INTO c FROM subscription_controlled_calls WHERE id=NEW.call_id;
  IF c.operation_id IS DISTINCT FROM NEW.operation_id OR NOT EXISTS(SELECT 1 FROM subscription_controlled_finishes f WHERE f.call_id=c.id
   AND f.actual_result->>'outcome'='returned' AND f.actual_result->'result'=NEW.actual_result) THEN
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
CREATE OR REPLACE FUNCTION freeholder_controlled_zero_closure_valid(target uuid,proof jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r subscription_controlled_resources%ROWTYPE;calendar subscription_controlled_verifications%ROWTYPE;inventory subscription_controlled_verifications%ROWTYPE;
 calendar_op subscription_controlled_operations%ROWTYPE;list_op subscription_controlled_operations%ROWTYPE;item jsonb;actual jsonb;known_count integer;
BEGIN
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=target;
 IF r.id IS NULL OR proof->>'kind' IS DISTINCT FROM 'zero_transport' OR NOT freeholder_controlled_callers_closed(target)
  OR EXISTS(SELECT 1 FROM subscription_controlled_charge_origins WHERE resource_id=target)
  OR (SELECT count(*) FROM subscription_controlled_operations WHERE resource_id=target AND kind='bootstrap')<>1
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=target AND kind NOT IN('bootstrap','discover_bootstrap','read_bootstrap','pause_drafts','read_invoice','read_customer_financials','preview_proration','preview_update','read_calendar','list_invoices','cancel_calendar','create_product','read_product'))
  OR EXISTS(SELECT 1 FROM subscription_controlled_collections c JOIN subscription_controlled_quotes q ON q.id=c.quote_id WHERE q.resource_id=target)
  OR jsonb_typeof(proof->'invoices') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations op WHERE op.resource_id=target AND op.kind='read_customer_financials')
  AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id WHERE op.resource_id=target AND op.kind='read_customer_financials'
   AND v.actual_result->>'balanceState'='known_zero' AND v.actual_result->>'completeCreditNotes'='true') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations op JOIN subscription_controlled_calls c ON c.operation_id=op.id JOIN subscription_controlled_facts f ON f.call_id=c.id
  WHERE op.resource_id=target AND((f.actual->>'kind'='customer_financial_read' AND(f.actual->'raw'->>'id' IS DISTINCT FROM r.original_scope->>'providerCustomerRef' OR f.actual->'raw'->>'balance' IS DISTINCT FROM '0'
    OR jsonb_typeof(f.actual->'raw'->'invoice_credit_balance') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(f.actual->'raw'->'invoice_credit_balance') balance WHERE balance.value<>'0'::jsonb)
    OR(f.actual->'raw'->'cash_balance' IS DISTINCT FROM 'null'::jsonb AND(freeholder_controlled_ref(f.actual->'raw'->'cash_balance'->'customer') IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
     OR jsonb_typeof(f.actual->'raw'->'cash_balance'->'available') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(f.actual->'raw'->'cash_balance'->'available') balance WHERE balance.value<>'0'::jsonb)))))
   OR(f.actual->>'kind'='customer_credit_notes_read' AND EXISTS(SELECT 1 FROM jsonb_array_elements(f.actual->'raw'->'data') note WHERE note->>'status'='issued' AND note->>'amount' IS DISTINCT FROM '0')))) THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT entry->>'providerInvoiceRef') FROM jsonb_array_elements(proof->'invoices') entry)<>jsonb_array_length(proof->'invoices') THEN RETURN false;END IF;
 SELECT * INTO calendar FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'calendarReadOperationId';
 SELECT * INTO inventory FROM subscription_controlled_verifications WHERE operation_id::text=proof->>'invoiceListOperationId';
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
  SELECT v.actual_result INTO actual FROM subscription_controlled_verifications v JOIN subscription_controlled_operations o ON o.id=v.operation_id
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

-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTER7a0d620a8dac8acb102e4801d545f5dfcfc089ebabb2a11e3d7c347d60482423.
-- SOURCE ONLY / WIP / UNQUALIFIED. Root owns assembly/hash/new qualification DB.
-- Exact-target observation is recovery, never permission to repeat a POST or
-- reinterpret partial/refunded/expired/stopped principal as settled/access.
CREATE OR REPLACE FUNCTION freeholder_controlled_target_operation_admissible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;c subscription_controlled_collections%ROWTYPE;
 payload jsonb;target_id uuid;latest_read jsonb;manifest jsonb;proof jsonb;bound subscription_controlled_invoice_bindings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM subscription_controlled_operations WHERE id=target;SELECT * INTO r FROM subscription_controlled_resources WHERE id=o.resource_id;
 payload=o.original_request->'payload';manifest=payload->'manifest';
 IF o.id IS NULL OR r.id IS NULL OR o.original_request->>'requiredProtocol' IS DISTINCT FROM 'controlled_net_gross.v1'
  OR NOT coalesce(o.original_request->>'parentFinancialRevision' ~ '^[a-f0-9]{64}$',false)
  OR EXISTS(SELECT 1 FROM subscription_controlled_closures WHERE resource_id=r.id)
  OR NOT freeholder_controlled_callers_closed(r.id) OR EXISTS(SELECT 1 FROM subscription_controlled_calls WHERE operation_id=o.id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations WHERE resource_id=r.id AND ordinal>o.ordinal) THEN RETURN false;END IF;
 SELECT v.actual_result INTO latest_read FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id
  WHERE original.resource_id=r.id AND original.kind='read_calendar' AND original.ordinal<o.ordinal ORDER BY original.ordinal DESC LIMIT 1;
 IF latest_read IS NULL OR (o.kind<>'read_manifest' AND(latest_read->>'collectionPausedAsDraft' IS DISTINCT FROM 'true' OR latest_read->>'calendarCanceled' IS DISTINCT FROM 'false'))
  OR latest_read->>'providerSubscriptionRef' IS DISTINCT FROM payload->>'providerSubscriptionRef' THEN RETURN false;END IF;
 IF o.kind IN('preview_proration','preview_update') THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'prorationAt' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.ordinal<o.ordinal
    AND later.ordinal>(SELECT max(original.ordinal) FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE original.resource_id=r.id AND original.kind='read_calendar')
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
 IF o.kind='update_calendar' THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'acceptedQuoteDigest'=c.accepted_quote_digest
   AND payload->'target'->>'principalMinor'=q.review->'quote'->'snapshot'->>'periodAmountMinor'
   AND payload->'target'->>'interval'=q.review->'quote'->'snapshot'->>'interval' AND payload->'target'->>'intervalCount'=q.review->'quote'->'snapshot'->>'intervalCount'
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='update_calendar' AND old.original_request->'payload'->>'collectionId'=c.id::text);
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
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='create_draft' AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text)
   AND EXISTS(SELECT 1 FROM subscription_controlled_operations old JOIN subscription_controlled_verifications v ON v.operation_id=old.id WHERE old.resource_id=r.id AND old.kind='update_calendar'
     AND old.original_request->'payload'->>'collectionId'=c.id::text AND v.actual_result->>'providerInvoiceRef' IS NULL);
 END IF;
 IF bound.collection_id IS NULL OR payload->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR payload->'invoiceOrigin'->>'creatorOperationId' IS DISTINCT FROM bound.creator_operation_id::text
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_operations creator WHERE creator.id=bound.creator_operation_id AND creator.request_digest=payload->'invoiceOrigin'->>'creatorRequestDigest'
   AND(bound.origin_kind='created_draft' OR(creator.original_request->'payload'->>'collectionId'=payload->'invoiceOrigin'->>'priceEpochCollectionId'
    AND creator.original_request->'payload'->>'acceptedQuoteDigest'=payload->'invoiceOrigin'->>'priceEpochAcceptedQuoteDigest'))) THEN RETURN false;END IF;
 IF o.kind='add_invoice_component' THEN
  RETURN EXISTS(SELECT 1 FROM subscription_controlled_components component WHERE component.id::text=payload->>'componentId' AND component.collection_id=c.id
    AND NOT EXISTS(SELECT 1 FROM subscription_controlled_item_receipts item WHERE item.component_id=component.id))
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind='add_invoice_component'
    AND old.original_request->'payload'->>'componentId'=payload->>'componentId');
 END IF;
 IF(SELECT count(*) FROM subscription_controlled_item_receipts item JOIN subscription_controlled_components component ON component.id=item.component_id WHERE component.collection_id=c.id)
   <>(SELECT count(*) FROM subscription_controlled_components WHERE collection_id=c.id) THEN RETURN false;END IF;
 IF o.kind IN('read_manifest','set_invoice_fee') THEN RETURN true;END IF;
 SELECT v.actual_result INTO proof FROM subscription_controlled_invoice_proofs retained JOIN subscription_controlled_operations original ON original.id=retained.operation_id
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
 IF proof IS NULL OR proof->>'exactManifest' IS DISTINCT FROM 'true' OR proof->>'providerInvoiceRef' IS DISTINCT FROM bound.provider_invoice_ref
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations old WHERE old.resource_id=r.id AND old.id<>o.id AND old.kind=o.kind AND old.original_request->'payload'->'manifest'->>'collectionId'=c.id::text) THEN RETURN false;END IF;
 IF c.kind='period' AND o.kind IN('finalize_invoice','pay_invoice')
  AND(clock_timestamp()<(q.review->'calendar'->>'proposedPeriodStart')::timestamptz
   OR(q.review->>'originalTrialEndsAt' IS NOT NULL AND clock_timestamp()<(q.review->>'originalTrialEndsAt')::timestamptz)) THEN RETURN false;END IF;
 IF o.kind='finalize_invoice' THEN RETURN proof->'inventory'->>'status'='draft' AND proof->'inventory'->>'paidMinor'='0';END IF;
 IF o.kind='pay_invoice' THEN RETURN proof->'inventory'->>'status'='open' AND proof->'inventory'->>'paidMinor'='0'
  AND(q.review->>'cashDueMinor')::bigint>0 AND proof->'inventory'->>'remainingMinor'=q.review->>'cashDueMinor';END IF;
 RETURN false;
END $$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED suffix AFTERa2b419b441a515ae3edad978d5384838c75128d6823ad94ece50dfac3cec635c.
-- SOURCE ONLY / UNQUALIFIED. Root owns assembly/hash/fresh database proof.
-- A real controlled quotation is distinct from local-calendar legacy policy.
CREATE FUNCTION freeholder_controlled_proration_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
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
CREATE OR REPLACE FUNCTION freeholder_subscription_proration_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE;source invoices%ROWTYPE;line invoice_lines%ROWTYPE;scope subscription_merchant_scopes%ROWTYPE;resource subscription_provider_schedule_resources%ROWTYPE;previous subscription_commercial_terms%ROWTYPE;new_net numeric;old_net numeric;old_tax numeric;controlled boolean;q subscription_controlled_quotes%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR current_setting('freeholder.subscription_proration_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original gross-proration promises require their immutable guarded writer' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO scope FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 controlled=parent.billing_mode='provider' AND freeholder_controlled_proration_source(NEW.id);
 SELECT * INTO q FROM subscription_controlled_quotes WHERE planned_proration_id=NEW.id;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_proration_privacy_v1',true)='1' AND scope.redacted_at IS NOT NULL AND NEW.tax_destination IS NULL AND NEW.redacted_at IS NOT NULL AND OLD.redacted_at IS NULL
   AND(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS NOT DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at']) THEN RETURN NEW; END IF;
  IF(to_jsonb(NEW)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['debit_invoice_id','credit_note_id','original_job_id','job_claim_digest','original_task','state','operation_revision','applied_at','cancelled_at'])
   OR OLD.debit_invoice_id IS NOT NULL AND NEW.debit_invoice_id IS DISTINCT FROM OLD.debit_invoice_id OR OLD.credit_note_id IS NOT NULL AND NEW.credit_note_id IS DISTINCT FROM OLD.credit_note_id
   OR OLD.original_job_id IS NOT NULL AND(NEW.original_job_id IS DISTINCT FROM OLD.original_job_id OR NEW.job_claim_digest IS DISTINCT FROM OLD.job_claim_digest OR NEW.original_task IS DISTINCT FROM OLD.original_task)
   OR OLD.state IN('applied','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Never rewrite original accepted gross money, calendar, caller or issued-credit promises' USING ERRCODE='23514'; END IF;
  IF NEW.state='applied' AND OLD.state<>'applied' AND parent.billing_mode='provider' THEN
   RAISE EXCEPTION 'Actual controlled bank/canonical settlement and effective calendar require their exact final effect authority before activation' USING ERRCODE='23514';
  END IF;
  IF NEW.state='applied' AND OLD.state<>'applied' THEN
   IF NEW.effective_at>clock_timestamp() OR NEW.original_period_end<=clock_timestamp() OR NEW.applied_at IS NULL OR NEW.applied_at<NEW.effective_at
    OR parent.plan_id<>NEW.plan_id OR parent.pending_plan_id IS NOT NULL OR parent.current_period_start<>NEW.original_period_start OR parent.current_period_end<>NEW.original_period_end
    OR NOT EXISTS(SELECT 1 FROM job_idempotency_keys c JOIN pgboss.job j ON j.id=c.job_id AND j.name=c.job_name WHERE c.job_id=NEW.original_job_id AND c.job_name='subscriptions.applyGrossProration' AND c.payload_hash=NEW.job_claim_digest AND j.data=NEW.original_task)
    OR(NEW.original_trial_ends_at IS NULL AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.id=NEW.debit_invoice_id AND i.source_type='subscription' AND i.source_id=parent.id::text||':proration:'||NEW.id::text AND i.contact_id=parent.contact_id AND i.currency=parent.currency
     AND i.status='paid' AND i.paid_minor+i.credited_minor=i.total_minor AND i.refunded_minor=0 AND i.paid_at<=NEW.effective_at AND i.total_minor=NEW.debit_net_minor+NEW.debit_tax_minor AND i.tax_minor=NEW.debit_tax_minor)) THEN
    RAISE EXCEPTION 'Only exact fully paid consideration inside the real accepted window can activate new access; late or partial money remains recovery debt' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO previous FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
 IF parent.id IS NULL OR parent.merchant_scope_version<>1 OR parent.status NOT IN('active','trialing') OR parent.signup_pending OR parent.pending_plan_id IS NOT NULL OR parent.cancel_at_period_end OR parent.cancelled_at IS NOT NULL
  OR scope.subscription_id IS NULL OR(parent.billing_mode='provider' AND NOT controlled)
  OR(parent.billing_mode<>'provider' AND(parent.billing_mode NOT IN('manual','platform') OR resource.operation_revision<>0 OR resource.state<>'uncreated' OR resource.recovery_pending OR resource.provider_subscription_ref IS NOT NULL))
  OR previous.id IS NULL OR previous.subscription_id<>parent.id OR previous.snapshot->>'proration' IS DISTINCT FROM 'create_prorations'
  OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=parent.id AND other.revision>previous.revision)
  OR(previous.effective_period_start>=parent.current_period_end AND NOT EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.terms_id=previous.id AND prior.state='applied'))
  OR NEW.original_period_start<>parent.current_period_start OR NEW.original_period_end<>parent.current_period_end OR NEW.effective_at<=clock_timestamp()
  OR NEW.proposed_period_start<>NEW.effective_at OR(NOT controlled AND NEW.proposed_period_end<>parent.current_period_end)
  OR(controlled AND(NEW.proposed_period_end IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz
   OR NEW.snapshot IS DISTINCT FROM q.review->'quote'->'snapshot' OR NEW.accepted_quote_digest IS DISTINCT FROM q.quote_digest
   OR NEW.debit_net_minor::text IS DISTINCT FROM q.review->>'debitNetMinor' OR NEW.debit_tax_minor::text IS DISTINCT FROM q.review->>'debitTaxMinor'
   OR NEW.credit_net_minor::text IS DISTINCT FROM q.review->>'creditNetMinor' OR NEW.credit_tax_minor::text IS DISTINCT FROM q.review->>'creditTaxMinor')) OR NEW.profile_id<>scope.tax_profile_id
  OR NEW.snapshot->>'version' IS DISTINCT FROM '1' OR NEW.snapshot->>'currency' IS DISTINCT FROM parent.currency OR NEW.snapshot->>'billingMode' IS DISTINCT FROM parent.billing_mode
  OR NEW.debit_tax_quote->>'subtotalMinor' IS DISTINCT FROM NEW.debit_net_minor::text OR NEW.debit_tax_quote->>'taxMinor' IS DISTINCT FROM NEW.debit_tax_minor::text
  OR NEW.debit_tax_quote->>'totalMinor' IS DISTINCT FROM(NEW.debit_net_minor+NEW.debit_tax_minor)::text OR NOT coalesce(NEW.debit_tax_quote->>'quoteDigest' ~ '^[a-f0-9]{64}$',false)
  OR NEW.state<>'accepted' OR NEW.original_job_id IS NOT NULL OR NEW.original_task IS NOT NULL OR NEW.credit_note_id IS NOT NULL OR NEW.debit_invoice_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM subscription_prorations other WHERE other.subscription_id=parent.id AND other.state NOT IN('applied','cancelled')) THEN
  RAISE EXCEPTION 'Accept one fresh original gross proration with its actual paid period, merchant and quiescent local-calendar authority' USING ERRCODE='23514'; END IF;
 IF parent.status='trialing' THEN
  IF NEW.original_trial_ends_at IS DISTINCT FROM parent.trial_ends_at OR NEW.original_trial_ends_at IS DISTINCT FROM parent.current_period_end OR NEW.original_invoice_id IS NOT NULL OR NEW.original_invoice_line_id IS NOT NULL THEN
   RAISE EXCEPTION 'An uncharged trial preserves its accepted end and has no old paid principal or credit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO source FROM invoices WHERE id=NEW.original_invoice_id;
  SELECT * INTO line FROM invoice_lines WHERE id=NEW.original_invoice_line_id;
  IF source.id IS NULL OR source.source_type<>'subscription' OR split_part(source.source_id,':',1)<>parent.id::text OR source.contact_id<>parent.contact_id OR source.currency<>parent.currency OR source.status<>'paid'
   OR source.paid_minor+source.credited_minor<>source.total_minor OR source.refunded_minor<>0 OR line.id IS NULL OR line.invoice_id<>source.id OR line.source_type<>'subscription' OR line.source_id<>parent.id::text OR line.discount_minor<>0 OR line.quantity_micros<>1000000
   OR NEW.basis_period_end<>parent.current_period_end OR NOT((source.source_id=parent.id::text||':'||to_char(parent.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND NEW.basis_period_start=parent.current_period_start AND line.snapshot->>'subscriptionComponent'='period')
    OR EXISTS(SELECT 1 FROM subscription_prorations prior WHERE prior.debit_invoice_id=source.id AND prior.state='applied' AND prior.plan_id=parent.plan_id AND prior.effective_at=NEW.basis_period_start AND line.snapshot->>'subscriptionProrationId'=prior.id::text)) THEN
   RAISE EXCEPTION 'Only the exact original paid period line and its retained ancestor consideration can fund unused credit' USING ERRCODE='23514'; END IF;
  old_net:=floor(line.subtotal_minor::numeric*extract(epoch FROM(NEW.basis_period_end-NEW.effective_at))/extract(epoch FROM(NEW.basis_period_end-NEW.basis_period_start))+0.5);
  old_tax:=floor(line.tax_minor::numeric*extract(epoch FROM(NEW.basis_period_end-NEW.effective_at))/extract(epoch FROM(NEW.basis_period_end-NEW.basis_period_start))+0.5);
  IF controlled THEN
   new_net:=floor((NEW.snapshot->>'periodAmountMinor')::numeric*extract(epoch FROM((q.review->'calendar'->>'expectedProviderPeriodEnd')::timestamptz-NEW.effective_at))
    /nullif(extract(epoch FROM((q.review->'calendar'->>'expectedProviderPeriodEnd')::timestamptz-(q.review->'calendar'->>'expectedProviderPeriodStart')::timestamptz)),0)+0.5);
   IF new_net IS NULL OR new_net<0 OR NEW.debit_net_minor<>new_net THEN RAISE EXCEPTION 'Retain the exact actual provider preview calendar with the shared canonical rounding engine' USING ERRCODE='23514';END IF;
  ELSE
  new_net:=floor((NEW.snapshot->>'periodAmountMinor')::numeric*extract(epoch FROM(parent.current_period_end-NEW.effective_at))/extract(epoch FROM(parent.current_period_end-parent.current_period_start))+0.5);
  END IF;
  IF NEW.credit_net_minor<>old_net OR NEW.credit_tax_minor<>old_tax OR NEW.debit_net_minor<>new_net THEN RAISE EXCEPTION 'Preserve separately rounded actual old principal/tax and the accepted new gross unused rate exactly' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_proration_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current subscription_prorations%ROWTYPE;terms subscription_commercial_terms%ROWTYPE;invoice invoices%ROWTYPE;note credit_notes%ROWTYPE;claim job_idempotency_keys%ROWTYPE;body jsonb;credit_amount bigint;required_application bigint;actual_application bigint;
BEGIN
 SELECT * INTO current FROM subscription_prorations WHERE id=NEW.id;
 SELECT * INTO terms FROM subscription_commercial_terms WHERE id=current.terms_id;
 SELECT * INTO claim FROM job_idempotency_keys WHERE job_name='subscriptions.applyGrossProration' AND job_id=current.original_job_id;
 SELECT data INTO body FROM pgboss.job WHERE name='subscriptions.applyGrossProration' AND id=current.original_job_id;
 IF terms.id IS NULL OR terms.subscription_id<>current.subscription_id OR terms.previous_terms_id IS DISTINCT FROM current.previous_terms_id OR terms.accepted_quote_digest<>current.accepted_quote_digest
  OR terms.snapshot IS DISTINCT FROM current.snapshot OR terms.notice_digest<>current.notice_digest OR terms.effective_period_start<>(CASE WHEN current.snapshot->>'billingMode'='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=current.id AND q.quote_digest=current.accepted_quote_digest) THEN current.proposed_period_end ELSE current.original_period_end END)
  OR current.original_task->>'prorationId' IS DISTINCT FROM current.id::text OR current.original_task->>'subscriptionId' IS DISTINCT FROM current.subscription_id::text
  OR current.original_task->>'originalJobId' IS DISTINCT FROM current.original_job_id::text OR current.original_task->>'acceptedQuoteDigest' IS DISTINCT FROM current.accepted_quote_digest
  OR(current.state<>'applied' AND(claim.id IS NULL OR claim.payload_hash IS DISTINCT FROM current.job_claim_digest OR body IS DISTINCT FROM current.original_task)) OR current.state IN('accepted','preparing','awaiting_invoice') THEN
  RAISE EXCEPTION 'Commit the actual accepted future terms, original effect enqueue and complete canonical proration in one transaction' USING ERRCODE='23514'; END IF;
 IF current.original_trial_ends_at IS NOT NULL THEN
  IF current.debit_invoice_id IS NOT NULL OR current.credit_note_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscription_proration_principal WHERE proration_id=current.id)
   OR EXISTS(SELECT 1 FROM subscription_proration_credit_uses WHERE proration_id=current.id) THEN RAISE EXCEPTION 'An uncharged trial cannot mint a paid invoice or unused principal credit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO invoice FROM invoices WHERE id=current.debit_invoice_id;
  IF invoice.id IS NULL OR invoice.source_type<>'subscription' OR invoice.source_id<>current.subscription_id::text||':proration:'||current.id::text OR invoice.status IN('draft','void') OR invoice.issued_at IS NULL
   OR invoice.total_minor<>current.debit_net_minor+current.debit_tax_minor OR invoice.tax_minor<>current.debit_tax_minor
   OR(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id=invoice.id)<>1
   OR NOT EXISTS(SELECT 1 FROM invoice_lines l WHERE l.invoice_id=invoice.id AND l.snapshot->>'subscriptionProrationId'=current.id::text AND l.snapshot->>'subscriptionTermsId'=current.terms_id::text AND l.unit_amount_minor=current.debit_net_minor AND l.tax_minor=current.debit_tax_minor)
   OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=invoice.id AND m.fee_minor=current.debit_fee_obligation_minor) THEN
   RAISE EXCEPTION 'The original gross debit requires its exact one canonical issued price/tax line before commit' USING ERRCODE='23514'; END IF;
  credit_amount:=current.credit_net_minor+current.credit_tax_minor;
  IF credit_amount>0 THEN
   SELECT * INTO note FROM credit_notes WHERE id=current.credit_note_id;
   IF note.id IS NULL OR note.status<>'issued' OR note.invoice_id IS DISTINCT FROM current.original_invoice_id OR note.total_minor<>credit_amount OR note.subtotal_minor<>current.credit_net_minor OR note.tax_minor<>current.credit_tax_minor
    OR coalesce((SELECT sum(amount_minor) FROM subscription_proration_principal WHERE proration_id=current.id),0)<>credit_amount
  OR coalesce((SELECT sum(amount_minor) FROM invoice_credit_funding WHERE proration_id=current.id AND credit_note_id=note.id),0)<>credit_amount
  OR coalesce((SELECT sum(fee_obligation_minor) FROM invoice_credit_funding WHERE proration_id=current.id AND credit_note_id=note.id),0)<>current.credit_fee_obligation_minor THEN
    RAISE EXCEPTION 'Preserve the whole exact old-tax credit and all actual original principal in the same accepted transaction' USING ERRCODE='23514'; END IF;
   required_application:=least(credit_amount,invoice.total_minor);
   SELECT coalesce(sum(r.amount_minor),0) INTO actual_application FROM invoice_credit_reservations r JOIN invoice_credit_funding f ON f.id=r.funding_id JOIN invoice_credit_applications a ON a.reservation_id=r.id
    WHERE f.credit_note_id=note.id AND r.target_source_id=invoice.source_id AND a.invoice_id=invoice.id;
   IF actual_application<>required_application OR(required_application>0 AND NOT EXISTS(SELECT 1 FROM subscription_proration_credit_uses u WHERE u.proration_id=current.id AND u.credit_note_id=note.id AND u.amount_minor=required_application)) THEN
    RAISE EXCEPTION 'Atomically apply exactly the original credit portion to its accepted gross target; unspent credit remains locked until the actual access switch' USING ERRCODE='23514'; END IF;
   IF coalesce((SELECT sum(a.fee_obligation_minor) FROM invoice_credit_applications a WHERE a.invoice_id=invoice.id),0)<>current.applied_fee_obligation_minor
    OR coalesce((SELECT sum(a.fee_proven_collected_minor) FROM invoice_credit_applications a WHERE a.invoice_id=invoice.id),0)<>current.applied_fee_proven_collected_minor THEN
    RAISE EXCEPTION 'The target must retain exactly the accepted original fee obligation and separately proved collection, never a duplicated new fee' USING ERRCODE='23514'; END IF;
  ELSIF current.credit_note_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscription_proration_principal WHERE proration_id=current.id) THEN
   RAISE EXCEPTION 'Zero unused original principal cannot mint a credit or fake payment' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_commercial_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent subscriptions%ROWTYPE; original subscription_merchant_scopes%ROWTYPE; prior subscription_commercial_terms%ROWTYPE; business merchant_tax_profiles%ROWTYPE; resource subscription_provider_schedule_resources%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accepted subscription promises cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('freeholder.subscription_terms_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Accepted subscription promises require their guarded current writer' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF current_setting('freeholder.subscription_terms_privacy_v1',true) IS DISTINCT FROM '1'
   OR(to_jsonb(NEW)-ARRAY['tax_destination','redacted_at'])IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['tax_destination','redacted_at'])
   OR OLD.redacted_at IS NOT NULL OR NEW.tax_destination IS NOT NULL OR NEW.redacted_at IS NULL THEN
   RAISE EXCEPTION 'Accepted subscription promises permit only guarded personal-destination minimization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM subscriptions WHERE id=NEW.subscription_id;
 SELECT * INTO original FROM subscription_merchant_scopes WHERE subscription_id=NEW.subscription_id;
 SELECT * INTO business FROM merchant_tax_profiles WHERE id=NEW.profile_id;
 SELECT * INTO resource FROM subscription_provider_schedule_resources WHERE subscription_id=NEW.subscription_id;
 IF parent.id IS NULL OR parent.merchant_scope_version<>1 OR original.subscription_id IS NULL
  OR NEW.profile_id IS DISTINCT FROM original.tax_profile_id OR NEW.tax_liability IS DISTINCT FROM original.tax_liability
  OR business.state IS DISTINCT FROM 'active' OR business.current_version IS DISTINCT FROM NEW.profile_version
  OR NEW.snapshot->>'version' IS DISTINCT FROM '1' OR NEW.snapshot->>'currency' IS DISTINCT FROM parent.currency
  OR jsonb_typeof(NEW.snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.notice_snapshot) IS DISTINCT FROM 'object'
  OR resource.subscription_id IS NULL OR NEW.redacted_at IS NOT NULL THEN
  RAISE EXCEPTION 'A new acceptance needs its actual original agreement, business and current declared policy' USING ERRCODE='23514';
 END IF;
 IF NEW.revision>1 AND current_setting('freeholder.subscription_proration_v1',true)='1' AND EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id) THEN
  SELECT * INTO prior FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
  IF prior.id IS NULL OR prior.subscription_id<>parent.id OR prior.revision+1<>NEW.revision OR NEW.acceptance_source<>'amendment'
   OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1'
   OR NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id AND p.subscription_id=parent.id AND p.previous_terms_id=prior.id AND p.state='accepted'
    AND p.accepted_quote_digest=NEW.accepted_quote_digest AND p.snapshot=NEW.snapshot AND p.profile_id=NEW.profile_id AND p.profile_version=NEW.profile_version
    AND p.tax_destination=NEW.tax_destination AND p.notice_digest=NEW.notice_digest AND p.notice_snapshot=NEW.notice_snapshot
    AND p.original_period_start=parent.current_period_start AND p.original_period_end=parent.current_period_end AND NEW.effective_period_start=(CASE WHEN parent.billing_mode='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=p.id AND q.quote_digest=p.accepted_quote_digest) THEN p.proposed_period_end ELSE p.original_period_end END) AND p.effective_at>clock_timestamp())
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=parent.id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices i WHERE i.source_type='subscription' AND i.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'New gross terms need their exact explicit acceptance and unbilled future boundary, preserving all earlier terms' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision=1 THEN
  IF resource.operation_revision<>0 OR resource.provider_subscription_ref IS NOT NULL OR resource.state<>'uncreated' OR NEW.effective_period_start IS DISTINCT FROM parent.current_period_start
   OR EXISTS(SELECT 1 FROM subscription_card_setups setup WHERE setup.subscription_id=parent.id)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND split_part(invoice.source_id,':',1)=parent.id::text) THEN
   RAISE EXCEPTION 'Accept original commercial terms before admitting provider schedule work' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO prior FROM subscription_commercial_terms WHERE id=NEW.previous_terms_id;
  IF prior.id IS NULL OR prior.subscription_id IS DISTINCT FROM NEW.subscription_id OR prior.revision+1<>NEW.revision
   OR current_setting('freeholder.subscription_amendment_v1',true) IS DISTINCT FROM '1' OR NEW.acceptance_source<>'amendment'
   OR NEW.effective_period_start<parent.current_period_end OR NEW.effective_period_start<=prior.effective_period_start
   OR(NEW.effective_period_start>parent.current_period_end AND(current_setting('freeholder.subscription_resumption_v1',true) IS DISTINCT FROM '1' OR parent.current_period_end>clock_timestamp() OR NEW.effective_period_start<=clock_timestamp()))
   OR EXISTS(SELECT 1 FROM subscription_commercial_terms other WHERE other.subscription_id=NEW.subscription_id AND other.revision>prior.revision)
   OR EXISTS(SELECT 1 FROM invoices invoice WHERE invoice.source_type='subscription' AND invoice.source_id=parent.id::text||':'||to_char(NEW.effective_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
   RAISE EXCEPTION 'An amendment needs its exact previous acceptance and an unbilled next period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_subscription_terms_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM subscription_commercial_amendments a WHERE a.terms_id=NEW.id AND a.subscription_id=NEW.subscription_id AND a.previous_terms_id=NEW.previous_terms_id AND a.accepted_quote_digest=NEW.accepted_quote_digest)
  AND NOT EXISTS(SELECT 1 FROM subscription_prorations p WHERE p.terms_id=NEW.id AND p.subscription_id=NEW.subscription_id AND p.previous_terms_id=NEW.previous_terms_id AND p.accepted_quote_digest=NEW.accepted_quote_digest AND (CASE WHEN p.snapshot->>'billingMode'='provider' AND EXISTS(SELECT 1 FROM subscription_controlled_quotes q WHERE q.planned_proration_id=p.id AND q.quote_digest=p.accepted_quote_digest) THEN p.proposed_period_end ELSE p.original_period_end END)=NEW.effective_period_start) THEN
  RAISE EXCEPTION 'Accepted changed terms require their exact original future-amendment or gross-proration consent receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor AFTER subscription-controlled-canonical82.fragment.sql.
-- Original mandate only. No new models, phase fabrication, bank/payment/access grant.
CREATE FUNCTION freeholder_controlled_original_period_source(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.customer_financial_operation_id AND op.resource_id=r.id AND op.kind='read_customer_financials';
 request=native_request->'payload';
 RETURN native IS NOT NULL AND updated IS NOT NULL AND calendar IS NOT NULL AND customer IS NOT NULL
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
  AND native->>'prorationAt'=request->>'prorationAt' AND updated->>'prorationAt'=request->>'prorationAt';
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_original_period_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='period' AND NOT freeholder_controlled_original_period_source(NEW.quote_id) THEN
  RAISE EXCEPTION 'An original next-period target requires its actual started trial/paid original period, unchanged mandate and exact returned preview/calendar lineage' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_controlled_collections_period_birth BEFORE INSERT ON subscription_controlled_collections
 FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_original_period_birth();
--> statement-breakpoint

-- Complete original body preserved except distinct mandate-kind consent and
-- additive exact normal-period canonical line/date ownership.
CREATE OR REPLACE FUNCTION freeholder_controlled_collection_valid(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c subscription_controlled_collections%ROWTYPE;q subscription_controlled_quotes%ROWTYPE;r subscription_controlled_resources%ROWTYPE;
 p subscriptions%ROWTYPE;t subscription_commercial_terms%ROWTYPE;i invoices%ROWTYPE;
BEGIN
 SELECT * INTO c FROM subscription_controlled_collections WHERE id=target;
 SELECT * INTO q FROM subscription_controlled_quotes WHERE id=c.quote_id;
 SELECT * INTO r FROM subscription_controlled_resources WHERE id=q.resource_id;
 SELECT * INTO p FROM subscriptions WHERE id=r.subscription_id;
 SELECT * INTO t FROM subscription_commercial_terms WHERE id=c.terms_id;
 IF c.id IS NULL OR q.id IS NULL OR r.id IS NULL OR p.id IS NULL OR t.subscription_id IS DISTINCT FROM p.id OR q.redacted_at IS NOT NULL
  OR c.kind IS DISTINCT FROM q.kind OR c.id IS DISTINCT FROM q.planned_collection_id OR c.proration_id IS DISTINCT FROM q.planned_proration_id
  OR c.accepted_quote_digest IS DISTINCT FROM q.quote_digest
  OR (c.kind='period' AND(c.acceptance_kind IS DISTINCT FROM 'original_period_mandate' OR c.proration_id IS NOT NULL OR c.credit_note_id IS NOT NULL
   OR c.terms_id IS DISTINCT FROM q.previous_terms_id OR c.original_consent_digest IS DISTINCT FROM t.accepted_quote_digest
   OR q.review->'controlled'->>'originalPeriodConsentDigest' IS DISTINCT FROM t.accepted_quote_digest OR q.review->'quote'->>'quoteDigest' IS DISTINCT FROM t.accepted_quote_digest))
  OR (c.kind='proration' AND(c.acceptance_kind IS DISTINCT FROM 'explicit_change' OR c.original_consent_digest IS DISTINCT FROM q.quote_digest OR t.accepted_quote_digest IS DISTINCT FROM q.quote_digest))
  OR t.snapshot IS DISTINCT FROM q.review->'quote'->'snapshot' THEN RETURN false;END IF;
 IF c.kind='proration' AND NOT EXISTS(SELECT 1 FROM subscription_prorations a WHERE a.id=c.proration_id AND a.subscription_id=p.id
  AND a.previous_terms_id=q.previous_terms_id AND a.terms_id=c.terms_id AND a.debit_invoice_id IS NOT DISTINCT FROM c.invoice_id AND a.credit_note_id IS NOT DISTINCT FROM c.credit_note_id
  AND a.accepted_quote_digest=c.accepted_quote_digest AND a.effective_at=q.effective_at) THEN RETURN false;END IF;
 IF c.invoice_id IS NULL THEN
  RETURN c.kind='proration' AND (q.review->>'debitNetMinor')::bigint=0 AND(q.review->>'debitTaxMinor')::bigint=0
   AND(q.review->>'creditAppliedMinor')::bigint=0 AND c.credit_note_id IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_controlled_components WHERE collection_id=c.id);
 END IF;
 SELECT * INTO i FROM invoices WHERE id=c.invoice_id;
 IF i.id IS NULL OR i.source_type IS DISTINCT FROM 'subscription' OR i.source_id IS DISTINCT FROM q.canonical_source_id OR i.contact_id IS DISTINCT FROM p.contact_id
  OR i.currency IS DISTINCT FROM p.currency OR i.issued_at IS NULL OR i.shipping_minor<>0
  OR i.subtotal_minor-i.discount_minor IS DISTINCT FROM (q.review->>'debitNetMinor')::bigint OR i.tax_minor IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR i.total_minor IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint+(q.review->>'debitTaxMinor')::bigint
  OR i.credited_minor IS DISTINCT FROM(q.review->>'creditAppliedMinor')::bigint
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_tax_quotes tax WHERE tax.invoice_id=i.id AND tax.profile_id=q.profile_id AND tax.profile_version=q.profile_version)
  OR (c.credit_note_id IS NOT NULL AND EXISTS(SELECT 1 FROM return_requests WHERE credit_note_id=c.credit_note_id)) THEN RETURN false;END IF;
 IF coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='net'),0) IS DISTINCT FROM(q.review->>'debitNetMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='merchant_declared_tax_collection'),0) IS DISTINCT FROM(q.review->>'debitTaxMinor')::bigint
  OR coalesce((SELECT sum(amount_minor) FROM subscription_controlled_components WHERE collection_id=c.id AND kind='locked_canonical_credit'),0) IS DISTINCT FROM -(q.review->>'creditAppliedMinor')::bigint
  OR EXISTS(SELECT 1 FROM subscription_controlled_components x WHERE x.collection_id=c.id AND(x.currency<>i.currency OR x.kind IS DISTINCT FROM x.provenance->>'kind'
   OR(x.kind='merchant_declared_tax_collection' AND(x.provenance->>'profileId' IS DISTINCT FROM q.profile_id::text OR x.provenance->>'profileVersion' IS DISTINCT FROM q.profile_version::text))
   OR(x.kind='locked_canonical_credit' AND(x.provenance->>'creditNoteId' IS DISTINCT FROM c.credit_note_id::text OR jsonb_typeof(x.provenance->'applicationIds') IS DISTINCT FROM 'array'
    OR (SELECT coalesce(sum(res.amount_minor),0) FROM invoice_credit_applications app JOIN invoice_credit_reservations res ON res.id=app.reservation_id JOIN invoice_credit_funding fund ON fund.id=res.funding_id
      WHERE app.invoice_id=i.id AND fund.credit_note_id=c.credit_note_id AND res.target_source_id=i.source_id AND res.id::text IN(SELECT jsonb_array_elements_text(x.provenance->'applicationIds')))
       IS DISTINCT FROM -x.amount_minor)))) THEN RETURN false;END IF;
 IF c.kind='period' AND(
  (q.review->>'creditAppliedMinor')::bigint<>0 OR (q.review->>'creditNetMinor')::bigint<>0 OR(q.review->>'creditTaxMinor')::bigint<>0
  OR q.canonical_source_id IS DISTINCT FROM p.id::text||':'||(q.review->'calendar'->>'proposedPeriodStart')
  OR q.review->>'effectiveAt' IS DISTINCT FROM q.review->'calendar'->>'proposedPeriodStart'
  OR NOT EXISTS(SELECT 1 FROM invoice_merchant_tax_quotes tax WHERE tax.invoice_id=i.id AND tax.occurred_at=(q.review->'calendar'->>'proposedPeriodStart')::timestamptz)
  OR EXISTS(SELECT 1 FROM subscription_controlled_components x WHERE x.collection_id=c.id AND(x.kind='locked_canonical_credit'
   OR x.period_start IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodStart')::timestamptz OR x.period_end IS DISTINCT FROM(q.review->'calendar'->>'proposedPeriodEnd')::timestamptz
   OR(x.kind='net' AND NOT EXISTS(SELECT 1 FROM invoice_lines line WHERE line.id::text=x.provenance->>'canonicalInvoiceLineId' AND line.invoice_id=i.id
    AND line.source_type='subscription' AND line.source_id=p.id::text AND line.quantity_micros=1000000 AND line.discount_minor=0 AND line.unit_amount_minor=x.amount_minor
    AND line.snapshot->>'subscriptionTermsId'=t.id::text AND line.snapshot->>'subscriptionComponent'=x.provenance->>'canonicalComponent'
    AND x.provenance->>'canonicalComponent' IN('period','setup') AND line.snapshot->>'subscriptionPeriodStart'=q.review->'calendar'->>'proposedPeriodStart'
    AND line.snapshot->>'subscriptionPeriodEnd'=q.review->'calendar'->>'proposedPeriodEnd'))))
  OR EXISTS(SELECT 1 FROM invoice_lines line WHERE line.invoice_id=i.id AND(SELECT count(*) FROM subscription_controlled_components x WHERE x.collection_id=c.id AND x.kind='net' AND x.provenance->>'canonicalInvoiceLineId'=line.id::text)<>1)
 ) THEN RETURN false;END IF;
 RETURN true;
END $$;
--> statement-breakpoint

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor after original-period84; no old SQL/model edits.
-- Complete genuine list/read inventory after the last actual bank writer.
CREATE FUNCTION freeholder_controlled_collection_inventory(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o subscription_controlled_operations%ROWTYPE;r subscription_controlled_resources%ROWTYPE;listed subscription_controlled_operations%ROWTYPE;
 proof jsonb;listing jsonb;read_id jsonb;reader subscription_controlled_operations%ROWTYPE;actual jsonb;invoice_ref text;boundary bigint;
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
 SELECT actual_result INTO listing FROM subscription_controlled_verifications WHERE operation_id=listed.id;
 IF listed.id IS NULL OR listing->>'complete' IS DISTINCT FROM 'true' OR jsonb_typeof(listing->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(listing->'actualInvoices') IS DISTINCT FROM 'array' OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(listing->'actualInvoices')
  OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoiceReadOperationIds')
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='list_invoices' AND later.ordinal>listed.ordinal AND later.ordinal<o.ordinal) THEN RETURN false;END IF;
 SELECT min(prior.ordinal) INTO first_update FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id AND prior.kind='update_calendar'
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 FOR read_id IN SELECT value FROM jsonb_array_elements(proof->'invoiceReadOperationIds') LOOP
  SELECT * INTO reader FROM subscription_controlled_operations WHERE id::text=(read_id#>>'{}') AND resource_id=r.id AND kind='read_invoice' AND ordinal>listed.ordinal AND ordinal<o.ordinal;
  SELECT actual_result INTO actual FROM subscription_controlled_verifications WHERE operation_id=reader.id;
  invoice_ref=reader.original_request->'payload'->>'providerInvoiceRef';
  IF reader.id IS NULL OR reader.id::text=ANY(read_ids) OR invoice_ref=ANY(seen) OR actual->>'providerInvoiceRef' IS DISTINCT FROM invoice_ref
   OR actual->>'providerSubscriptionRef' IS DISTINCT FROM listing->>'providerSubscriptionRef' OR actual->>'providerCustomerRef' IS DISTINCT FROM r.original_scope->>'providerCustomerRef'
   OR actual->>'currency' IS DISTINCT FROM r.original_scope->>'currency' OR actual->>'completePayments' IS DISTINCT FROM 'true' OR actual->>'completeLines' IS DISTINCT FROM 'true'
   OR actual->'actualInvoice'->>'id' IS DISTINCT FROM invoice_ref OR actual->'actualInvoice'->>'total' IS DISTINCT FROM actual->>'totalMinor'
   OR actual->'actualInvoice'->>'amount_paid' IS DISTINCT FROM actual->>'paidMinor' OR actual->'actualInvoice'->>'amount_remaining' IS DISTINCT FROM actual->>'remainingMinor'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(listing->'providerInvoiceRefs') ref WHERE ref=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'actualInvoices') item WHERE item->>'id'=invoice_ref)
   OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='read_invoice' AND later.ordinal>reader.ordinal AND later.ordinal<o.ordinal AND later.original_request->'payload'->>'providerInvoiceRef'=invoice_ref)
   OR NOT EXISTS(SELECT 1 FROM subscription_controlled_facts fact JOIN subscription_controlled_calls caller ON caller.id=fact.call_id WHERE caller.operation_id=reader.id AND fact.actual->>'kind'='invoice_read' AND fact.actual->'raw'=actual->'actualInvoice') THEN RETURN false;END IF;
  read_ids=array_append(read_ids,reader.id::text);seen=array_append(seen,invoice_ref);
  IF EXISTS(SELECT 1 FROM(VALUES('actualCash'),('actualPayments'),('actualIntents'),('actualLines'),('actualPrices')) family(name) WHERE jsonb_typeof(actual->family.name) IS DISTINCT FROM 'array') THEN RETURN false;END IF;
  items=items+1+jsonb_array_length(actual->'actualCash')+jsonb_array_length(actual->'actualPayments')+jsonb_array_length(actual->'actualIntents')+jsonb_array_length(actual->'actualLines')+jsonb_array_length(actual->'actualPrices');
  IF items>5000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM subscription_controlled_invoice_bindings b WHERE b.collection_id=parent_collection AND b.resource_id=r.id AND b.provider_invoice_ref=invoice_ref) THEN CONTINUE;END IF;
  owned=actual->>'status'='paid' AND actual->>'autoAdvance'='false' AND actual->>'totalMinor'='0' AND actual->>'paidMinor'='0' AND actual->>'remainingMinor'='0'
   AND actual->'actualInvoice'->>'amount_due'='0' AND actual->'actualInvoice'->>'starting_balance'='0' AND actual->'actualInvoice'->>'ending_balance'='0'
   AND actual->'actualInvoice'->>'pre_payment_credit_notes_amount'='0' AND actual->'actualInvoice'->>'post_payment_credit_notes_amount'='0'
   AND actual->'actualCash'='[]'::jsonb AND actual->'actualPayments'='[]'::jsonb AND actual->'actualIntents'='[]'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualLines') line WHERE line->>'amount' IS DISTINCT FROM '0')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual->'actualPrices') price WHERE price->>'unit_amount' IS DISTINCT FROM '0')
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
   OR canonical.paid_minor+canonical.credited_minor<>canonical.total_minor OR canonical.refunded_minor<>0 OR actual->>'status' IS DISTINCT FROM 'paid'
   OR actual->>'autoAdvance' IS DISTINCT FROM 'false' OR actual->>'remainingMinor' IS DISTINCT FROM '0'
   OR actual->>'totalMinor' IS DISTINCT FROM known_quote.review->>'cashDueMinor' OR actual->>'paidMinor' IS DISTINCT FROM actual->>'totalMinor' THEN RETURN false;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM subscription_controlled_operations calendar_read JOIN subscription_controlled_verifications v ON v.operation_id=calendar_read.id
  WHERE calendar_read.resource_id=r.id AND calendar_read.kind='read_calendar' AND calendar_read.ordinal=(SELECT max(latest.ordinal) FROM subscription_controlled_operations latest WHERE latest.resource_id=r.id AND latest.kind='read_calendar' AND latest.ordinal<o.ordinal)
   AND v.actual_result->>'providerInvoiceRef' IS NOT NULL AND NOT(v.actual_result->>'providerInvoiceRef'=ANY(seen))) THEN RETURN false;END IF;
 RETURN cardinality(seen)=jsonb_array_length(listing->'providerInvoiceRefs');
END $$;
--> statement-breakpoint

-- Preserve full prior positive lifecycle guards; add exact inventory/current
-- calendar and make zero-child stale intents inert, never actual callers.
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
 SELECT v.actual_result,original.ordinal INTO latest_read,read_ordinal FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id
  WHERE original.resource_id=r.id AND original.kind='read_calendar' AND original.ordinal<o.ordinal ORDER BY original.ordinal DESC LIMIT 1;
 IF latest_read IS NULL OR (o.kind<>'read_manifest' AND(latest_read->>'collectionPausedAsDraft' IS DISTINCT FROM 'true' OR latest_read->>'calendarCanceled' IS DISTINCT FROM 'false'))
  OR latest_read->>'providerSubscriptionRef' IS DISTINCT FROM payload->>'providerSubscriptionRef' THEN RETURN false;END IF;
 IF o.kind IN('preview_proration','preview_update') THEN
  RETURN payload->>'currentReadDigest'=latest_read->>'currentReadDigest' AND payload->>'prorationAt' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.ordinal<o.ordinal
    AND later.ordinal>(SELECT max(original.ordinal) FROM subscription_controlled_operations original JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE original.resource_id=r.id AND original.kind='read_calendar')
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
  JOIN subscription_controlled_verifications v ON v.operation_id=original.id WHERE retained.collection_id=c.id ORDER BY original.ordinal DESC LIMIT 1;
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

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- OWNED UNAPPLIED successor AFTER collection-orchestration84 exact42dcc2bf.
-- Complete original functions retained; UNKNOWN cannot authorize target birth.
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
 SELECT op.original_request,v.actual_result INTO native_request,native FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.native_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_proration';
 SELECT op.original_request,v.actual_result INTO update_request,updated FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.update_preview_operation_id AND op.resource_id=r.id AND op.kind='preview_update';
 SELECT v.actual_result INTO calendar FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
  WHERE op.id=q.calendar_read_operation_id AND op.resource_id=r.id AND op.kind='read_calendar';
 SELECT v.actual_result INTO customer FROM subscription_controlled_operations op JOIN subscription_controlled_verifications v ON v.operation_id=op.id
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
CREATE OR REPLACE FUNCTION freeholder_controlled_original_period_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='period' AND (freeholder_controlled_original_period_source(NEW.quote_id) IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'An original next-period target requires its actual started trial/paid original period, unchanged mandate and exact returned preview/calendar lineage' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED after the genuine controlled collection/retention tails.
-- SOURCE ONLY / UNQUALIFIED. Root owns assembly, identity pins and NEW DB qualification.
-- Additive guards only: NO existing function/trigger is replaced or disabled.
-- This finite checkpoint REFUSES controlled cash application until its genuine
-- finished bank/refund/dispute + parent/batch proof has an actual frozen SQL
-- producer. A session marker, allowed flag or same amount is NEVER that proof.
CREATE FUNCTION freeholder_controlled_cash_application_shape(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE payment_row payments%ROWTYPE;invoice_row invoices%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;origin_row subscription_controlled_charge_origins%ROWTYPE;
 collection_row subscription_controlled_collections%ROWTYPE;quote_row subscription_controlled_quotes%ROWTYPE;
 resource_row subscription_controlled_resources%ROWTYPE;parent_row subscriptions%ROWTYPE;
 operation_row subscription_controlled_operations%ROWTYPE;call_row subscription_controlled_calls%ROWTYPE;fact_row subscription_controlled_facts%ROWTYPE;
 binding_row subscription_controlled_invoice_bindings%ROWTYPE;proof_row subscription_controlled_invoice_proofs%ROWTYPE;verification_row subscription_controlled_verifications%ROWTYPE;
 cash_rows numeric;cash_total numeric;bank jsonb;
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
 IF payment_row.id IS NULL OR invoice_row.id IS NULL OR collection_row.id IS NULL OR quote_row.id IS NULL OR resource_row.id IS NULL OR parent_row.id IS NULL
  OR NOT coalesce(freeholder_controlled_collection_valid(collection_row.id),false) OR collection_row.invoice_id IS DISTINCT FROM invoice_row.id
  OR invoice_row.source_type IS DISTINCT FROM 'subscription' OR invoice_row.source_id IS DISTINCT FROM quote_row.canonical_source_id
  OR invoice_row.contact_id IS DISTINCT FROM parent_row.contact_id OR invoice_row.currency IS DISTINCT FROM parent_row.currency
  OR quote_row.redacted_at IS NOT NULL OR collection_row.accepted_quote_digest IS DISTINCT FROM quote_row.quote_digest
  OR collection_row.original_consent_digest IS DISTINCT FROM quote_row.quote_digest OR quote_row.resource_id IS DISTINCT FROM resource_row.id
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
 -- REQUIRED dependency, deliberately NOT a free allowed/session-marker branch:
 -- genuine latest finished original charge/refund/dispute inspection + exact
 -- pre-application parent/privacy/credit/fee and bounded actual batch revision,
 -- including callback races and same-TX canonical deltas, has NO frozen SQL
 -- producer yet. Structural membership/read_manifest alone cannot supply it.
 RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment_uuid uuid;target_invoice_uuid uuid;before_row jsonb;after_row jsonb;candidate record;
BEGIN
 after_row=to_jsonb(NEW);IF TG_OP='UPDATE' THEN before_row=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='payments' THEN
  -- Existing refund counters/statuses do not create a new cash application.
  IF TG_OP='UPDATE' AND(before_row-ARRAY['refunded_minor','failure_code','failure_message'])=(after_row-ARRAY['refunded_minor','failure_code','failure_message']) THEN RETURN NEW;END IF;
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
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_payment_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_route_complete AFTER INSERT OR UPDATE ON merchant_agreement_payment_routes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER subscription_controlled_cash_invoice_complete AFTER INSERT OR UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard();

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED genuine bank-observation predicates.
-- After actual controlled collection/retention and original inspection-stop tails.
-- No application permission, activation, current assembly or existing function replacement.
CREATE FUNCTION freeholder_controlled_bank_minor(value jsonb,positive boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(value)='number' AND value::text ~ '^(0|[1-9][0-9]{0,15})$'
  THEN (value::text)::numeric BETWEEN CASE WHEN positive THEN 1 ELSE 0 END AND 9007199254740991 ELSE false END
$$;
--> statement-breakpoint
-- Pure policy over separately authenticated ORIGINAL capture and ACTUAL
-- finished current bank state. This cannot authenticate either on its own.
CREATE FUNCTION freeholder_controlled_bank_unreturned(expected jsonb,observed jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE refund_item jsonb;dispute_item jsonb;fee jsonb;transfer jsonb;recipient text;refund_ids text[]:=ARRAY[]::text[];dispute_ids text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(expected) IS DISTINCT FROM 'object' OR jsonb_typeof(observed) IS DISTINCT FROM 'object'
  OR expected->'customerChargeVerified' IS DISTINCT FROM 'true'::jsonb OR expected->'merchantRouteVerified' IS DISTINCT FROM 'true'::jsonb
  OR expected->>'providerApiVersion' IS DISTINCT FROM '2026-10-28.endive'
  OR NOT freeholder_controlled_bank_minor(expected->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(expected->'feeMinor')
  OR coalesce(expected->>'providerPlatformAccountId','')!~'^acct_[A-Za-z0-9]+$' OR coalesce(expected->>'providerRef','')!~'^pi_[A-Za-z0-9_]+$'
  OR coalesce(expected->>'chargeRef','')!~'^ch_[A-Za-z0-9_]+$' OR coalesce(expected->>'currency','')!~'^[A-Z]{3}$'
  OR observed->>'providerPlatformAccountId' IS DISTINCT FROM expected->>'providerPlatformAccountId'
  OR observed->>'chargeAccountId' IS DISTINCT FROM expected->>'providerAccountId' OR observed->>'providerApiVersion' IS DISTINCT FROM expected->>'providerApiVersion'
  OR observed->>'paymentProviderRef' IS DISTINCT FROM expected->>'providerRef' OR observed->>'providerChargeRef' IS DISTINCT FROM expected->>'chargeRef'
  OR observed->>'chargePaymentProviderRef' IS DISTINCT FROM expected->>'providerRef' OR observed->>'amountMinor' IS DISTINCT FROM expected->>'amountMinor'
  OR observed->>'chargeAmountMinor' IS DISTINCT FROM expected->>'amountMinor' OR observed->>'currency' IS DISTINCT FROM expected->>'currency'
  OR observed->>'chargeCurrency' IS DISTINCT FROM expected->>'currency' OR observed->>'paymentIntentStatus' IS DISTINCT FROM 'succeeded'
  OR NOT freeholder_controlled_bank_minor(observed->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(observed->'chargeAmountMinor',true)
  OR NOT freeholder_controlled_bank_minor(observed->'amountCapturableMinor') OR NOT freeholder_controlled_bank_minor(observed->'amountRefundedMinor')
  OR observed->>'amountCapturableMinor' IS DISTINCT FROM '0' OR observed->'paid' IS DISTINCT FROM 'true'::jsonb OR observed->'captured' IS DISTINCT FROM 'true'::jsonb
  OR observed->'refunded' IS DISTINCT FROM 'false'::jsonb OR observed->>'amountRefundedMinor' IS DISTINCT FROM '0'
  OR observed->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR observed->'disputesComplete' IS DISTINCT FROM 'true'::jsonb
  OR observed->'feeFieldObserved' IS DISTINCT FROM 'true'::jsonb OR observed->'transferFieldObserved' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(observed->'refunds') IS DISTINCT FROM 'array' OR jsonb_typeof(observed->'disputes') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF (expected->>'feeMinor')::numeric>(expected->>'amountMinor')::numeric OR jsonb_array_length(observed->'refunds')>1000 OR jsonb_array_length(observed->'disputes')>1000 THEN RETURN false;END IF;
 FOR refund_item IN SELECT value FROM jsonb_array_elements(observed->'refunds') LOOP
  IF jsonb_typeof(refund_item) IS DISTINCT FROM 'object' OR coalesce(refund_item->>'providerRef','')!~'^(re|pyr)_[A-Za-z0-9_]+$'
   OR refund_item->>'providerRef'=ANY(refund_ids) OR refund_item->>'paymentProviderRef' IS DISTINCT FROM expected->>'providerRef'
   OR refund_item->>'chargeRef' IS DISTINCT FROM expected->>'chargeRef' OR NOT freeholder_controlled_bank_minor(refund_item->'amountMinor',true)
   OR refund_item->>'currency' IS DISTINCT FROM expected->>'currency' OR coalesce(refund_item->>'status','') NOT IN('failed','canceled') THEN RETURN false;END IF;
  refund_ids=array_append(refund_ids,refund_item->>'providerRef');
 END LOOP;
 FOR dispute_item IN SELECT value FROM jsonb_array_elements(observed->'disputes') LOOP
  IF jsonb_typeof(dispute_item) IS DISTINCT FROM 'object' OR coalesce(dispute_item->>'providerRef','')!~'^du_[A-Za-z0-9_]+$'
   OR dispute_item->>'providerRef'=ANY(dispute_ids) OR dispute_item->>'chargeRef' IS DISTINCT FROM expected->>'chargeRef'
   OR coalesce(dispute_item->>'status','') NOT IN('won','warning_closed') THEN RETURN false;END IF;
  dispute_ids=array_append(dispute_ids,dispute_item->>'providerRef');
 END LOOP;
 recipient=coalesce(expected->>'destinationAccountId',expected->>'providerAccountId');fee=observed->'fee';transfer=observed->'transfer';
 IF coalesce(recipient,'')!~'^acct_[A-Za-z0-9]+$' THEN RETURN false;END IF;
 IF expected->>'feeMinor'='0' THEN
  IF fee IS DISTINCT FROM 'null'::jsonb OR expected->>'originalFeeRef' IS NOT NULL THEN RETURN false;END IF;
 ELSE
  IF jsonb_typeof(fee) IS DISTINCT FROM 'object' OR coalesce(fee->>'providerRef','')!~'^fee_[A-Za-z0-9_]+$'
   OR(expected->>'originalFeeRef' IS NOT NULL AND fee->>'providerRef' IS DISTINCT FROM expected->>'originalFeeRef')
   OR fee->>'originatingChargeRef' IS DISTINCT FROM expected->>'chargeRef' OR fee->>'accountId' IS DISTINCT FROM recipient
   OR NOT freeholder_controlled_bank_minor(fee->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(fee->'refundedMinor')
   OR fee->>'amountMinor' IS DISTINCT FROM expected->>'feeMinor' OR fee->>'refundedMinor' IS DISTINCT FROM '0' OR fee->>'currency' IS DISTINCT FROM expected->>'currency' THEN RETURN false;END IF;
 END IF;
 IF expected->>'destinationAccountId' IS NOT NULL THEN
  IF expected->>'providerAccountId' IS NOT NULL OR expected->>'settlementMerchantAccountId' IS DISTINCT FROM expected->>'destinationAccountId'
   OR jsonb_typeof(transfer) IS DISTINCT FROM 'object' OR coalesce(transfer->>'providerRef','')!~'^tr_[A-Za-z0-9_]+$'
   OR transfer->>'sourceChargeRef' IS DISTINCT FROM expected->>'chargeRef' OR transfer->>'destinationAccountId' IS DISTINCT FROM expected->>'destinationAccountId'
   OR NOT freeholder_controlled_bank_minor(transfer->'amountMinor',true) OR NOT freeholder_controlled_bank_minor(transfer->'reversedMinor')
   OR transfer->>'amountMinor' IS DISTINCT FROM expected->>'amountMinor' OR transfer->>'reversedMinor' IS DISTINCT FROM '0'
   OR transfer->'reversed' IS DISTINCT FROM 'false'::jsonb OR transfer->>'currency' IS DISTINCT FROM expected->>'currency' THEN RETURN false;END IF;
 ELSE
  IF expected->>'settlementMerchantAccountId' IS NOT NULL OR transfer IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
-- Internal observation witness only. Full CURRENT physical rows are hashed;
-- no own reader, callback, capture or canonical delta is removed. Historical
-- JS source_history_digest is retained, never compared to an unrelated PG hash.
CREATE FUNCTION freeholder_controlled_receipt_bank_observation(target_collection_uuid uuid,target_receipt_uuid uuid)
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
 -- Latest namespace admission, including an unfinished/negative later reader.
 -- A later payment-owned inspection cannot silently revive this older receipt read.
 SELECT * INTO inspection_row FROM merchant_cash_return_inspections inspection
  WHERE inspection.provider_platform_account_id=namespace_platform AND inspection.charge_account_id IS NOT DISTINCT FROM namespace_account AND inspection.original_payment_ref=namespace_intent
  ORDER BY inspection.created_at DESC,inspection.id DESC LIMIT 1;
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
-- Actual canonical fee ownership supplies the expectation; callers cannot
-- choose it by passing an amount/recipient JSON object to an authority.
-- TRUE means only this original bank observation is eligible unreturned cash,
-- NOT complete parent/application/principal/credit/access authority.
CREATE FUNCTION freeholder_controlled_receipt_bank_unreturned(target_collection_uuid uuid,target_receipt_uuid uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE observed_bank record;collection_row subscription_controlled_collections%ROWTYPE;invoice_row invoices%ROWTYPE;policy_row invoice_market_policies%ROWTYPE;
 receipt_row subscription_provider_charge_receipts%ROWTYPE;route_row merchant_agreement_payment_routes%ROWTYPE;payment_row payments%ROWTYPE;duty_row agreement_fee_duties%ROWTYPE;
 carried_fee numeric;cash_principal numeric;cash_fee numeric;prior_cash numeric;prior_fee numeric;fee_minor numeric;cash_count bigint;application_count bigint;
BEGIN
 SELECT * INTO observed_bank FROM freeholder_controlled_receipt_bank_observation(target_collection_uuid,target_receipt_uuid);
 IF observed_bank.actual_inspection_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO collection_row FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO invoice_row FROM invoices WHERE id=collection_row.invoice_id;SELECT * INTO policy_row FROM invoice_market_policies WHERE invoice_id=invoice_row.id;
 SELECT * INTO receipt_row FROM subscription_provider_charge_receipts WHERE id=target_receipt_uuid;
 SELECT * INTO route_row FROM merchant_agreement_payment_routes WHERE original_charge_receipt_id=receipt_row.id;
 SELECT * INTO payment_row FROM payments WHERE id=route_row.payment_id;
 IF invoice_row.id IS NULL OR policy_row.model IS DISTINCT FROM 'seller_merchant' OR invoice_row.currency IS DISTINCT FROM receipt_row.currency THEN RETURN false;END IF;
 IF route_row.payment_id IS NOT NULL THEN
  -- Exact immutable original fee allocation was retained by the original route
  -- writer. Do not reprice it or infer a different per-receipt residual order.
  IF payment_row.invoice_id IS DISTINCT FROM invoice_row.id OR payment_row.provider IS DISTINCT FROM 'stripe' OR payment_row.method IS DISTINCT FROM 'provider_schedule'
   OR payment_row.amount_minor IS DISTINCT FROM receipt_row.amount_minor OR payment_row.currency IS DISTINCT FROM receipt_row.currency
   OR route_row.origin_kind IS DISTINCT FROM 'provider_schedule' OR route_row.provider_api_version IS DISTINCT FROM receipt_row.provider_api_version
   OR route_row.provider_platform_account_id IS DISTINCT FROM receipt_row.provider_platform_account_id OR route_row.charge_account_id IS DISTINCT FROM receipt_row.charge_account_id
   OR route_row.provider_invoice_ref IS DISTINCT FROM receipt_row.provider_invoice_ref OR route_row.provider_subscription_ref IS DISTINCT FROM receipt_row.provider_subscription_ref
   OR route_row.provider_payment_intent_ref IS DISTINCT FROM receipt_row.provider_payment_intent_ref OR route_row.provider_charge_ref IS DISTINCT FROM receipt_row.provider_charge_ref THEN RETURN false;END IF;
  fee_minor=route_row.application_fee_minor;
 ELSE
  SELECT count(*),coalesce(sum(application.fee_obligation_minor),0) INTO application_count,carried_fee FROM invoice_credit_applications application WHERE application.invoice_id=invoice_row.id;
  IF application_count>5000 OR EXISTS(SELECT 1 FROM invoice_credit_applications application WHERE application.invoice_id=invoice_row.id AND application.fee_evidence_digest IS NULL)
   OR coalesce((SELECT sum(reservation.amount_minor) FROM invoice_credit_applications application JOIN invoice_credit_reservations reservation ON reservation.id=application.reservation_id WHERE application.invoice_id=invoice_row.id),0) IS DISTINCT FROM invoice_row.credited_minor::numeric THEN RETURN false;END IF;
  cash_principal=invoice_row.total_minor-invoice_row.credited_minor;cash_fee=greatest(0,policy_row.fee_minor-carried_fee);
  IF split_part(invoice_row.source_id,':',2)='proration' THEN
   SELECT * INTO duty_row FROM agreement_fee_duties WHERE invoice_id=invoice_row.id;
   IF duty_row.invoice_id IS NULL OR duty_row.total_minor IS DISTINCT FROM invoice_row.total_minor OR duty_row.target_fee_minor IS DISTINCT FROM policy_row.fee_minor
    OR duty_row.credited_minor IS DISTINCT FROM invoice_row.credited_minor OR duty_row.carried_fee_minor IS DISTINCT FROM carried_fee
    OR duty_row.cash_principal_minor IS DISTINCT FROM cash_principal OR duty_row.cash_fee_target_minor IS DISTINCT FROM least(cash_principal,cash_fee) THEN RETURN false;END IF;
   cash_fee=duty_row.cash_fee_target_minor;
  END IF;
  IF cash_principal<=0 OR cash_fee>cash_principal THEN RETURN false;END IF;
  SELECT count(*),coalesce(sum(accounted_payment.amount_minor),0),coalesce(sum(coalesce(external_owner.fee_owed_minor,agreement_owner.application_fee_minor)),0)
   INTO cash_count,prior_cash,prior_fee FROM payments accounted_payment
   LEFT JOIN commercial_payment_attestations external_owner ON external_owner.payment_id=accounted_payment.id
   LEFT JOIN merchant_agreement_payment_routes agreement_owner ON agreement_owner.payment_id=accounted_payment.id
   WHERE accounted_payment.invoice_id=invoice_row.id AND accounted_payment.status='succeeded';
  IF cash_count+application_count>5000 OR prior_cash IS DISTINCT FROM invoice_row.paid_minor::numeric OR prior_cash+receipt_row.amount_minor>cash_principal
   OR prior_fee IS DISTINCT FROM floor(cash_fee*prior_cash/cash_principal)
   OR EXISTS(SELECT 1 FROM payments accounted_payment LEFT JOIN commercial_payment_attestations external_owner ON external_owner.payment_id=accounted_payment.id
    LEFT JOIN merchant_agreement_payment_routes agreement_owner ON agreement_owner.payment_id=accounted_payment.id
    WHERE accounted_payment.invoice_id=invoice_row.id AND accounted_payment.status='succeeded'
     AND((external_owner.payment_id IS NOT NULL)::integer+(agreement_owner.payment_id IS NOT NULL)::integer<>1 OR accounted_payment.refunded_minor<>0)) THEN RETURN false;END IF;
  fee_minor=floor(cash_fee*(prior_cash+receipt_row.amount_minor)/cash_principal)-prior_fee;
 END IF;
 RETURN freeholder_controlled_bank_unreturned(observed_bank.original_expectation||jsonb_build_object('feeMinor',fee_minor),observed_bank.current_evidence) IS TRUE;
END $$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED follow-on AFTER d598 and signed cde lineage.
-- Frozen earlier fragments/current journals remain byte-for-byte unchanged.
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

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08: OWNED UNAPPLIED future parent/batch application protocol.
-- AFTER genuine controlled bank evidence and the complete six target families.
-- No current journal/body is changed. This file is not a permission flag.
CREATE TABLE controlled_cash_application_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 collection_id uuid NOT NULL REFERENCES subscription_controlled_collections(id) ON DELETE RESTRICT,
 quote_id uuid NOT NULL REFERENCES subscription_controlled_quotes(id) ON DELETE RESTRICT,
 resource_id uuid NOT NULL REFERENCES subscription_controlled_resources(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
 terms_id uuid NOT NULL REFERENCES subscription_commercial_terms(id) ON DELETE RESTRICT,
 protocol text NOT NULL,admission_transaction_id text NOT NULL DEFAULT txid_current()::text,
 bank_revision text NOT NULL,parent_revision text NOT NULL,parent_pg_revision text NOT NULL,pre_application_revision text NOT NULL,
 accepted_quote_digest text NOT NULL,canonical_target_digest text NOT NULL,
 before_entries jsonb NOT NULL,mutable_before_rows jsonb NOT NULL,requested_receipt_ids jsonb NOT NULL,raw_bindings jsonb NOT NULL,
 invoice_before_fingerprint text NOT NULL,invoice_before_status text NOT NULL,
 invoice_before_paid_minor bigint NOT NULL,invoice_before_credited_minor bigint NOT NULL,invoice_before_refunded_minor bigint NOT NULL,
 invoice_before_paid_at text,invoice_before_updated_at text NOT NULL,
 expected_cash_minor bigint NOT NULL,expected_fee_minor bigint NOT NULL,currency text NOT NULL,
 digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_batches_protocol CHECK(protocol='controlled_net_gross.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT controlled_cash_batches_digests CHECK(bank_revision ~ '^[a-f0-9]{64}$' AND parent_revision ~ '^[a-f0-9]{64}$' AND parent_pg_revision ~ '^[a-f0-9]{64}$' AND pre_application_revision ~ '^[a-f0-9]{64}$' AND accepted_quote_digest ~ '^[a-f0-9]{64}$' AND canonical_target_digest ~ '^[a-f0-9]{64}$' AND invoice_before_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT controlled_cash_batches_arrays CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries) BETWEEN 1 AND 5000 AND jsonb_typeof(mutable_before_rows)='array' AND jsonb_array_length(mutable_before_rows)<=5000 AND jsonb_typeof(requested_receipt_ids)='array' AND jsonb_array_length(requested_receipt_ids) BETWEEN 1 AND 5000 AND jsonb_typeof(raw_bindings)='array' AND jsonb_array_length(raw_bindings)<=5000),
 CONSTRAINT controlled_cash_batches_amounts CHECK(invoice_before_paid_minor BETWEEN 0 AND 9007199254740991 AND invoice_before_credited_minor BETWEEN 0 AND 9007199254740991 AND invoice_before_refunded_minor=0 AND expected_cash_minor BETWEEN 1 AND 9007199254740991 AND expected_fee_minor BETWEEN 0 AND expected_cash_minor AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT controlled_cash_batches_invoice_status CHECK(invoice_before_status IN('sent','viewed','partially_paid','overdue'))
);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_collection_idx ON controlled_cash_application_batches(collection_id,created_at);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_invoice_idx ON controlled_cash_application_batches(invoice_id,created_at);
--> statement-breakpoint
CREATE INDEX controlled_cash_batches_subscription_idx ON controlled_cash_application_batches(subscription_id,created_at);
--> statement-breakpoint
CREATE TABLE controlled_cash_application_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES controlled_cash_application_batches(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,ordinal integer NOT NULL,
 original_observation_id uuid NOT NULL REFERENCES subscription_provider_charge_observations(id) ON DELETE RESTRICT,
 origin_operation_id uuid NOT NULL REFERENCES subscription_controlled_operations(id) ON DELETE RESTRICT,
 origin_call_id uuid NOT NULL REFERENCES subscription_controlled_calls(id) ON DELETE RESTRICT,origin_fact_id uuid NOT NULL REFERENCES subscription_controlled_facts(id) ON DELETE RESTRICT,
 bank_inspection_id uuid NOT NULL REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,bank_observation_id uuid NOT NULL REFERENCES merchant_cash_return_observations(id) ON DELETE RESTRICT,bank_finish_caller_id uuid NOT NULL,
 immutable_bank_revision text NOT NULL,namespace_revision text NOT NULL,receipt_fingerprint text NOT NULL,
 original_observation_ids jsonb NOT NULL,
 amount_minor bigint NOT NULL,currency text NOT NULL,prior_cash_minor bigint NOT NULL,prior_allocated_fee_minor bigint NOT NULL,fee_minor bigint NOT NULL,
 fee_allocation_revision text NOT NULL,payment_evidence_digest text NOT NULL,payment_idempotency_key text NOT NULL,payment_request_hash text NOT NULL,
 processed_at timestamptz NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_receipts_batch_receipt_key UNIQUE(batch_id,receipt_id),
 CONSTRAINT controlled_cash_receipts_batch_ordinal_key UNIQUE(batch_id,ordinal),
 CONSTRAINT controlled_cash_receipts_payment_key_key UNIQUE(payment_idempotency_key),
 CONSTRAINT controlled_cash_receipts_order CHECK(ordinal BETWEEN 1 AND 5000),
 CONSTRAINT controlled_cash_receipts_amounts CHECK(amount_minor BETWEEN 1 AND 9007199254740991 AND prior_cash_minor BETWEEN 0 AND 9007199254740991 AND prior_allocated_fee_minor BETWEEN 0 AND 9007199254740991 AND fee_minor BETWEEN 0 AND amount_minor AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT controlled_cash_receipts_digests CHECK(immutable_bank_revision ~ '^[a-f0-9]{64}$' AND namespace_revision ~ '^[a-f0-9]{64}$' AND receipt_fingerprint ~ '^[a-f0-9]{64}$' AND fee_allocation_revision ~ '^[a-f0-9]{64}$' AND payment_evidence_digest ~ '^[a-f0-9]{64}$' AND payment_request_hash ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT controlled_cash_receipts_inventory CHECK(jsonb_typeof(original_observation_ids)='array' AND jsonb_array_length(original_observation_ids) BETWEEN 1 AND 5000 AND length(payment_idempotency_key) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX controlled_cash_receipts_receipt_idx ON controlled_cash_application_receipts(receipt_id);
--> statement-breakpoint
CREATE INDEX controlled_cash_receipts_inspection_idx ON controlled_cash_application_receipts(bank_inspection_id);
--> statement-breakpoint
CREATE TABLE controlled_cash_application_links (
 receipt_id uuid PRIMARY KEY REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 receipt_proof_id uuid NOT NULL REFERENCES controlled_cash_application_receipts(id) ON DELETE RESTRICT,
 batch_id uuid NOT NULL REFERENCES controlled_cash_application_batches(id) ON DELETE RESTRICT,
 payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 created_payment_fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT controlled_cash_links_payment_key UNIQUE(payment_id),CONSTRAINT controlled_cash_links_proof_key UNIQUE(receipt_proof_id),
 CONSTRAINT controlled_cash_links_fingerprint CHECK(created_payment_fingerprint ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX controlled_cash_links_batch_idx ON controlled_cash_application_links(batch_id);
--> statement-breakpoint
-- Exact finite FK closure. It yields identities, never allowed/principalSafe.
-- No account, amount, current email or fabricated provider phase selects a row.
CREATE FUNCTION freeholder_controlled_cash_scope(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 selected_collection subscription_controlled_collections%ROWTYPE; selected_quote subscription_controlled_quotes%ROWTYPE; selected_resource subscription_controlled_resources%ROWTYPE;
 scope_subscriptions uuid[]=ARRAY[]::uuid[]; scope_direct_invoices uuid[]=ARRAY[]::uuid[]; scope_invoices uuid[]=ARRAY[]::uuid[]; scope_payments uuid[]=ARRAY[]::uuid[]; scope_receipts uuid[]=ARRAY[]::uuid[];
 scope_prorations uuid[]=ARRAY[]::uuid[]; scope_funding uuid[]=ARRAY[]::uuid[]; scope_reservations uuid[]=ARRAY[]::uuid[]; scope_applications uuid[]=ARRAY[]::uuid[]; scope_notes uuid[]=ARRAY[]::uuid[];
 scope_resources uuid[]=ARRAY[]::uuid[]; scope_operations uuid[]=ARRAY[]::uuid[]; scope_calls uuid[]=ARRAY[]::uuid[]; scope_quotes uuid[]=ARRAY[]::uuid[]; scope_collections uuid[]=ARRAY[]::uuid[];
 scope_refunds uuid[]=ARRAY[]::uuid[]; scope_requests uuid[]=ARRAY[]::uuid[]; scope_refund_dispatches uuid[]=ARRAY[]::uuid[]; scope_inspections uuid[]=ARRAY[]::uuid[];
 scope_cash_owners uuid[]=ARRAY[]::uuid[]; scope_fees uuid[]=ARRAY[]::uuid[]; scope_profiles uuid[]=ARRAY[]::uuid[]; scope_contacts uuid[]=ARRAY[]::uuid[]; scope_legacy_reads uuid[]=ARRAY[]::uuid[];
 scope_payment_dispatches uuid[]=ARRAY[]::uuid[]; scope_resolutions uuid[]=ARRAY[]::uuid[]; scope_data_requests uuid[]=ARRAY[]::uuid[]; scope_batches uuid[]=ARRAY[]::uuid[]; scope_receipt_proofs uuid[]=ARRAY[]::uuid[];
 scope_plans uuid[]=ARRAY[]::uuid[]; scope_card_reads uuid[]=ARRAY[]::uuid[]; scope_returns uuid[]=ARRAY[]::uuid[]; scope_namespaces jsonb='[]'::jsonb;
 prior_size integer=-1; current_size integer=0; rounds integer=0; original_funding_uuid uuid; next_funding_uuid uuid; seen_funding uuid[];
BEGIN
 SELECT * INTO selected_collection FROM subscription_controlled_collections WHERE id=target_collection_uuid;
 SELECT * INTO selected_quote FROM subscription_controlled_quotes WHERE id=selected_collection.quote_id;
 SELECT * INTO selected_resource FROM subscription_controlled_resources WHERE id=selected_quote.resource_id;
 IF selected_collection.id IS NULL OR selected_quote.id IS NULL OR selected_resource.id IS NULL OR selected_collection.invoice_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM subscription_commercial_terms actual_terms WHERE actual_terms.id=selected_collection.terms_id AND actual_terms.subscription_id=selected_resource.subscription_id) THEN
  RAISE EXCEPTION 'Restore the actual accepted target and original resource before discovering cash-application ancestry' USING ERRCODE='23514';END IF;
 scope_subscriptions=ARRAY[selected_resource.subscription_id];
 LOOP
  rounds=rounds+1;IF rounds>5001 THEN RAISE EXCEPTION 'Original financial ancestry exceeds its finite complete bound' USING ERRCODE='23514';END IF;
  SELECT coalesce(array_agg(DISTINCT identities.invoice_id) FILTER(WHERE identities.invoice_id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_direct_invoices FROM(
   SELECT source_event.invoice_id FROM subscription_events source_event WHERE source_event.subscription_id=ANY(scope_subscriptions)
   UNION SELECT original_proration.debit_invoice_id FROM subscription_prorations original_proration WHERE original_proration.subscription_id=ANY(scope_subscriptions)
   UNION SELECT target.invoice_id FROM subscription_controlled_collections target JOIN subscription_controlled_quotes quote_owner ON quote_owner.id=target.quote_id JOIN subscription_controlled_resources resource_owner ON resource_owner.id=quote_owner.resource_id WHERE resource_owner.subscription_id=ANY(scope_subscriptions)
   UNION SELECT actual_payment.invoice_id FROM merchant_agreement_payment_routes actual_route JOIN payments actual_payment ON actual_payment.id=actual_route.payment_id WHERE actual_route.subscription_id=ANY(scope_subscriptions)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_prorations FROM(
   SELECT unnest(scope_prorations) AS id UNION SELECT actual_proration.id FROM subscription_prorations actual_proration WHERE actual_proration.subscription_id=ANY(scope_subscriptions)
   UNION SELECT original_funding.proration_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT target.id FROM invoice_credit_reservations actual_reservation JOIN subscription_prorations target ON actual_reservation.target_source_id=target.subscription_id::text||':proration:'||target.id::text WHERE actual_reservation.id=ANY(scope_reservations)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_notes FROM(
   SELECT unnest(scope_notes) AS id UNION SELECT actual_note.id FROM credit_notes actual_note WHERE actual_note.invoice_id=ANY(scope_direct_invoices)
   UNION SELECT actual_proration.credit_note_id FROM subscription_prorations actual_proration WHERE actual_proration.id=ANY(scope_prorations)
   UNION SELECT original_funding.credit_note_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT selected_collection.credit_note_id
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_funding FROM(
   SELECT unnest(scope_funding) AS id UNION SELECT original_funding.id FROM invoice_credit_funding original_funding WHERE original_funding.proration_id=ANY(scope_prorations) OR original_funding.credit_note_id=ANY(scope_notes)
   UNION SELECT actual_reservation.funding_id FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.id=ANY(scope_reservations) OR actual_reservation.id=ANY(scope_applications)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_reservations FROM(
   SELECT unnest(scope_reservations) AS id UNION SELECT actual_reservation.id FROM invoice_credit_reservations actual_reservation WHERE actual_reservation.funding_id=ANY(scope_funding)
   UNION SELECT original_funding.source_application_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT actual_application.reservation_id),ARRAY[]::uuid[]) INTO scope_applications FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=ANY(scope_reservations);
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_payments FROM(
   SELECT actual_payment.id FROM payments actual_payment WHERE actual_payment.invoice_id=ANY(scope_direct_invoices)
   UNION SELECT original_funding.source_payment_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
   UNION SELECT principal_part.source_payment_id FROM subscription_proration_principal principal_part WHERE principal_part.proration_id=ANY(scope_prorations)
   UNION SELECT original_attestation.payment_id FROM commercial_payment_attestations original_attestation JOIN subscription_prorations owner_proration
    ON original_attestation.invoice_id IN(owner_proration.original_invoice_id,owner_proration.debit_invoice_id) AND original_attestation.merchant_profile_id=owner_proration.profile_id WHERE owner_proration.id=ANY(scope_prorations)
   UNION SELECT actual_route.payment_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.original_charge_receipt_id=ANY(scope_receipts)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_receipts FROM(
   SELECT actual_receipt.id FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.subscription_id=ANY(scope_subscriptions)
   UNION SELECT actual_route.original_charge_receipt_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=ANY(scope_payments)
  ) identities;
  SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_subscriptions FROM(
   SELECT unnest(scope_subscriptions) AS id UNION SELECT actual_receipt.subscription_id FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.id=ANY(scope_receipts)
   UNION SELECT actual_route.subscription_id FROM merchant_agreement_payment_routes actual_route WHERE actual_route.payment_id=ANY(scope_payments)
   UNION SELECT actual_proration.subscription_id FROM subscription_prorations actual_proration WHERE actual_proration.id=ANY(scope_prorations)
  ) identities;
  current_size=cardinality(scope_subscriptions)+cardinality(scope_direct_invoices)+cardinality(scope_payments)+cardinality(scope_receipts)+cardinality(scope_prorations)+cardinality(scope_funding)+cardinality(scope_reservations)+cardinality(scope_applications)+cardinality(scope_notes);
  IF current_size>5000 THEN RAISE EXCEPTION 'Retain complete financial ancestry as review debt instead of truncating its identities' USING ERRCODE='23514';END IF;
  EXIT WHEN current_size=prior_size;prior_size=current_size;
 END LOOP;
 IF EXISTS(SELECT 1 FROM invoice_credit_funding original_funding LEFT JOIN subscription_prorations original_proration ON original_proration.id=original_funding.proration_id
  LEFT JOIN credit_notes actual_note ON actual_note.id=original_funding.credit_note_id LEFT JOIN credit_note_lines actual_line ON actual_line.id=original_funding.credit_note_line_id
  LEFT JOIN payments actual_principal ON actual_principal.id=original_funding.source_payment_id WHERE original_funding.id=ANY(scope_funding) AND(
   original_proration.id IS NULL OR original_proration.credit_note_id IS DISTINCT FROM original_funding.credit_note_id OR original_proration.original_invoice_id IS DISTINCT FROM original_funding.source_invoice_id
   OR actual_note.invoice_id IS DISTINCT FROM original_funding.source_invoice_id OR actual_line.credit_note_id IS DISTINCT FROM actual_note.id OR actual_principal.id IS NULL
   OR(original_funding.source_application_id IS NULL AND actual_principal.invoice_id IS DISTINCT FROM original_funding.source_invoice_id)
   OR EXISTS(SELECT 1 FROM return_requests return_owner WHERE return_owner.credit_note_id=original_funding.credit_note_id))) THEN
  RAISE EXCEPTION 'The original issued credit lines and real principal must retain their exact proration ownership, not a second RMA refund promise' USING ERRCODE='23514';END IF;
 FOREACH original_funding_uuid IN ARRAY scope_funding LOOP
  next_funding_uuid=original_funding_uuid;seen_funding=ARRAY[]::uuid[];
  WHILE next_funding_uuid IS NOT NULL LOOP
   IF next_funding_uuid=ANY(seen_funding) OR cardinality(seen_funding)>5000 THEN RAISE EXCEPTION 'A cyclic credit lineage supplies no principal' USING ERRCODE='23514';END IF;
   seen_funding=array_append(seen_funding,next_funding_uuid);
   SELECT previous_reservation.funding_id INTO next_funding_uuid FROM invoice_credit_funding original_funding
    JOIN invoice_credit_applications previous_application ON previous_application.reservation_id=original_funding.source_application_id
    JOIN invoice_credit_reservations previous_reservation ON previous_reservation.id=previous_application.reservation_id WHERE original_funding.id=next_funding_uuid;
  END LOOP;
 END LOOP;
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_invoices FROM(
  SELECT unnest(scope_direct_invoices) AS id UNION SELECT actual_payment.invoice_id FROM payments actual_payment WHERE actual_payment.id=ANY(scope_payments)
  UNION SELECT original_proration.original_invoice_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
  UNION SELECT original_proration.debit_invoice_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
  UNION SELECT original_funding.source_invoice_id FROM invoice_credit_funding original_funding WHERE original_funding.id=ANY(scope_funding)
  UNION SELECT actual_application.invoice_id FROM invoice_credit_applications actual_application WHERE actual_application.reservation_id=ANY(scope_applications)
 ) identities;
 SELECT coalesce(array_agg(actual_resource.id),ARRAY[]::uuid[]) INTO scope_resources FROM subscription_controlled_resources actual_resource WHERE actual_resource.subscription_id=ANY(scope_subscriptions);
 SELECT coalesce(array_agg(actual_operation.id),ARRAY[]::uuid[]) INTO scope_operations FROM subscription_controlled_operations actual_operation WHERE actual_operation.resource_id=ANY(scope_resources);
 SELECT coalesce(array_agg(actual_call.id),ARRAY[]::uuid[]) INTO scope_calls FROM subscription_controlled_calls actual_call WHERE actual_call.operation_id=ANY(scope_operations);
 SELECT coalesce(array_agg(actual_quote.id),ARRAY[]::uuid[]) INTO scope_quotes FROM subscription_controlled_quotes actual_quote WHERE actual_quote.resource_id=ANY(scope_resources);
 SELECT coalesce(array_agg(actual_collection.id),ARRAY[]::uuid[]) INTO scope_collections FROM subscription_controlled_collections actual_collection WHERE actual_collection.quote_id=ANY(scope_quotes);
 SELECT coalesce(jsonb_agg(DISTINCT namespace_value), '[]'::jsonb) INTO scope_namespaces FROM(
  SELECT jsonb_build_object('platform',actual_receipt.provider_platform_account_id,'account',actual_receipt.charge_account_id,'intent',actual_receipt.provider_payment_intent_ref,'charge',actual_receipt.provider_charge_ref) AS namespace_value
   FROM subscription_provider_charge_receipts actual_receipt WHERE actual_receipt.id=ANY(scope_receipts)
  UNION SELECT jsonb_build_object('platform',actual_observation.provider_platform_account_id,'account',actual_observation.charge_account_id,'intent',actual_observation.provider_ref,'charge',actual_observation.provider_charge_ref)
   FROM merchant_payment_observations actual_observation WHERE actual_observation.payment_id=ANY(scope_payments)
 ) actual_namespaces;
 SELECT coalesce(array_agg(actual_refund.id),ARRAY[]::uuid[]) INTO scope_refunds FROM refunds actual_refund WHERE actual_refund.payment_id=ANY(scope_payments);
 SELECT coalesce(array_agg(actual_request.id),ARRAY[]::uuid[]) INTO scope_requests FROM merchant_refund_requests actual_request WHERE actual_request.payment_id=ANY(scope_payments) OR actual_request.subscription_charge_receipt_id=ANY(scope_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_namespaces) namespace_value WHERE namespace_value->>'platform'=actual_request.provider_platform_account_id AND namespace_value->>'account' IS NOT DISTINCT FROM actual_request.charge_account_id AND namespace_value->>'intent'=actual_request.original_payment_ref);
 SELECT coalesce(array_agg(actual_dispatch.id),ARRAY[]::uuid[]) INTO scope_refund_dispatches FROM merchant_refund_dispatches actual_dispatch WHERE actual_dispatch.request_id=ANY(scope_requests);
 SELECT coalesce(array_agg(actual_inspection.id),ARRAY[]::uuid[]) INTO scope_inspections FROM merchant_cash_return_inspections actual_inspection WHERE actual_inspection.payment_id=ANY(scope_payments) OR actual_inspection.subscription_charge_receipt_id=ANY(scope_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_namespaces) namespace_value WHERE namespace_value->>'platform'=actual_inspection.provider_platform_account_id AND namespace_value->>'account' IS NOT DISTINCT FROM actual_inspection.charge_account_id AND namespace_value->>'intent'=actual_inspection.original_payment_ref);
 SELECT coalesce(array_agg(actual_owner.id),ARRAY[]::uuid[]) INTO scope_cash_owners FROM original_cash_recoveries actual_owner WHERE actual_owner.payment_id=ANY(scope_payments) OR actual_owner.subscription_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_fee.id),ARRAY[]::uuid[]) INTO scope_fees FROM merchant_fee_refunds actual_fee WHERE actual_fee.payment_id=ANY(scope_payments) OR actual_fee.original_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_profiles FROM(
  SELECT original_terms.profile_id AS id FROM subscription_commercial_terms original_terms WHERE original_terms.subscription_id=ANY(scope_subscriptions)
  UNION SELECT actual_quote.profile_id FROM subscription_controlled_quotes actual_quote WHERE actual_quote.id=ANY(scope_quotes)
  UNION SELECT original_proration.profile_id FROM subscription_prorations original_proration WHERE original_proration.id=ANY(scope_prorations)
 ) identities;
 SELECT coalesce(array_agg(DISTINCT identities.id) FILTER(WHERE identities.id IS NOT NULL),ARRAY[]::uuid[]) INTO scope_contacts FROM(
  SELECT actual_parent.contact_id AS id FROM subscriptions actual_parent WHERE actual_parent.id=ANY(scope_subscriptions)
  UNION SELECT actual_invoice.contact_id FROM invoices actual_invoice WHERE actual_invoice.id=ANY(scope_invoices)
  UNION SELECT actual_profile.contact_id FROM merchant_tax_profiles actual_profile WHERE actual_profile.id=ANY(scope_profiles)
  UNION SELECT actual_policy.merchant_contact_id FROM subscription_market_policies actual_policy WHERE actual_policy.subscription_id=ANY(scope_subscriptions)
 ) identities;
 SELECT coalesce(array_agg(actual_read.id),ARRAY[]::uuid[]) INTO scope_legacy_reads FROM legacy_bank_reads actual_read WHERE actual_read.refund_id=ANY(scope_refunds);
 SELECT coalesce(array_agg(actual_dispatch.id),ARRAY[]::uuid[]) INTO scope_payment_dispatches FROM merchant_payment_dispatches actual_dispatch WHERE actual_dispatch.payment_id=ANY(scope_payments);
 SELECT coalesce(array_agg(actual_resolution.id),ARRAY[]::uuid[]) INTO scope_resolutions FROM merchant_unapplied_charge_resolutions actual_resolution WHERE actual_resolution.payment_id=ANY(scope_payments) OR actual_resolution.subscription_charge_receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_request.id),ARRAY[]::uuid[]) INTO scope_data_requests FROM data_requests actual_request WHERE actual_request.contact_id=ANY(scope_contacts);
 SELECT coalesce(array_agg(actual_batch.id),ARRAY[]::uuid[]) INTO scope_batches FROM controlled_cash_application_batches actual_batch WHERE actual_batch.subscription_id=ANY(scope_subscriptions) OR actual_batch.invoice_id=ANY(scope_invoices);
 SELECT coalesce(array_agg(actual_proof.id),ARRAY[]::uuid[]) INTO scope_receipt_proofs FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=ANY(scope_batches) OR actual_proof.receipt_id=ANY(scope_receipts);
 SELECT coalesce(array_agg(actual_plan.id),ARRAY[]::uuid[]) INTO scope_plans FROM payment_plans actual_plan WHERE actual_plan.invoice_id=ANY(scope_invoices);
 SELECT coalesce(array_agg(actual_read.id),ARRAY[]::uuid[]) INTO scope_card_reads FROM subscription_proration_card_reads actual_read WHERE actual_read.payment_id=ANY(scope_payments) OR EXISTS(SELECT 1 FROM subscription_proration_payment_protocols original_protocol WHERE original_protocol.payment_id=actual_read.payment_id AND original_protocol.proration_id=ANY(scope_prorations));
 SELECT coalesce(array_agg(actual_return.id),ARRAY[]::uuid[]) INTO scope_returns FROM return_requests actual_return WHERE actual_return.credit_note_id=ANY(scope_notes) OR actual_return.refund_id=ANY(scope_refunds)
  OR EXISTS(SELECT 1 FROM return_refund_allocations original_allocation WHERE original_allocation.return_id=actual_return.id AND original_allocation.payment_id=ANY(scope_payments));
 RETURN jsonb_build_object('subscriptions',to_jsonb(scope_subscriptions),'directInvoices',to_jsonb(scope_direct_invoices),'invoices',to_jsonb(scope_invoices),'payments',to_jsonb(scope_payments),'receipts',to_jsonb(scope_receipts),
  'prorations',to_jsonb(scope_prorations),'funding',to_jsonb(scope_funding),'reservations',to_jsonb(scope_reservations),'applications',to_jsonb(scope_applications),'notes',to_jsonb(scope_notes),
  'resources',to_jsonb(scope_resources),'operations',to_jsonb(scope_operations),'calls',to_jsonb(scope_calls),'quotes',to_jsonb(scope_quotes),'collections',to_jsonb(scope_collections),'refunds',to_jsonb(scope_refunds),
  'requests',to_jsonb(scope_requests),'refundDispatches',to_jsonb(scope_refund_dispatches),'inspections',to_jsonb(scope_inspections),'cashOwners',to_jsonb(scope_cash_owners),'fees',to_jsonb(scope_fees),
  'profiles',to_jsonb(scope_profiles),'contacts',to_jsonb(scope_contacts),'legacyReads',to_jsonb(scope_legacy_reads),'paymentDispatches',to_jsonb(scope_payment_dispatches),'resolutions',to_jsonb(scope_resolutions),
  'dataRequests',to_jsonb(scope_data_requests),'batches',to_jsonb(scope_batches),'receiptProofs',to_jsonb(scope_receipt_proofs),'plans',to_jsonb(scope_plans),'cardReads',to_jsonb(scope_card_reads),'returns',to_jsonb(scope_returns),'namespaces',scope_namespaces);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_scope_ids(actual_scope jsonb,scope_key text) RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE ids uuid[];
BEGIN
 IF jsonb_typeof(actual_scope->scope_key) IS DISTINCT FROM 'array' OR jsonb_array_length(actual_scope->scope_key)>5000 THEN RAISE EXCEPTION 'Restore a complete exact financial identity array' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid),ARRAY[]::uuid[]) INTO ids FROM jsonb_array_elements_text(actual_scope->scope_key);
 IF cardinality(ids)<>(SELECT count(DISTINCT value) FROM unnest(ids) value) THEN RAISE EXCEPTION 'Repeated financial identities cannot hide missing rows' USING ERRCODE='23514';END IF;
 RETURN ids;
END $$;
--> statement-breakpoint
-- Independent complete PostgreSQL row-SHA snapshot. Every selector below is a
-- source-owned literal over the actual FK closure; neither caller input nor a
-- JSON before-image can invent a table, amount owner, account or SQL predicate.
CREATE FUNCTION freeholder_controlled_cash_parent_entries(target_collection_uuid uuid)
RETURNS TABLE(family text,identity text,fingerprint text) LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_scope jsonb; descriptor record; returned_count integer; total_count integer=0;
BEGIN
 actual_scope=freeholder_controlled_cash_scope(target_collection_uuid);
 FOR descriptor IN SELECT * FROM(VALUES
  ('subscriptions','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_commercial_terms','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_merchant_scopes','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_market_policies','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_events','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_resources','observed.subscription_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_operations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_schedule_erasures','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')) OR observed.profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('subscription_commercial_amendments','observed.terms_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_commercial_resumptions','observed.terms_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_generations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_charge_receipts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('subscription_provider_charge_observations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_invoice_observations','observed.id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_invoice_lines','observed.id','EXISTS(SELECT 1 FROM subscription_provider_invoice_observations owner_observation WHERE owner_observation.id=observed.observation_id AND owner_observation.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')))'),
  ('subscription_provider_read_tickets','observed.read_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_provider_read_finishes','observed.read_id','EXISTS(SELECT 1 FROM subscription_provider_read_tickets actual_ticket WHERE actual_ticket.read_id=observed.read_id AND actual_ticket.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')))'),
  ('subscription_provider_read_stops','observed.read_id','observed.subscription_id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions''))'),
  ('subscription_controlled_resources','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('subscription_controlled_operations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''operations''))'),
  ('subscription_controlled_calls','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_facts','observed.id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_finishes','observed.call_id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_stops','observed.call_id','observed.call_id=ANY(freeholder_controlled_cash_scope_ids($1,''calls''))'),
  ('subscription_controlled_verifications','observed.operation_id','observed.operation_id=ANY(freeholder_controlled_cash_scope_ids($1,''operations''))'),
  ('subscription_controlled_charge_origins','observed.receipt_id','observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('subscription_controlled_closures','observed.resource_id','observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('subscription_controlled_quotes','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''quotes''))'),
  ('subscription_controlled_collections','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_components','observed.id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_invoice_bindings','observed.collection_id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('subscription_controlled_item_receipts','observed.component_id','EXISTS(SELECT 1 FROM subscription_controlled_components actual_component WHERE actual_component.id=observed.component_id AND actual_component.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections'')))'),
  ('subscription_controlled_invoice_proofs','observed.id','observed.collection_id=ANY(freeholder_controlled_cash_scope_ids($1,''collections''))'),
  ('invoices','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_lines','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_market_policies','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_merchant_tax_quotes','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('invoice_merchant_tax_quote_lines','observed.invoice_line_id','EXISTS(SELECT 1 FROM invoice_lines original_line WHERE original_line.id=observed.invoice_line_id AND original_line.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices'')))'),
  ('tax_lines','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('credit_notes','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''notes''))'),
  ('credit_note_lines','observed.id','observed.credit_note_id=ANY(freeholder_controlled_cash_scope_ids($1,''notes''))'),
  ('payments','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('payment_disputes','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('refunds','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds''))'),
  ('money_state_events','observed.id','(observed.subject_type=''payment'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))) OR(observed.subject_type=''invoice'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))) OR(observed.subject_type=''refund'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds''))) OR(observed.subject_type=''payment_plan'' AND observed.subject_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans'')))'),
  ('merchant_agreement_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR observed.original_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))'),
  ('merchant_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('payment_merchant_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_invoice_payment_routes','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('invoice_merchant_allocations','observed.id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_allocation_lines','observed.invoice_line_id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.allocation_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_collections','observed.allocation_id','EXISTS(SELECT 1 FROM merchant_payment_routes actual_route WHERE actual_route.allocation_id=observed.allocation_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('invoice_merchant_scopes','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''directInvoices'')) OR EXISTS(SELECT 1 FROM merchant_invoice_payment_routes actual_route WHERE actual_route.invoice_id=observed.invoice_id AND actual_route.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')))'),
  ('merchant_payment_observations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND namespace_value->>''intent''=observed.provider_ref)'),
  ('merchant_payment_event_receipts','observed.id','observed.claimed_payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND(observed.evidence->>''providerRef''=namespace_value->>''intent'' OR(namespace_value->>''charge'' IS NOT NULL AND observed.evidence->>''providerChargeRef''=namespace_value->>''charge'')))'),
  ('merchant_payment_requests','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_dispatches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_dispatch_finishes','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_dispatch_stops','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_resource_bindings','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_creation_refusals','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''paymentDispatches''))'),
  ('merchant_payment_retirement_acks','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_payment_terminal_receipts','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('merchant_fee_refunds','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''fees''))'),
  ('merchant_fee_observations','observed.id','observed.operation_id=ANY(freeholder_controlled_cash_scope_ids($1,''fees''))'),
  ('merchant_refund_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_reservation_retirements','observed.request_id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_dispatches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_dispatch_finishes','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_dispatch_stops','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_creation_refusals','observed.dispatch_id','observed.dispatch_id=ANY(freeholder_controlled_cash_scope_ids($1,''refundDispatches''))'),
  ('merchant_refund_terminal_receipts','observed.request_id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_resource_bindings','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_observations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR observed.subscription_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=observed.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM observed.charge_account_id AND namespace_value->>''intent''=observed.payment_provider_ref)'),
  ('merchant_refund_observation_captures','observed.id','EXISTS(SELECT 1 FROM merchant_refund_observations owner_observation WHERE owner_observation.id=observed.observation_id AND(owner_observation.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR owner_observation.subscription_charge_receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR owner_observation.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')) OR EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE namespace_value->>''platform''=owner_observation.provider_platform_account_id AND namespace_value->>''account'' IS NOT DISTINCT FROM owner_observation.charge_account_id AND namespace_value->>''intent''=owner_observation.payment_provider_ref)))'),
  ('merchant_refund_state_reads','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_refund_state_read_finishes','observed.read_id','EXISTS(SELECT 1 FROM merchant_refund_state_reads actual_read WHERE actual_read.id=observed.read_id AND actual_read.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests'')))'),
  ('merchant_refund_current_receipts','observed.id','observed.request_id=ANY(freeholder_controlled_cash_scope_ids($1,''requests''))'),
  ('merchant_cash_return_inspections','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('subscription_controlled_cash_inspection_lineages','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts'')) OR observed.resource_id=ANY(freeholder_controlled_cash_scope_ids($1,''resources''))'),
  ('merchant_cash_return_inspection_finishes','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_inspection_stops','observed.inspection_id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_primary_observations','observed.id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_cash_return_observations','observed.id','observed.inspection_id=ANY(freeholder_controlled_cash_scope_ids($1,''inspections''))'),
  ('merchant_unapplied_charge_resolutions','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''resolutions''))'),
  ('merchant_unapplied_charge_resolution_refunds','observed.resolution_id::text||'':''||observed.observation_id::text','observed.resolution_id=ANY(freeholder_controlled_cash_scope_ids($1,''resolutions''))'),
  ('original_cash_recoveries','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_operations','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_facts','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('original_cash_recovery_closures','observed.id','observed.recovery_id=ANY(freeholder_controlled_cash_scope_ids($1,''cashOwners''))'),
  ('legacy_bank_reads','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_facts','observed.id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_finishes','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_current_receipts','observed.id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_read_stops','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''legacyReads''))'),
  ('legacy_bank_feedback','observed.id','EXISTS(SELECT 1 FROM jsonb_array_elements($1->''namespaces'') namespace_value WHERE observed.evidence->>''observedChargeAccountId'' IS NOT DISTINCT FROM namespace_value->>''account'' AND(observed.evidence->>''observedPlatformAccountId'' IS NULL OR observed.evidence->>''observedPlatformAccountId''=namespace_value->>''platform'') AND(observed.evidence->>''observedPaymentRef''=namespace_value->>''intent'' OR(observed.evidence->>''observedPaymentRef'' IS NULL AND namespace_value->>''charge'' IS NOT NULL AND observed.evidence->>''observedChargeRef''=namespace_value->>''charge''))) OR EXISTS(SELECT 1 FROM refunds original_refund JOIN payments original_payment ON original_payment.id=original_refund.payment_id WHERE original_refund.id=ANY(freeholder_controlled_cash_scope_ids($1,''refunds'')) AND original_refund.provider_ref=observed.evidence->>''observedRefundRef'')'),
  ('commercial_payment_attestations','observed.payment_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('commercial_refund_attestations','observed.refund_id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('commercial_fee_attestations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('invoice_credit_funding','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''funding''))'),
  ('invoice_credit_reservations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''reservations''))'),
  ('invoice_credit_applications','observed.reservation_id','observed.reservation_id=ANY(freeholder_controlled_cash_scope_ids($1,''applications''))'),
  ('invoice_credit_releases','observed.reservation_id','observed.reservation_id=ANY(freeholder_controlled_cash_scope_ids($1,''reservations''))'),
  ('subscription_prorations','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_principal','observed.id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_credit_uses','observed.id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('agreement_fee_duties','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_credit_assignments','observed.application_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_cash_assignments','observed.payment_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_eligibility','observed.invoice_id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('agreement_fee_remittances','observed.id','observed.invoice_id=ANY(freeholder_controlled_cash_scope_ids($1,''invoices''))'),
  ('subscription_proration_cash_confirmations','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_credit_confirmations','observed.application_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_payment_protocols','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) OR observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('subscription_proration_card_mandates','observed.proration_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_card_attempts','observed.payment_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) OR observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments''))'),
  ('subscription_proration_card_jobs','observed.proration_id','observed.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations''))'),
  ('subscription_proration_card_reads','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('subscription_proration_card_read_finishes','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('subscription_proration_card_read_stops','observed.read_id','observed.read_id=ANY(freeholder_controlled_cash_scope_ids($1,''cardReads''))'),
  ('payment_methods','observed.id','EXISTS(SELECT 1 FROM subscriptions actual_parent WHERE actual_parent.id=ANY(freeholder_controlled_cash_scope_ids($1,''subscriptions'')) AND actual_parent.payment_method_id=observed.id) OR EXISTS(SELECT 1 FROM subscription_proration_card_mandates actual_mandate WHERE actual_mandate.proration_id=ANY(freeholder_controlled_cash_scope_ids($1,''prorations'')) AND actual_mandate.payment_method_id=observed.id)'),
  ('merchant_tax_profiles','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('merchant_tax_profile_versions','observed.id','observed.profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('tax_registrations','observed.id','observed.merchant_profile_id=ANY(freeholder_controlled_cash_scope_ids($1,''profiles''))'),
  ('contacts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''contacts''))'),
  ('data_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''dataRequests''))'),
  ('privacy_retention_exceptions','observed.id','observed.data_request_id=ANY(freeholder_controlled_cash_scope_ids($1,''dataRequests''))'),
  ('return_requests','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('return_items','observed.id','observed.return_id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('return_refund_allocations','observed.id','observed.return_id=ANY(freeholder_controlled_cash_scope_ids($1,''returns''))'),
  ('payment_plans','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''plans''))'),
  ('payment_plan_installments','observed.id','observed.plan_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans''))'),
  ('payment_allocations','observed.id','observed.payment_id=ANY(freeholder_controlled_cash_scope_ids($1,''payments'')) OR EXISTS(SELECT 1 FROM payment_plan_installments actual_installment WHERE actual_installment.id=observed.installment_id AND actual_installment.plan_id=ANY(freeholder_controlled_cash_scope_ids($1,''plans'')))'),
  ('controlled_cash_application_batches','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''batches''))'),
  ('controlled_cash_application_receipts','observed.id','observed.id=ANY(freeholder_controlled_cash_scope_ids($1,''receiptProofs''))'),
  ('controlled_cash_application_links','observed.receipt_id','observed.batch_id=ANY(freeholder_controlled_cash_scope_ids($1,''batches'')) OR observed.receipt_id=ANY(freeholder_controlled_cash_scope_ids($1,''receipts''))')
 ) AS declared_family(table_name,identity_sql,scope_sql) LOOP
  RETURN QUERY EXECUTE format('SELECT %L::text,(%s)::text,encode(sha256(convert_to(to_jsonb(observed)::text,''UTF8'')),''hex'') FROM %I observed WHERE %s ORDER BY 2 LIMIT 5001',descriptor.table_name,descriptor.identity_sql,descriptor.table_name,descriptor.scope_sql) USING actual_scope;
  GET DIAGNOSTICS returned_count=ROW_COUNT;total_count=total_count+returned_count;
  IF total_count>5000 THEN RAISE EXCEPTION 'Retain complete financial parent/source rows as review debt; no truncated proof can admit money' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_parent_snapshot(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_entries jsonb; actual_count integer; actual_revision text;
BEGIN
 SELECT count(*),jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_count,actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(target_collection_uuid) actual_entry;
 IF actual_count NOT BETWEEN 1 AND 5000 OR actual_revision IS NULL THEN RAISE EXCEPTION 'The complete actual financial parent cannot be an empty or truncated proof' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('entries',actual_entries,'revision',actual_revision,'physicalRowCount',actual_count);
END $$;
--> statement-breakpoint
-- Normalize ONLY the shared money spine's explicitly proved invoice columns.
-- Every other live column remains in the full PostgreSQL row SHA, including
-- actual buyer/source/tax/legal fields; no billing before-image is duplicated.
CREATE FUNCTION freeholder_controlled_cash_normalized_invoice(target_batch_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_invoice invoices%ROWTYPE; settled_cash numeric; settled_count integer; planned_count integer; actual_status text; actual_paid_at timestamptz; restored_fingerprint text;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_invoice.id IS NULL THEN RAISE EXCEPTION 'Normalize only this actual transaction and original canonical invoice' USING ERRCODE='23514';END IF;
 SELECT count(*),coalesce(sum(actual_payment.amount_minor),0) INTO settled_count,settled_cash
 FROM controlled_cash_application_links actual_link JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.batch_id=actual_link.batch_id AND receipt_proof.receipt_id=actual_link.receipt_id
 JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE actual_link.batch_id=admitted_batch.id AND actual_payment.status='succeeded';
 SELECT count(*) INTO planned_count FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF settled_count>planned_count OR settled_cash>admitted_batch.expected_cash_minor OR actual_invoice.paid_minor::numeric IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric+settled_cash
  OR actual_invoice.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_invoice.refunded_minor IS DISTINCT FROM admitted_batch.invoice_before_refunded_minor
  OR actual_invoice.currency IS DISTINCT FROM admitted_batch.currency OR actual_invoice.paid_minor::numeric+actual_invoice.credited_minor>actual_invoice.total_minor::numeric THEN
  RAISE EXCEPTION 'Actual settled receipts must conserve the exact prior cash, issued credit and unpaid remainder' USING ERRCODE='23514';END IF;
 actual_status=CASE WHEN settled_count=0 THEN admitted_batch.invoice_before_status WHEN actual_invoice.paid_minor+actual_invoice.credited_minor=actual_invoice.total_minor THEN 'paid' ELSE 'partially_paid' END;
 IF actual_invoice.status IS DISTINCT FROM actual_status THEN RAISE EXCEPTION 'A partial receipt cannot become a paid invoice or erase its remainder' USING ERRCODE='23514';END IF;
 IF actual_status='paid' THEN
  SELECT receipt_proof.processed_at INTO actual_paid_at FROM controlled_cash_application_receipts receipt_proof JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=receipt_proof.batch_id AND actual_link.receipt_id=receipt_proof.receipt_id
   JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE receipt_proof.batch_id=admitted_batch.id AND actual_payment.status='succeeded' ORDER BY receipt_proof.ordinal DESC LIMIT 1;
 ELSE actual_paid_at=admitted_batch.invoice_before_paid_at::timestamptz;END IF;
 IF actual_invoice.paid_at IS DISTINCT FROM actual_paid_at THEN RAISE EXCEPTION 'Preserve the actual shared settlement date; no fabricated paid time supplies access' USING ERRCODE='23514';END IF;
 restored_fingerprint=encode(sha256(convert_to((to_jsonb(actual_invoice)||jsonb_build_object('status',admitted_batch.invoice_before_status,'paid_minor',admitted_batch.invoice_before_paid_minor,
  'paid_at',admitted_batch.invoice_before_paid_at::timestamptz,'updated_at',admitted_batch.invoice_before_updated_at::timestamptz))::text,'UTF8')),'hex');
 IF restored_fingerprint IS DISTINCT FROM admitted_batch.invoice_before_fingerprint THEN RAISE EXCEPTION 'Only exact own cash/status/date columns may differ from the original complete invoice row' USING ERRCODE='23514';END IF;
 RETURN restored_fingerprint;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_normalized_payment(target_payment_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_payment payments%ROWTYPE; actual_link controlled_cash_application_links%ROWTYPE; admitted_receipt controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; restored_fingerprint text; expected_hash text;
BEGIN
 SELECT * INTO actual_payment FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO actual_link FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO admitted_receipt FROM controlled_cash_application_receipts WHERE id=actual_link.receipt_proof_id;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=actual_link.batch_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=actual_link.receipt_id;
 IF actual_payment.id IS NULL OR actual_link.receipt_id IS NULL OR admitted_receipt.id IS NULL OR admitted_batch.id IS NULL OR original_receipt.id IS NULL
  OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR admitted_receipt.batch_id IS DISTINCT FROM admitted_batch.id OR admitted_receipt.receipt_id IS DISTINCT FROM actual_link.receipt_id
  OR actual_payment.invoice_id IS DISTINCT FROM admitted_batch.invoice_id OR actual_payment.provider IS DISTINCT FROM 'stripe' OR actual_payment.method IS DISTINCT FROM 'provider_schedule'
  OR actual_payment.amount_minor IS DISTINCT FROM admitted_receipt.amount_minor OR actual_payment.currency IS DISTINCT FROM admitted_receipt.currency
  OR actual_payment.idempotency_key IS DISTINCT FROM admitted_receipt.payment_idempotency_key OR actual_payment.request_hash IS DISTINCT FROM admitted_receipt.payment_request_hash
  OR actual_payment.refunded_minor<>0 OR actual_payment.provider_checkout_ref IS NOT NULL OR actual_payment.failure_code IS NOT NULL OR actual_payment.failure_message IS NOT NULL OR actual_payment.failed_at IS NOT NULL
  OR actual_payment.metadata IS DISTINCT FROM '{}'::jsonb OR actual_payment.status NOT IN('created','processing','succeeded')
  OR actual_payment.provider_ref IS NOT NULL AND actual_payment.provider_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_payment.status='created' AND actual_payment.provider_ref IS NOT NULL
  OR actual_payment.status='succeeded' AND(actual_payment.provider_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref OR actual_payment.processed_at IS DISTINCT FROM admitted_receipt.processed_at)
  OR actual_payment.status<>'succeeded' AND actual_payment.processed_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(admitted_batch.before_entries) original_entry WHERE original_entry->>'table'='payments' AND original_entry->>'id'=actual_payment.id::text) THEN
  RAISE EXCEPTION 'Only the genuine new exact receipt-owned payment may cross this canonical stage; never reuse an equal or historical payment' USING ERRCODE='23514';END IF;
 IF admitted_receipt.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||original_receipt.id::text THEN
  RAISE EXCEPTION 'Bind actual receipt identity to its canonical request, not to amount equality' USING ERRCODE='23514';END IF;
 -- This exact shared payment DTO has only ASCII UUID/constants and an integer
 -- <=MAX_SAFE_INTEGER. Reproduce its canonical key order, not jsonb spacing.
 expected_hash=encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
  admitted_receipt.amount_minor,admitted_receipt.payment_idempotency_key,admitted_batch.invoice_id,original_receipt.id),'UTF8')),'hex');
 IF actual_payment.request_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'The complete real shared createPayment input must match the original exact receipt proof' USING ERRCODE='23514';END IF;
 restored_fingerprint=encode(sha256(convert_to((to_jsonb(actual_payment)||jsonb_build_object('status','created','provider_ref',null,'processed_at',null,'failure_code',null,'failure_message',null,'updated_at',actual_payment.created_at))::text,'UTF8')),'hex');
 IF restored_fingerprint IS DISTINCT FROM actual_link.created_payment_fingerprint THEN RAISE EXCEPTION 'Only the exact shared created-to-processing-to-settled fields may change the actual newly linked payment row' USING ERRCODE='23514';END IF;
 RETURN restored_fingerprint;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_ref(actual_ref jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(actual_ref)='string' THEN actual_ref#>>'{}' WHEN jsonb_typeof(actual_ref)='object' AND jsonb_typeof(actual_ref->'id')='string' THEN actual_ref->>'id' ELSE null END
$$;
--> statement-breakpoint
-- Current complete bank invoice inventory remains observational. Real captured
-- sources are selected by their ACTUAL PI/namespace/creator FKs before amounts
-- are checked; no sum or balance creates ownership of an unassigned receipt.
CREATE FUNCTION freeholder_controlled_cash_bank_invoice(target_collection_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
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
 total_minor=freeholder_controlled_bank_minor(actual_inventory->'totalMinor',false);paid_minor=freeholder_controlled_bank_minor(actual_inventory->'paidMinor',false);remaining_minor=freeholder_controlled_bank_minor(actual_inventory->'remainingMinor',false);
 IF total_minor IS NULL OR paid_minor IS NULL OR remaining_minor IS NULL OR total_minor IS DISTINCT FROM freeholder_controlled_bank_minor(actual_manifest->'cashDueMinor',false)
  OR paid_minor::numeric+remaining_minor::numeric IS DISTINCT FROM total_minor::numeric OR actual_inventory->>'status'='paid' AND remaining_minor<>0 OR actual_inventory->>'status'='open' AND remaining_minor=0
  OR actual_invoice->'amount_paid' IS DISTINCT FROM to_jsonb(paid_minor) OR actual_invoice->'amount_remaining' IS DISTINCT FROM to_jsonb(remaining_minor) THEN
  RAISE EXCEPTION 'Actual paid and remaining consideration must conserve the frozen gross-minus-locked-credit bank total without clipping' USING ERRCODE='23514';END IF;
 FOR intent_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualIntents') LOOP
  intent_ref=freeholder_controlled_cash_ref(intent_atom->'id');received_minor=freeholder_controlled_bank_minor(intent_atom->'amount_received',false);
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
   payment_minor=freeholder_controlled_bank_minor(payment_atom->'amount_paid',false);IF payment_minor IS NULL THEN RAISE EXCEPTION 'Retain imprecise invoice-payment amounts as review' USING ERRCODE='23514';END IF;
   payment_sum=payment_sum+payment_minor;
  END LOOP;
  IF payment_sum IS DISTINCT FROM received_minor::numeric THEN RAISE EXCEPTION 'Complete actual invoice-payment atoms must account for the exact original captured PI, never aggregate amount adoption' USING ERRCODE='23514';END IF;
  positive_receipts=array_append(positive_receipts,actual_receipt.id);total_received=total_received+received_minor;
 END LOOP;
 FOR payment_atom IN SELECT value FROM jsonb_array_elements(actual_inventory->'actualPayments') LOOP
  payment_ref=freeholder_controlled_cash_ref(payment_atom->'id');payment_minor=freeholder_controlled_bank_minor(payment_atom->'amount_paid',false);intent_ref=freeholder_controlled_cash_ref(payment_atom->'payment'->'payment_intent');
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
-- An alternate SQL writer may RECHECK an already held prefix, never acquire a
-- resource after it has acquired an invoice lock. These are actual backend
-- locks, not a caller-supplied flag. Transaction IDs below bind own writes only;
-- the genuine admission lineage, never transaction time/ID, orders bank reads.
CREATE FUNCTION freeholder_controlled_cash_require_prefix(target_resource_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
  AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
  AND actual_lock.classid::bigint=(CASE WHEN hashtext('controlled-provider:'||target_resource_uuid::text)<0 THEN 4294967295::bigint ELSE 0::bigint END)
  AND actual_lock.objid::bigint=(hashtext('controlled-provider:'||target_resource_uuid::text)::bigint & 4294967295::bigint))
 OR NOT EXISTS(SELECT 1 FROM pg_locks identity_lock WHERE identity_lock.pid=pg_backend_pid() AND identity_lock.locktype='advisory' AND identity_lock.granted
  AND identity_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND identity_lock.mode IN('ShareLock','ExclusiveLock') AND identity_lock.objsubid=1
  AND ((identity_lock.classid::bigint << 32) | identity_lock.objid::bigint)=hashtext('contact-identity-privacy')::bigint) THEN
  RAISE EXCEPTION 'The actual contact/resource prefix must already be held before canonical application; never acquire it in reverse' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
-- The full original PG preimage is retained ONCE. Only this new batch and its
-- newborn immutable receipt admissions may exist between the snapshot and the
-- first payment insert. An unexpected callback, bare read, source-credit change
-- or even an unrelated state-event append makes the complete comparison fail.
CREATE FUNCTION freeholder_controlled_cash_prewrite(target_batch_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_entries jsonb; actual_revision text; actual_count integer;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=admitted_batch.id) THEN
  RAISE EXCEPTION 'The first-write preimage cannot be reused after a canonical receipt mutation' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(admitted_batch.resource_id);
 SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),'[]'::jsonb),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_count,actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(admitted_batch.collection_id) actual_entry
 WHERE NOT(actual_entry.family='controlled_cash_application_batches' AND actual_entry.identity=admitted_batch.id::text)
  AND NOT(actual_entry.family='controlled_cash_application_receipts' AND EXISTS(SELECT 1 FROM controlled_cash_application_receipts own_proof WHERE own_proof.batch_id=admitted_batch.id AND own_proof.id::text=actual_entry.identity));
 IF actual_count NOT BETWEEN 1 AND 5000 OR actual_entries IS DISTINCT FROM admitted_batch.before_entries OR actual_revision IS DISTINCT FROM admitted_batch.parent_pg_revision THEN
  RAISE EXCEPTION 'Every current physical parent/source/raw occurrence must still match the immutable original prewrite graph' USING ERRCODE='23514';END IF;
 RETURN actual_revision;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_invoice invoices%ROWTYPE;
 actual_snapshot jsonb; actual_bank jsonb; selected_ids uuid[]; expected_cash numeric; actual_mutable jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original controlled cash application admissions are immutable financial evidence' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=NEW.collection_id;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_invoice FROM invoices WHERE id=actual_collection.invoice_id;
 PERFORM freeholder_controlled_cash_require_prefix(NEW.resource_id);
 IF actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_invoice.id IS NULL OR NEW.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR actual_collection.quote_id IS DISTINCT FROM NEW.quote_id OR actual_quote.resource_id IS DISTINCT FROM NEW.resource_id
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_resources original_resource WHERE original_resource.id=NEW.resource_id AND original_resource.subscription_id=NEW.subscription_id)
  OR actual_collection.invoice_id IS DISTINCT FROM NEW.invoice_id OR actual_collection.terms_id IS DISTINCT FROM NEW.terms_id
  OR actual_collection.accepted_quote_digest IS DISTINCT FROM NEW.accepted_quote_digest OR actual_collection.canonical_target_digest IS DISTINCT FROM NEW.canonical_target_digest
  OR actual_invoice.currency IS DISTINCT FROM NEW.currency OR actual_invoice.status IS DISTINCT FROM NEW.invoice_before_status
  OR actual_invoice.paid_minor IS DISTINCT FROM NEW.invoice_before_paid_minor OR actual_invoice.credited_minor IS DISTINCT FROM NEW.invoice_before_credited_minor OR actual_invoice.refunded_minor<>0
  OR to_jsonb(actual_invoice)->>'paid_at' IS DISTINCT FROM NEW.invoice_before_paid_at OR to_jsonb(actual_invoice)->>'updated_at' IS DISTINCT FROM NEW.invoice_before_updated_at
  OR encode(sha256(convert_to(to_jsonb(actual_invoice)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.invoice_before_fingerprint THEN
  RAISE EXCEPTION 'The immutable application admission must bind the exact real accepted collection and complete current canonical invoice' USING ERRCODE='23514';END IF;
 actual_snapshot=freeholder_controlled_cash_parent_snapshot(NEW.collection_id);
 IF actual_snapshot->'entries' IS DISTINCT FROM NEW.before_entries OR actual_snapshot->>'revision' IS DISTINCT FROM NEW.parent_pg_revision THEN
  RAISE EXCEPTION 'A parent admission cannot omit or rewrite any physical current source family or raw occurrence' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO selected_ids FROM jsonb_array_elements_text(NEW.requested_receipt_ids);
 IF cardinality(selected_ids) NOT BETWEEN 1 AND 5000 OR cardinality(selected_ids)<>(SELECT count(DISTINCT value) FROM unnest(selected_ids) value)
  OR NEW.requested_receipt_ids IS DISTINCT FROM to_jsonb(selected_ids) THEN RAISE EXCEPTION 'Freeze the exact sorted unique retained receipt UUID batch' USING ERRCODE='23514';END IF;
 actual_bank=freeholder_controlled_cash_bank_invoice(NEW.collection_id);
 IF EXISTS(SELECT 1 FROM unnest(selected_ids) selected_id WHERE NOT(actual_bank->'positiveReceiptIds' @> to_jsonb(ARRAY[selected_id])))
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes prior_route WHERE prior_route.original_charge_receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual_bank->'positiveReceiptIds') bank_id WHERE NOT(bank_id::uuid=ANY(selected_ids)) AND NOT EXISTS(
   SELECT 1 FROM merchant_agreement_payment_routes original_route JOIN payments original_payment ON original_payment.id=original_route.payment_id
   WHERE original_route.original_charge_receipt_id=bank_id::uuid AND original_payment.invoice_id=NEW.invoice_id AND original_payment.status='succeeded'
    AND original_payment.refunded_minor=0 AND original_payment.provider='stripe' AND original_payment.method='provider_schedule')) THEN
  RAISE EXCEPTION 'Every actual positive bank receipt must be either exact already canonical cash or explicitly admitted new cash; no receipt reuse or value adoption' USING ERRCODE='23514';END IF;
 SELECT sum(original_receipt.amount_minor) INTO expected_cash FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(selected_ids) AND original_receipt.currency=NEW.currency;
 IF expected_cash IS DISTINCT FROM NEW.expected_cash_minor::numeric OR NEW.invoice_before_paid_minor::numeric+expected_cash+NEW.invoice_before_credited_minor>actual_invoice.total_minor::numeric
  OR NEW.invoice_before_paid_minor::numeric+expected_cash IS DISTINCT FROM (actual_bank->>'paidMinor')::numeric THEN
  RAISE EXCEPTION 'Preserve actual partial bank cash and unpaid remainder; never clip an overage or invent a second principal' USING ERRCODE='23514';END IF;
 -- Freeze only the exact shared plan columns that settlement may mutate, with
 -- original PG timestamp precision and full-row SHA for every affected row.
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',candidate.family,'id',candidate.identity,'fingerprint',candidate.fingerprint,'fields',candidate.fields) ORDER BY candidate.family,candidate.identity),'[]'::jsonb)
 INTO actual_mutable FROM(
  SELECT 'payment_plans'::text family,actual_plan.id::text identity,encode(sha256(convert_to(to_jsonb(actual_plan)::text,'UTF8')),'hex') fingerprint,
   jsonb_build_object('paid_minor',actual_plan.paid_minor,'status',actual_plan.status,'updated_at',to_jsonb(actual_plan)->>'updated_at') fields FROM payment_plans actual_plan WHERE actual_plan.invoice_id=NEW.invoice_id
  UNION ALL SELECT 'payment_plan_installments',actual_installment.id::text,encode(sha256(convert_to(to_jsonb(actual_installment)::text,'UTF8')),'hex'),
   jsonb_build_object('paid_minor',actual_installment.paid_minor,'status',actual_installment.status,'updated_at',to_jsonb(actual_installment)->>'updated_at')
   FROM payment_plan_installments actual_installment JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id WHERE actual_plan.invoice_id=NEW.invoice_id
 ) candidate;
 IF NEW.mutable_before_rows IS DISTINCT FROM actual_mutable THEN RAISE EXCEPTION 'The full exact original payment-plan preimage must be complete; no plan-row backfill or partial selector' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_batches_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_batches FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_batch();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; original_origin subscription_controlled_charge_origins%ROWTYPE;
 actual_bank record; actual_observation subscription_provider_charge_observations%ROWTYPE; actual_inspection merchant_cash_return_inspections%ROWTYPE; exact_observation_ids uuid[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original exact receipt/bank admissions are immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Receipt admission belongs to the same actual original application transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_prewrite(admitted_batch.id);
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO original_origin FROM subscription_controlled_charge_origins WHERE receipt_id=NEW.receipt_id;
 SELECT * INTO actual_inspection FROM merchant_cash_return_inspections WHERE id=NEW.bank_inspection_id;
 SELECT * INTO actual_observation FROM subscription_provider_charge_observations WHERE id=NEW.original_observation_id;
 SELECT * INTO actual_bank FROM freeholder_controlled_receipt_bank_observation(admitted_batch.collection_id,NEW.receipt_id);
 IF original_receipt.id IS NULL OR original_origin.receipt_id IS NULL OR actual_inspection.id IS NULL OR actual_observation.id IS NULL OR actual_bank.actual_inspection_id IS NULL
  OR NOT(admitted_batch.requested_receipt_ids @> to_jsonb(ARRAY[NEW.receipt_id])) OR original_receipt.subscription_id IS DISTINCT FROM admitted_batch.subscription_id
  OR NEW.ordinal IS DISTINCT FROM(SELECT ordinal::integer FROM jsonb_array_elements_text(admitted_batch.requested_receipt_ids) WITH ORDINALITY selected_id(value,ordinal) WHERE value=NEW.receipt_id::text)
  OR original_origin.resource_id IS DISTINCT FROM admitted_batch.resource_id OR original_origin.operation_id IS DISTINCT FROM NEW.origin_operation_id OR original_origin.call_id IS DISTINCT FROM NEW.origin_call_id OR original_origin.fact_id IS DISTINCT FROM NEW.origin_fact_id
  OR original_receipt.amount_minor IS DISTINCT FROM NEW.amount_minor OR original_receipt.currency IS DISTINCT FROM NEW.currency OR NEW.currency IS DISTINCT FROM admitted_batch.currency
  OR encode(sha256(convert_to(to_jsonb(original_receipt)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.receipt_fingerprint
  OR actual_inspection.payment_id IS NOT NULL OR actual_inspection.subscription_charge_receipt_id IS DISTINCT FROM NEW.receipt_id OR actual_inspection.subscription_charge_observation_id IS DISTINCT FROM NEW.original_observation_id
  OR actual_inspection.caller->>'id' IS DISTINCT FROM NEW.bank_finish_caller_id::text OR actual_bank.actual_inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR actual_bank.actual_observation_id IS DISTINCT FROM NEW.bank_observation_id
  OR NEW.processed_at IS DISTINCT FROM(SELECT date_trunc('milliseconds',original_bank.created_at) FROM merchant_cash_return_observations original_bank WHERE original_bank.id=NEW.bank_observation_id AND original_bank.inspection_id=NEW.bank_inspection_id)
  OR actual_bank.immutable_bank_fingerprint IS DISTINCT FROM NEW.immutable_bank_revision OR actual_bank.bank_fingerprint IS DISTINCT FROM NEW.namespace_revision
  OR actual_observation.subscription_id IS DISTINCT FROM original_receipt.subscription_id OR actual_observation.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_observation.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR actual_observation.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR actual_observation.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR actual_observation.currency IS DISTINCT FROM original_receipt.currency
  OR actual_observation.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR actual_observation.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR actual_observation.provider_charge_ref IS NOT NULL AND actual_observation.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR NOT actual_observation.customer_charge_verified OR NOT actual_observation.merchant_route_verified THEN
  RAISE EXCEPTION 'Only genuine original receipt/caller/returned bank lineage in the exact platform/account/PI namespace can supply a prospective cash admission' USING ERRCODE='23514';END IF;
 -- Match the existing authenticated source's retained display order. This is
 -- array identity only: genuine bank chronology uses the separate lineage.
 SELECT coalesce(array_agg(observed.id ORDER BY observed.created_at,observed.id),ARRAY[]::uuid[]) INTO exact_observation_ids FROM subscription_provider_charge_observations observed
  WHERE observed.subscription_id=original_receipt.subscription_id AND observed.provider_platform_account_id=original_receipt.provider_platform_account_id
   AND observed.charge_account_id IS NOT DISTINCT FROM original_receipt.charge_account_id AND observed.provider_payment_intent_ref=original_receipt.provider_payment_intent_ref;
 IF NEW.original_observation_ids IS DISTINCT FROM to_jsonb(exact_observation_ids)
  OR EXISTS(SELECT 1 FROM subscription_provider_charge_observations observed WHERE observed.id=ANY(exact_observation_ids) AND(
   observed.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version OR observed.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
   OR observed.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR observed.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR observed.currency IS DISTINCT FROM original_receipt.currency
   OR observed.provider_charge_ref IS NOT NULL AND observed.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
   OR observed.actual_destination_account_id IS DISTINCT FROM original_receipt.actual_destination_account_id OR observed.actual_settlement_merchant_account_id IS DISTINCT FROM original_receipt.actual_settlement_merchant_account_id
   OR NOT observed.customer_charge_verified OR NOT observed.merchant_route_verified))
  OR NOT freeholder_controlled_bank_unreturned(actual_bank.original_expectation||jsonb_build_object('feeMinor',NEW.fee_minor),actual_bank.current_evidence)
  OR NEW.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||NEW.receipt_id::text
  OR NEW.payment_request_hash IS DISTINCT FROM encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
   NEW.amount_minor,NEW.payment_idempotency_key,admitted_batch.invoice_id,NEW.receipt_id),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Keep every original observation and exact real shared request; current fee/recipient/refund/dispute facts cannot be waived by a marker' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_receipts_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_receipts FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_receipt();
--> statement-breakpoint
-- A complete actual receipt prefix is required before FIRST write. Merely
-- inserting one signed-looking row cannot hide an omitted second bank PI.
CREATE FUNCTION freeholder_controlled_cash_receipts_complete(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; proof_count integer; actual_ids jsonb; actual_cash numeric; actual_fee numeric;
 actual_invoice invoices%ROWTYPE; original_policy invoice_market_policies%ROWTYPE; actual_duty agreement_fee_duties%ROWTYPE;
 original_paid numeric; original_fee numeric; carried_fee numeric; cash_principal numeric; fee_target numeric; receipt_record controlled_cash_application_receipts%ROWTYPE;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Use only the same real immutable application transaction' USING ERRCODE='23514';END IF;
 SELECT count(*),jsonb_agg(receipt_proof.receipt_id ORDER BY receipt_proof.ordinal),sum(receipt_proof.amount_minor),sum(receipt_proof.fee_minor)
 INTO proof_count,actual_ids,actual_cash,actual_fee FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF proof_count NOT BETWEEN 1 AND 5000 OR actual_ids IS DISTINCT FROM admitted_batch.requested_receipt_ids OR actual_cash IS DISTINCT FROM admitted_batch.expected_cash_minor::numeric OR actual_fee IS DISTINCT FROM admitted_batch.expected_fee_minor::numeric
  OR EXISTS(SELECT 1 FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id AND receipt_proof.ordinal<1)
  OR(SELECT max(receipt_proof.ordinal) FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id)<>proof_count THEN
  RAISE EXCEPTION 'The exact complete UUID batch and contiguous receipt/fee prefix must exist before any payment mutation' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 SELECT * INTO original_policy FROM invoice_market_policies WHERE invoice_id=admitted_batch.invoice_id;
 SELECT * INTO actual_duty FROM agreement_fee_duties WHERE invoice_id=admitted_batch.invoice_id;
 -- Original real payments only. New actual links in this batch are accounted
 -- separately by the exact staged delta; they never rewrite original paid cash.
 SELECT coalesce(sum(actual_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0)
 INTO original_paid,original_fee FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
 WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND actual_payment.status='succeeded'
  AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id);
 IF original_policy.invoice_id IS NULL OR original_paid IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric
  OR EXISTS(SELECT 1 FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
   WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id)
    AND(actual_payment.status IN('created','processing') OR actual_payment.status='succeeded' AND(original_route.payment_id IS NULL OR actual_payment.refunded_minor<>0))) THEN
  RAISE EXCEPTION 'Keep complete real prior principal, original fee routes and every pending/refunded attempt; no virtual prefix or missing original fee owner' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_application.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id;
 IF(SELECT coalesce(sum(actual_reservation.amount_minor),0) FROM invoice_credit_applications actual_application JOIN invoice_credit_reservations actual_reservation ON actual_reservation.id=actual_application.reservation_id WHERE actual_application.invoice_id=admitted_batch.invoice_id) IS DISTINCT FROM admitted_batch.invoice_before_credited_minor::numeric
  OR EXISTS(SELECT 1 FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id AND actual_application.fee_evidence_digest IS NULL) THEN
  RAISE EXCEPTION 'Retain every actual original noncash credit and its fee assignment before physical cash application' USING ERRCODE='23514';END IF;
 cash_principal=actual_invoice.total_minor::numeric-admitted_batch.invoice_before_credited_minor::numeric;
 fee_target=greatest(0,original_policy.fee_minor::numeric-carried_fee);
 IF actual_duty.invoice_id IS NOT NULL THEN
  IF actual_duty.total_minor IS DISTINCT FROM actual_invoice.total_minor OR actual_duty.target_fee_minor IS DISTINCT FROM original_policy.fee_minor
   OR actual_duty.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_duty.carried_fee_minor::numeric IS DISTINCT FROM carried_fee OR actual_duty.cash_principal_minor::numeric IS DISTINCT FROM cash_principal THEN
   RAISE EXCEPTION 'Preserve the frozen gross target fee duty and exact carried credit epoch' USING ERRCODE='23514';END IF;
  fee_target=actual_duty.cash_fee_target_minor;
 END IF;
 IF cash_principal<=0 OR fee_target>cash_principal OR original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Restore the exact original cumulative cash commission; never silently reprice historical fee allocations' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.prior_cash_minor::numeric IS DISTINCT FROM original_paid OR receipt_record.prior_allocated_fee_minor::numeric IS DISTINCT FROM original_fee
   OR receipt_record.fee_minor::numeric IS DISTINCT FROM floor(fee_target*(original_paid+receipt_record.amount_minor::numeric)/cash_principal)-original_fee THEN
   RAISE EXCEPTION 'Every later fee plan must bind its exact preceding real receipt prefix and deterministic residual' USING ERRCODE='23514';END IF;
  original_paid=original_paid+receipt_record.amount_minor;original_fee=original_fee+receipt_record.fee_minor;
 END LOOP;
END $$;
--> statement-breakpoint
-- This function captures only a genuine NEW UUID emitted by the existing
-- payments INSERT. It does not allocate a guessed UUID or route money itself.
-- The complete later canonical/deferred-stage validator must qualify before
-- the existing closed route/settlement guards can be extended or activated.
CREATE FUNCTION freeholder_controlled_cash_link_created_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_proof controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE;
 actual_entries jsonb; actual_revision text;
BEGIN
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE payment_idempotency_key=NEW.idempotency_key;
 IF receipt_proof.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=receipt_proof.batch_id;
 PERFORM freeholder_controlled_cash_require_prefix(admitted_batch.resource_id);
 IF admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR NEW.invoice_id IS DISTINCT FROM admitted_batch.invoice_id
  OR NEW.provider IS DISTINCT FROM 'stripe' OR NEW.method IS DISTINCT FROM 'provider_schedule' OR NEW.status IS DISTINCT FROM 'created'
  OR NEW.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR NEW.currency IS DISTINCT FROM receipt_proof.currency OR NEW.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR NEW.refunded_minor<>0 OR NEW.provider_ref IS NOT NULL OR NEW.provider_checkout_ref IS NOT NULL OR NEW.processed_at IS NOT NULL OR NEW.failed_at IS NOT NULL
  OR NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL OR NEW.metadata IS DISTINCT FROM '{}'::jsonb OR NEW.updated_at IS DISTINCT FROM NEW.created_at
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(admitted_batch.before_entries) prior_entry WHERE prior_entry->>'table'='payments' AND prior_entry->>'id'=NEW.id::text) THEN
  RAISE EXCEPTION 'Link only the actual newly generated exact shared created-payment row; no historical/equal-value adoption' USING ERRCODE='23514';END IF;
 -- This checkpoint handles the first actual payment birth. Reusing a fresh
 -- first-write proof after any own link is forbidden; the subsequent staged
 -- validator must prove the precise earlier canonical delta, not clear debt.
 IF receipt_proof.ordinal<>1 OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.batch_id=admitted_batch.id) THEN
  RAISE EXCEPTION 'Require complete exact own-canonical stage proof before a subsequent receipt birth' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',actual_entry.family,'id',actual_entry.identity,'fingerprint',actual_entry.fingerprint,'hashDomain','postgres_row') ORDER BY actual_entry.family,actual_entry.identity),'[]'::jsonb),
  encode(sha256(convert_to(string_agg(actual_entry.family||':'||actual_entry.identity||':'||actual_entry.fingerprint,E'\n' ORDER BY actual_entry.family,actual_entry.identity),'UTF8')),'hex')
 INTO actual_entries,actual_revision FROM freeholder_controlled_cash_parent_entries(admitted_batch.collection_id) actual_entry
 WHERE NOT(actual_entry.family='controlled_cash_application_batches' AND actual_entry.identity=admitted_batch.id::text)
  AND NOT(actual_entry.family='controlled_cash_application_receipts' AND EXISTS(SELECT 1 FROM controlled_cash_application_receipts own_proof WHERE own_proof.batch_id=admitted_batch.id AND own_proof.id::text=actual_entry.identity))
  AND NOT(actual_entry.family='payments' AND actual_entry.identity=NEW.id::text);
 IF actual_entries IS DISTINCT FROM admitted_batch.before_entries OR actual_revision IS DISTINCT FROM admitted_batch.parent_pg_revision THEN
  RAISE EXCEPTION 'The first actual payment birth must be the ONLY canonical delta from the complete immutable preimage' USING ERRCODE='23514';END IF;
 INSERT INTO controlled_cash_application_links(receipt_id,receipt_proof_id,batch_id,payment_id,created_payment_fingerprint)
 VALUES(receipt_proof.receipt_id,receipt_proof.id,admitted_batch.id,NEW.id,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 -- The genuine newborn link now identifies this exact own created row. Only
 -- then may prior-principal accounting separate it from foreign pending debt;
 -- a failed whole-batch/prefix check rolls back the INSERT and its link together.
 PERFORM freeholder_controlled_cash_receipts_complete(admitted_batch.id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_payment_birth AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_link_created_payment();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_payment payments%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE; admitted_batch controlled_cash_application_batches%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Actual receipt/payment links are immutable and originate only at the real payment INSERT boundary' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE id=NEW.receipt_proof_id;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF actual_payment.id IS NULL OR receipt_proof.id IS NULL OR admitted_batch.id IS NULL OR receipt_proof.receipt_id IS DISTINCT FROM NEW.receipt_id OR receipt_proof.batch_id IS DISTINCT FROM NEW.batch_id
  OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_payment.status IS DISTINCT FROM 'created'
  OR actual_payment.invoice_id IS DISTINCT FROM admitted_batch.invoice_id OR actual_payment.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR actual_payment.currency IS DISTINCT FROM receipt_proof.currency
  OR actual_payment.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR actual_payment.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR encode(sha256(convert_to(to_jsonb(actual_payment)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.created_payment_fingerprint THEN
  RAISE EXCEPTION 'The lifetime unique link must prove this actual newly created payment and exact immutable receipt admission' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_links_immutable BEFORE INSERT OR UPDATE OR DELETE ON controlled_cash_application_links FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_link();

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C1.08/C9.33: OWNED UNAPPLIED continuation after the exact frozen
-- controlled-cash-application-protocol84.fragment.sql. No current SQL changes.
-- Exact actual shared canonical deltas, never a cached or public allowed flag.
CREATE FUNCTION freeholder_controlled_cash_plan_status(target_batch_uuid uuid,through_ordinal integer) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_plan payment_plans%ROWTYPE; original_plan jsonb; delta numeric; last_settled_at timestamptz;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO actual_plan FROM payment_plans WHERE invoice_id=admitted_batch.invoice_id;
 IF actual_plan.id IS NULL THEN RETURN null;END IF;
 SELECT original_row->'fields' INTO original_plan FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plans' AND original_row->>'id'=actual_plan.id::text;
 IF original_plan IS NULL THEN RAISE EXCEPTION 'A later plan cannot be adopted as an original application before-image' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO delta FROM payment_allocations actual_allocation
 JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
 JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.ordinal<=through_ordinal
 JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id AND actual_installment.plan_id=actual_plan.id;
 IF delta=0 THEN RETURN original_plan->>'status';END IF;
 IF(original_plan->>'paid_minor')::numeric+delta=actual_plan.principal_minor::numeric THEN RETURN 'completed';END IF;
 SELECT receipt_proof.processed_at INTO last_settled_at FROM controlled_cash_application_receipts receipt_proof
 JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=admitted_batch.id
 JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id AND actual_payment.status='succeeded'
 WHERE receipt_proof.ordinal<=through_ordinal ORDER BY receipt_proof.ordinal DESC LIMIT 1;
 IF last_settled_at IS NULL THEN RAISE EXCEPTION 'A planned allocation cannot supply a real settled payment date' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM payment_plan_installments actual_installment
  JOIN LATERAL(SELECT original_row->'fields' AS fields FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=actual_installment.id::text) original_installment ON true
  WHERE actual_installment.plan_id=actual_plan.id AND actual_installment.due_at<last_settled_at
   AND(original_installment.fields->>'paid_minor')::numeric+coalesce((SELECT sum(actual_allocation.amount_minor) FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
    JOIN controlled_cash_application_receipts receipt_proof ON receipt_proof.id=actual_link.receipt_proof_id AND receipt_proof.ordinal<=through_ordinal
    WHERE actual_allocation.installment_id=actual_installment.id),0)<actual_installment.amount_minor::numeric) THEN RETURN 'defaulted';END IF;
 RETURN 'active';
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_before_settlement(target_payment_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 payment_record payments%ROWTYPE; stage_record jsonb; prior_cash numeric; prior_fee numeric;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 IF link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR payment_record.id IS NULL OR payment_record.status NOT IN('created','processing') THEN
  RAISE EXCEPTION 'Only a genuine newly linked original receipt can cross the current settlement boundary' USING ERRCODE='23514';END IF;
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,payment_record.id);
 IF(SELECT count(*) FROM merchant_agreement_payment_routes original_route WHERE original_route.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM merchant_payment_observations original_observation WHERE original_observation.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM agreement_fee_cash_assignments original_fee WHERE original_fee.payment_id=payment_record.id)<>(CASE WHEN EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id) THEN 1 ELSE 0 END)
  OR(SELECT count(*) FROM money_state_events created_event WHERE created_event.subject_type='payment' AND created_event.subject_id=payment_record.id AND created_event.from_state IS NULL AND created_event.to_state='created')<>1
  OR(SELECT count(*) FROM controlled_cash_application_links earlier_link JOIN controlled_cash_application_receipts earlier_proof ON earlier_proof.id=earlier_link.receipt_proof_id AND earlier_proof.ordinal<receipt_record.ordinal
   JOIN payments earlier_payment ON earlier_payment.id=earlier_link.payment_id AND earlier_payment.status='succeeded' WHERE earlier_link.batch_id=batch_record.id)<>receipt_record.ordinal-1 THEN
  RAISE EXCEPTION 'Settle only after the actual current route, exact returned-bank observation, fee promise, creation history and every earlier real receipt are complete' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(original_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0) INTO prior_cash,prior_fee FROM payments original_payment
  JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=original_payment.id WHERE original_payment.invoice_id=batch_record.invoice_id AND original_payment.status='succeeded';
 IF prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric OR prior_fee IS DISTINCT FROM receipt_record.prior_allocated_fee_minor::numeric THEN
  RAISE EXCEPTION 'A later frozen fee plan is usable only when its exact earlier cash/fee allocations ACTUALLY exist; no virtual paid prefix' USING ERRCODE='23514';END IF;
 RETURN stage_record;
END $$;
--> statement-breakpoint
-- Replace ONLY our own frozen first-birth function. Every previous immutable
-- admission/actual UUID rule remains; genuine exact staged prefix proof now
-- permits the next receipt instead of its explicit incomplete-first-leaf refusal.
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_link_created_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
BEGIN
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE payment_idempotency_key=NEW.idempotency_key;
 IF receipt_record.id IS NULL THEN
  IF NEW.idempotency_key LIKE 'controlled-receipt:%' THEN RAISE EXCEPTION 'The controlled receipt namespace requires its actual immutable bank/parent batch admission' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=receipt_record.batch_id;
 PERFORM freeholder_controlled_cash_require_prefix(batch_record.resource_id);
 PERFORM freeholder_controlled_cash_validate_birth(batch_record.id,NEW.id);
 INSERT INTO controlled_cash_application_links(receipt_id,receipt_proof_id,batch_id,payment_id,created_payment_fingerprint)
 VALUES(receipt_record.receipt_id,receipt_record.id,batch_record.id,NEW.id,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 -- The real newborn link lets exact normalization distinguish this one created
 -- row from every foreign pending caller. A refusal rolls both rows back.
 PERFORM freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,NEW.id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_guard_payment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=OLD.id;
 IF link_record.receipt_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 -- Later genuine refunds/disputes on committed original payments remain under
 -- their existing strict default guards. No old batch is a new application.
 IF batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RETURN NEW;END IF;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_record.receipt_id;
 IF(to_jsonb(NEW)-'status'-'provider_ref'-'processed_at'-'failure_code'-'failure_message'-'updated_at') IS DISTINCT FROM(to_jsonb(OLD)-'status'-'provider_ref'-'processed_at'-'failure_code'-'failure_message'-'updated_at')
  OR NEW.updated_at IS DISTINCT FROM now() OR NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL
  OR(OLD.status='created' AND NEW.status='processing' AND NEW.processed_at IS NULL AND(NEW.provider_ref IS NULL OR NEW.provider_ref=original_receipt.provider_payment_intent_ref)
   OR OLD.status IN('created','processing') AND NEW.status='succeeded' AND NEW.provider_ref=original_receipt.provider_payment_intent_ref AND NEW.processed_at=receipt_record.processed_at) IS NOT TRUE THEN
  RAISE EXCEPTION 'Only the exact actual shared created/processing-to-succeeded money delta may cross this immutable admission; no failure/rebind/refund/access mutation' USING ERRCODE='23514';END IF;
 IF NEW.status='succeeded' THEN PERFORM freeholder_controlled_cash_before_settlement(OLD.id);
 ELSE PERFORM freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,OLD.id);END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER controlled_cash_payment_transition BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_guard_payment_transition();
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_application_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_uuid uuid; batch_record controlled_cash_application_batches%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='controlled_cash_application_batches' THEN batch_uuid=NEW.id;
 ELSIF TG_TABLE_NAME IN('controlled_cash_application_receipts','controlled_cash_application_links') THEN batch_uuid=NEW.batch_id;
 ELSIF TG_TABLE_NAME='payments' THEN SELECT actual_link.batch_id INTO batch_uuid FROM controlled_cash_application_links actual_link JOIN controlled_cash_application_batches actual_batch ON actual_batch.id=actual_link.batch_id AND actual_batch.admission_transaction_id=txid_current()::text WHERE actual_link.payment_id=NEW.id;
 ELSIF TG_TABLE_NAME='invoices' THEN
  FOR batch_record IN SELECT actual_batch.* FROM controlled_cash_application_batches actual_batch WHERE actual_batch.invoice_id=NEW.id AND actual_batch.admission_transaction_id=txid_current()::text LOOP
   PERFORM freeholder_controlled_cash_stage(batch_record.id,null,null);
  END LOOP;
  RETURN null;
 END IF;
 IF batch_uuid IS NOT NULL THEN PERFORM freeholder_controlled_cash_stage(batch_uuid,null,null);END IF;
 RETURN null;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_batch_complete AFTER INSERT ON controlled_cash_application_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_receipt_complete AFTER INSERT ON controlled_cash_application_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_link_complete AFTER INSERT ON controlled_cash_application_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_payment_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER controlled_cash_invoice_complete AFTER UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_complete();
--> statement-breakpoint
-- A stage is evidence of the exact actual canonical prefix, not bank/parent
-- authorization. A linked CURRENT created row may be observed between shared
-- service statements; only the separate strict settlement boundary below can
-- change its money status. NULL receipt means strict COMPLETE batch proof.
CREATE FUNCTION freeholder_controlled_cash_stage(target_batch_uuid uuid,target_receipt_uuid uuid DEFAULT null,target_payment_uuid uuid DEFAULT null) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; target_proof controlled_cash_application_receipts%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; payment_record payments%ROWTYPE; invoice_record invoices%ROWTYPE; bank_record record; normalized_parent jsonb; final_snapshot jsonb;
 count_links integer; count_receipts integer; route_count integer; fee_count integer; observation_count integer; created_count integer; processing_count integer; succeeded_count integer; invoice_event_count integer; plan_event_count integer;
 prior_cash numeric; prior_count integer; settled_cash numeric=0; settled_fee numeric=0; settled_ids jsonb='[]'::jsonb; bank_revisions jsonb='[]'::jsonb;
 expected_from text; expected_to text; plan_from text; plan_to text; has_duty boolean;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO invoice_record FROM invoices WHERE id=batch_record.invoice_id;
 IF batch_record.id IS NULL OR invoice_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Only this original real transaction can prove its own canonical stage' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL THEN
  SELECT * INTO target_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=target_receipt_uuid;
  IF target_proof.id IS NULL THEN RAISE EXCEPTION 'The target stage must be an exact actual admitted receipt UUID' USING ERRCODE='23514';END IF;
 ELSE IF target_payment_uuid IS NOT NULL THEN RAISE EXCEPTION 'A canonical payment cannot supply an unbound batch stage' USING ERRCODE='23514';END IF;END IF;
 normalized_parent=freeholder_controlled_cash_normalized_parent(batch_record.id);
 SELECT count(*) INTO count_links FROM controlled_cash_application_links WHERE batch_id=batch_record.id;
 SELECT count(*) INTO count_receipts FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id;
 has_duty=EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id);
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=batch_record.id ORDER BY actual_proof.ordinal LOOP
  SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,receipt_record.receipt_id);
  IF bank_record.actual_inspection_id IS NULL OR bank_record.actual_inspection_id IS DISTINCT FROM receipt_record.bank_inspection_id OR bank_record.actual_observation_id IS DISTINCT FROM receipt_record.bank_observation_id
   OR bank_record.immutable_bank_fingerprint IS DISTINCT FROM receipt_record.immutable_bank_revision
   OR count_links=0 AND bank_record.bank_fingerprint IS DISTINCT FROM receipt_record.namespace_revision
   OR NOT freeholder_controlled_bank_unreturned(bank_record.original_expectation||jsonb_build_object('feeMinor',receipt_record.fee_minor),bank_record.current_evidence) THEN
   RAISE EXCEPTION 'Require every exact immutable returned source bank proof plus FULL current parent normalization; never cache scalar authority across a changed namespace' USING ERRCODE='23514';END IF;
  bank_revisions=bank_revisions||jsonb_build_array(jsonb_build_object('receiptId',receipt_record.receipt_id,'immutableBankRevision',bank_record.immutable_bank_fingerprint,'currentNamespaceRevision',bank_record.bank_fingerprint));
  SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_record.id AND receipt_id=receipt_record.receipt_id;
  IF link_record.receipt_id IS NULL THEN
   IF target_receipt_uuid IS NULL OR receipt_record.ordinal<target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND target_payment_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A missing actual earlier payment cannot be supplied by planned receipt order or a completed-looking batch' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
  IF target_receipt_uuid IS NOT NULL AND(receipt_record.ordinal>target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND link_record.payment_id IS DISTINCT FROM target_payment_uuid)
   OR payment_record.status<>'succeeded' AND(receipt_record.receipt_id IS DISTINCT FROM target_receipt_uuid OR link_record.payment_id IS DISTINCT FROM target_payment_uuid) THEN
   RAISE EXCEPTION 'Only the exact current genuine payment may be in progress; every earlier receipt must already be real settled canonical cash' USING ERRCODE='23514';END IF;
  PERFORM freeholder_controlled_cash_normalized_payment(payment_record.id);
  SELECT count(*) INTO route_count FROM merchant_agreement_payment_routes WHERE payment_id=payment_record.id;
  SELECT count(*) INTO fee_count FROM agreement_fee_cash_assignments WHERE payment_id=payment_record.id;
  SELECT count(*) INTO observation_count FROM merchant_payment_observations WHERE payment_id=payment_record.id;
  SELECT count(*) FILTER(WHERE actual_event.to_state='created'),count(*) FILTER(WHERE actual_event.to_state='processing'),count(*) FILTER(WHERE actual_event.to_state='succeeded')
   INTO created_count,processing_count,succeeded_count FROM money_state_events actual_event WHERE actual_event.subject_type='payment' AND actual_event.subject_id=payment_record.id;
  IF route_count>1 OR fee_count>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count>1 OR created_count>1 OR processing_count>1 OR succeeded_count>1
   OR payment_record.status='created' AND(processing_count<>0 OR succeeded_count<>0) OR payment_record.status='processing' AND(created_count<>1 OR processing_count<>1 OR succeeded_count<>0)
   OR payment_record.status='succeeded' AND(route_count<>1 OR fee_count<>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count<>1 OR created_count<>1 OR succeeded_count<>1) THEN
   RAISE EXCEPTION 'The exact real shared payment/route/fee/observation/event prefix must be complete at settlement and unique at every stage' USING ERRCODE='23514';END IF;
  IF route_count=1 THEN PERFORM freeholder_controlled_cash_validate_route(payment_record.id);END IF;
  SELECT count(*) INTO invoice_event_count FROM money_state_events actual_event WHERE actual_event.subject_type='invoice' AND actual_event.subject_id=batch_record.invoice_id AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  SELECT count(*) INTO plan_event_count FROM money_state_events actual_event JOIN payment_plans actual_plan ON actual_plan.id=actual_event.subject_id AND actual_plan.invoice_id=batch_record.invoice_id WHERE actual_event.subject_type='payment_plan' AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  IF payment_record.status='succeeded' THEN
   SELECT count(*),batch_record.invoice_before_paid_minor::numeric+coalesce(sum(prior_payment.amount_minor),0) INTO prior_count,prior_cash FROM controlled_cash_application_links prior_link
    JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=prior_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal
    JOIN payments prior_payment ON prior_payment.id=prior_link.payment_id AND prior_payment.status='succeeded' WHERE prior_link.batch_id=batch_record.id;
   IF prior_count<>receipt_record.ordinal-1 OR prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric THEN RAISE EXCEPTION 'Every cumulative plan prefix must already exist as exact actual succeeded receipts before later use' USING ERRCODE='23514';END IF;
   expected_from=CASE WHEN prior_count=0 THEN batch_record.invoice_before_status WHEN prior_cash+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   expected_to=CASE WHEN prior_cash+receipt_record.amount_minor+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   plan_from=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal-1);plan_to=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal);
   IF invoice_event_count<>(CASE WHEN expected_from IS DISTINCT FROM expected_to THEN 1 ELSE 0 END) OR plan_event_count<>(CASE WHEN plan_from IS DISTINCT FROM plan_to THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Preserve the exact shared status-change event set; a sum alone cannot supply canonical settlement history' USING ERRCODE='23514';END IF;
   settled_cash=settled_cash+receipt_record.amount_minor;settled_fee=settled_fee+receipt_record.fee_minor;settled_ids=settled_ids||jsonb_build_array(receipt_record.receipt_id);
  ELSIF invoice_event_count<>0 OR plan_event_count<>0 THEN RAISE EXCEPTION 'An unfinished receipt cannot fabricate an invoice or plan paid effect' USING ERRCODE='23514';END IF;
 END LOOP;
 IF target_receipt_uuid IS NULL AND(count_links<>count_receipts OR jsonb_array_length(settled_ids)<>count_receipts OR settled_cash IS DISTINCT FROM batch_record.expected_cash_minor::numeric OR settled_fee IS DISTINCT FROM batch_record.expected_fee_minor::numeric) THEN
  RAISE EXCEPTION 'The whole immutable real receipt batch must conserve exact cash/fee/credit and settle atomically; partial batch refusal rolls back every canonical write' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.receipt_id=target_receipt_uuid)
  AND count_links<>target_proof.ordinal-1 THEN RAISE EXCEPTION 'The next birth must be the exact next real receipt after a complete actual settled prefix' USING ERRCODE='23514';END IF;
 final_snapshot=freeholder_controlled_cash_parent_snapshot(batch_record.collection_id);
 IF final_snapshot->'entries' IS DISTINCT FROM normalized_parent->'currentEntries' OR final_snapshot->>'revision' IS DISTINCT FROM normalized_parent->>'currentParentRevision' THEN
  RAISE EXCEPTION 'Current external raw/financial/source evidence changed during stage verification; preserve it and refuse this money mutation' USING ERRCODE='23514';END IF;
 RETURN normalized_parent||jsonb_build_object('receiptId',target_receipt_uuid,'paymentId',target_payment_uuid,'settledReceiptIds',settled_ids,'bankRevisions',bank_revisions,'complete',target_receipt_uuid IS NULL);
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_birth(target_batch_uuid uuid,target_payment_uuid uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; payment_record payments%ROWTYPE;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE batch_id=target_batch_uuid AND payment_idempotency_key=payment_record.idempotency_key;
 IF batch_record.id IS NULL OR receipt_record.id IS NULL OR payment_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.status IS DISTINCT FROM 'created' OR payment_record.amount_minor IS DISTINCT FROM receipt_record.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_record.currency
  OR payment_record.request_hash IS DISTINCT FROM receipt_record.payment_request_hash OR payment_record.metadata IS DISTINCT FROM '{}'::jsonb OR payment_record.refunded_minor<>0
  OR payment_record.provider_ref IS NOT NULL OR payment_record.provider_checkout_ref IS NOT NULL OR payment_record.processed_at IS NOT NULL OR payment_record.failed_at IS NOT NULL
  OR payment_record.failure_code IS NOT NULL OR payment_record.failure_message IS NOT NULL OR payment_record.created_at IS DISTINCT FROM now() OR payment_record.updated_at IS DISTINCT FROM payment_record.created_at
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.payment_id=payment_record.id OR actual_link.receipt_id=receipt_record.receipt_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(batch_record.before_entries) original_entry WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_record.id::text)
  OR NOT EXISTS(SELECT 1 FROM payments actual_payment WHERE actual_payment.id=payment_record.id AND actual_payment.xmin::text::numeric=mod(txid_current()::numeric,4294967296)) THEN
  RAISE EXCEPTION 'Require the actual same-transaction generated created-payment UUID and exact original receipt request; never adopt a planned or historical payment' USING ERRCODE='23514';END IF;
 RETURN receipt_record.receipt_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_require_current_locks(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; current_scope jsonb; required_key text;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF batch_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Canonical lock evidence belongs to this genuine original transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_prefix(batch_record.resource_id);
 current_scope=freeholder_controlled_cash_scope(batch_record.collection_id);
 FOR required_key IN
  SELECT 'payment:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'payments')) actual_id
   WHERE NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=batch_record.id AND own_link.payment_id=actual_id)
  UNION SELECT 'invoice:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'invoices')) actual_id
  UNION SELECT 'credit-note:'||actual_id::text FROM unnest(freeholder_controlled_cash_scope_ids(current_scope,'notes')) actual_id
  UNION SELECT 'subscription-cash:'||(actual_namespace->>'platform')||':'||coalesce(actual_namespace->>'account','')||':'||(actual_namespace->>'intent') FROM jsonb_array_elements(current_scope->'namespaces') actual_namespace
 LOOP
  IF required_key IS NULL OR NOT EXISTS(SELECT 1 FROM pg_locks actual_lock WHERE actual_lock.pid=pg_backend_pid() AND actual_lock.locktype='advisory' AND actual_lock.granted
   AND actual_lock.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND actual_lock.mode='ExclusiveLock' AND actual_lock.objsubid=1
   AND actual_lock.classid::bigint=(CASE WHEN hashtext(required_key)<0 THEN 4294967295::bigint ELSE 0::bigint END)
   AND actual_lock.objid::bigint=(hashtext(required_key)::bigint & 4294967295::bigint)) THEN
   RAISE EXCEPTION 'The full current original canonical/credit/cash namespace locks must ALREADY be held; no late reverse acquisition or caller flag' USING ERRCODE='23514';END IF;
 END LOOP;
END $$;
--> statement-breakpoint
-- Full CURRENT remains physically intact. This separate comparison reconstructs
-- only the explicitly verified actual own canonical deltas. Every other newly
-- discovered row/changed before-row, including an external raw callback, fails.
CREATE FUNCTION freeholder_controlled_cash_normalized_parent(target_batch_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; current_snapshot jsonb; original_entry jsonb; current_entry jsonb; normalized_entries jsonb='[]'::jsonb; plan_entries jsonb;
 normalized_fingerprint text; normalized_revision text; linked_payment_uuid uuid; own_receipt_uuid uuid; original_fee_record agreement_fee_cash_assignments%ROWTYPE;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF batch_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'An immutable original current transaction is required for canonical normalization' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_require_current_locks(batch_record.id);
 PERFORM freeholder_controlled_cash_receipts_complete(batch_record.id);
 current_snapshot=freeholder_controlled_cash_parent_snapshot(batch_record.collection_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',normalized_plan.family,'id',normalized_plan.identity,'fingerprint',normalized_plan.fingerprint,'hashDomain','postgres_row')),'[]'::jsonb)
 INTO plan_entries FROM freeholder_controlled_cash_normalized_plans(batch_record.id) normalized_plan;
 FOR original_entry IN SELECT value FROM jsonb_array_elements(batch_record.before_entries) WITH ORDINALITY original_rows(value,ordinal) ORDER BY ordinal LOOP
  SELECT value INTO current_entry FROM jsonb_array_elements(current_snapshot->'entries') WHERE value->>'table'=original_entry->>'table' AND value->>'id'=original_entry->>'id';
  IF current_entry IS NULL THEN RAISE EXCEPTION 'A retained original physical financial row is missing; application cannot erase its debt' USING ERRCODE='23514';END IF;
  normalized_fingerprint=current_entry->>'fingerprint';
  IF original_entry->>'table'='invoices' AND original_entry->>'id'=batch_record.invoice_id::text THEN normalized_fingerprint=freeholder_controlled_cash_normalized_invoice(batch_record.id);
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(plan_entries) normalized_plan WHERE normalized_plan->>'table'=original_entry->>'table' AND normalized_plan->>'id'=original_entry->>'id') THEN
   SELECT normalized_plan->>'fingerprint' INTO normalized_fingerprint FROM jsonb_array_elements(plan_entries) normalized_plan WHERE normalized_plan->>'table'=original_entry->>'table' AND normalized_plan->>'id'=original_entry->>'id';
  END IF;
  IF normalized_fingerprint IS DISTINCT FROM original_entry->>'fingerprint' THEN RAISE EXCEPTION 'An original source/financial/privacy/raw row changed outside the exact actual own-canonical delta' USING ERRCODE='23514';END IF;
  normalized_entries=normalized_entries||jsonb_build_array(jsonb_build_object('table',original_entry->>'table','id',original_entry->>'id','fingerprint',normalized_fingerprint,'hashDomain','postgres_row'));
 END LOOP;
 FOR current_entry IN SELECT current_rows.value FROM jsonb_array_elements(current_snapshot->'entries') current_rows(value) WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(batch_record.before_entries) original_rows(value) WHERE original_rows.value->>'table'=current_rows.value->>'table' AND original_rows.value->>'id'=current_rows.value->>'id') LOOP
  CASE current_entry->>'table'
  WHEN 'controlled_cash_application_batches' THEN
   IF current_entry->>'id' IS DISTINCT FROM batch_record.id::text THEN RAISE EXCEPTION 'Another batch is not an own application effect' USING ERRCODE='23514';END IF;
  WHEN 'controlled_cash_application_receipts' THEN
   IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=batch_record.id AND actual_proof.id::text=current_entry->>'id') THEN RAISE EXCEPTION 'Another receipt admission remains current debt' USING ERRCODE='23514';END IF;
  WHEN 'controlled_cash_application_links' THEN
   IF NOT EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.receipt_id::text=current_entry->>'id' AND actual_link.created_at=now()) THEN RAISE EXCEPTION 'Another lifetime receipt link is not this actual canonical delta' USING ERRCODE='23514';END IF;
  WHEN 'payments' THEN
   SELECT actual_link.payment_id INTO linked_payment_uuid FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.payment_id::text=current_entry->>'id';
   IF linked_payment_uuid IS NULL THEN RAISE EXCEPTION 'An unowned new payment remains current financial debt' USING ERRCODE='23514';END IF;
   PERFORM freeholder_controlled_cash_normalized_payment(linked_payment_uuid);
  WHEN 'merchant_agreement_payment_routes' THEN
   SELECT actual_link.payment_id INTO linked_payment_uuid FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.payment_id::text=current_entry->>'id';
   IF linked_payment_uuid IS NULL THEN RAISE EXCEPTION 'A foreign new route cannot be removed as an own effect' USING ERRCODE='23514';END IF;PERFORM freeholder_controlled_cash_validate_route(linked_payment_uuid);
  WHEN 'merchant_payment_observations' THEN
   IF NOT EXISTS(SELECT 1 FROM merchant_payment_observations actual_observation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_observation.payment_id AND actual_link.batch_id=batch_record.id WHERE actual_observation.id::text=current_entry->>'id') THEN RAISE EXCEPTION 'A new unowned/late raw observation remains current debt' USING ERRCODE='23514';END IF;
   PERFORM freeholder_controlled_cash_validate_observation((current_entry->>'id')::uuid);
  WHEN 'agreement_fee_cash_assignments' THEN
   SELECT actual_fee.* INTO original_fee_record FROM agreement_fee_cash_assignments actual_fee JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_fee.payment_id AND actual_link.batch_id=batch_record.id
    JOIN controlled_cash_application_receipts actual_proof ON actual_proof.id=actual_link.receipt_proof_id
    WHERE actual_fee.payment_id::text=current_entry->>'id' AND actual_fee.invoice_id=batch_record.invoice_id AND actual_fee.amount_minor=actual_proof.amount_minor AND actual_fee.fee_obligation_minor=actual_proof.fee_minor AND actual_fee.origin='provider' AND actual_fee.created_at=now();
   IF original_fee_record.payment_id IS NULL OR original_fee_record.original_evidence_digest IS DISTINCT FROM freeholder_controlled_cash_fee_evidence(original_fee_record.payment_id) THEN
    RAISE EXCEPTION 'Every new actual fee assignment must preserve its exact original commercial owner/body and current receipt allocation; no invented collected fee' USING ERRCODE='23514';END IF;
  WHEN 'payment_allocations' THEN
   IF NOT EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=batch_record.id
    JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id AND actual_plan.invoice_id=batch_record.invoice_id
    WHERE actual_allocation.id::text=current_entry->>'id' AND actual_allocation.created_at=now()) THEN RAISE EXCEPTION 'Only independently proved actual original FIFO allocation rows may be own effects' USING ERRCODE='23514';END IF;
  WHEN 'money_state_events' THEN PERFORM freeholder_controlled_cash_validate_state_event((current_entry->>'id')::uuid);
  ELSE RAISE EXCEPTION 'Every other new raw/financial/privacy/caller row stays effective; no marker, reason filter or later zero can clear it' USING ERRCODE='23514';
  END CASE;
 END LOOP;
 IF normalized_entries IS DISTINCT FROM batch_record.before_entries THEN RAISE EXCEPTION 'Reconstruction must preserve the complete original table/identity/hash set without omissions' USING ERRCODE='23514';END IF;
 SELECT encode(sha256(convert_to(string_agg((entry->>'table')||':'||(entry->>'id')||':'||(entry->>'fingerprint'),E'\n' ORDER BY entry->>'table',entry->>'id'),'UTF8')),'hex') INTO normalized_revision FROM jsonb_array_elements(normalized_entries) entry;
 IF normalized_revision IS DISTINCT FROM batch_record.parent_pg_revision THEN RAISE EXCEPTION 'The normalized PG parent preimage must exactly match its own immutable PG domain' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('batchId',batch_record.id,'collectionId',batch_record.collection_id,'normalizedParentRevision',normalized_revision,'currentParentRevision',current_snapshot->>'revision','currentEntries',current_snapshot->'entries','physicalRowCount',current_snapshot->'physicalRowCount');
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_state_event(target_event_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE event_record money_state_events%ROWTYPE; link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 payment_record payments%ROWTYPE; invoice_record invoices%ROWTYPE; plan_record payment_plans%ROWTYPE; expected_from text; expected_to text; prior_cash numeric; prior_count integer;
BEGIN
 SELECT * INTO event_record FROM money_state_events WHERE id=target_event_uuid;
 IF event_record.subject_type='payment' THEN SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=event_record.subject_id;
 ELSE SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id::text=event_record.metadata->>'paymentId';END IF;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 SELECT * INTO invoice_record FROM invoices WHERE id=batch_record.invoice_id;
 IF event_record.id IS NULL OR link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR event_record.actor IS DISTINCT FROM 'system' THEN
  RAISE EXCEPTION 'Only a genuine system transition of an actual newly linked original receipt payment is an own state event' USING ERRCODE='23514';END IF;
 IF event_record.subject_type='payment' THEN
  IF event_record.subject_id IS DISTINCT FROM payment_record.id OR event_record.metadata IS DISTINCT FROM '{}'::jsonb OR event_record.reason IS NOT NULL OR event_record.occurred_at IS DISTINCT FROM now()
   OR(event_record.from_state IS NULL AND event_record.to_state='created'
    OR event_record.from_state='created' AND event_record.to_state='processing' AND payment_record.status IN('processing','succeeded')
    OR event_record.to_state='succeeded' AND payment_record.status='succeeded' AND event_record.from_state=(CASE WHEN EXISTS(SELECT 1 FROM money_state_events processing_event WHERE processing_event.subject_type='payment' AND processing_event.subject_id=payment_record.id AND processing_event.from_state='created' AND processing_event.to_state='processing') THEN 'processing' ELSE 'created' END)) IS NOT TRUE THEN
   RAISE EXCEPTION 'Preserve the exact optional created/processing/succeeded shared event chain and original system metadata' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF event_record.metadata IS DISTINCT FROM jsonb_build_object('paymentId',payment_record.id,'amountMinor',payment_record.amount_minor) OR payment_record.status IS DISTINCT FROM 'succeeded' THEN
  RAISE EXCEPTION 'A planned receipt cannot supply a real invoice/plan settlement event or fabricated payment metadata' USING ERRCODE='23514';END IF;
 IF event_record.subject_type='invoice' THEN
  SELECT count(*),batch_record.invoice_before_paid_minor::numeric+coalesce(sum(prior_payment.amount_minor),0) INTO prior_count,prior_cash FROM controlled_cash_application_links prior_link
   JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=prior_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal
   JOIN payments prior_payment ON prior_payment.id=prior_link.payment_id AND prior_payment.status='succeeded' WHERE prior_link.batch_id=batch_record.id;
  expected_from=CASE WHEN prior_count=0 THEN batch_record.invoice_before_status WHEN prior_cash+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
  expected_to=CASE WHEN prior_cash+receipt_record.amount_minor+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
  IF event_record.subject_id IS DISTINCT FROM batch_record.invoice_id OR event_record.reason IS DISTINCT FROM 'payment_settled' OR event_record.occurred_at IS DISTINCT FROM now()
   OR expected_from=expected_to OR event_record.from_state IS DISTINCT FROM expected_from OR event_record.to_state IS DISTINCT FROM expected_to THEN
   RAISE EXCEPTION 'Only the actual receipt ordinal and prior canonical cash/credit derive an invoice status transition' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 IF event_record.subject_type='payment_plan' THEN
  SELECT * INTO plan_record FROM payment_plans WHERE invoice_id=batch_record.invoice_id;
  expected_from=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal-1);expected_to=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal);
  IF plan_record.id IS NULL OR event_record.subject_id IS DISTINCT FROM plan_record.id OR event_record.reason IS DISTINCT FROM 'payment_allocated' OR event_record.occurred_at IS DISTINCT FROM receipt_record.processed_at
   OR expected_from=expected_to OR event_record.from_state IS DISTINCT FROM expected_from OR event_record.to_state IS DISTINCT FROM expected_to THEN
   RAISE EXCEPTION 'Retain only an actual original FIFO plan status change at its genuine bank observation settlement date' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 RAISE EXCEPTION 'Unrelated financial state events remain current parent debt; never erase them as own application effects' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
-- The exact canonical fee body below contains only this fixed ASCII-keyed
-- commercial shape, ASCII identifiers/enums and safe integers. This is the
-- explicitly named JS-canonical digest domain, NEVER a PG full-row hash.
CREATE FUNCTION freeholder_controlled_cash_ascii_canonical(actual_value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(actual_value)
 WHEN 'object' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(actual_value) actual_key WHERE actual_key !~ '^[a-z][A-Za-z0-9]*$')
   OR(SELECT count(*)<>count(DISTINCT lower(actual_key)) FROM jsonb_object_keys(actual_value) actual_key) THEN RAISE EXCEPTION 'Unsupported canonical commercial body key' USING ERRCODE='23514';END IF;
  -- The fixed source keys have distinct case-folded identities. JS localeCompare
  -- orders originalChargeReceiptId before originKind; raw byte/C order does NOT.
  -- Explicit folded ASCII order matches that known commercial shape, refusing
  -- unsupported case-only key collisions rather than guessing a collation.
  SELECT '{'||coalesce(string_agg(to_jsonb(actual_key)::text||':'||freeholder_controlled_cash_ascii_canonical(actual_item),',' ORDER BY lower(actual_key) COLLATE "C"),'')||'}' INTO result FROM jsonb_each(actual_value) entry(actual_key,actual_item);RETURN result;
 WHEN 'array' THEN
  SELECT '['||coalesce(string_agg(freeholder_controlled_cash_ascii_canonical(actual_item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(actual_value) WITH ORDINALITY entry(actual_item,ordinal);RETURN result;
 WHEN 'number' THEN
  IF actual_value::text !~ '^[0-9]+$' OR(actual_value::text)::numeric>9007199254740991 THEN RAISE EXCEPTION 'Unsupported noninteger commercial hash amount' USING ERRCODE='23514';END IF;RETURN actual_value::text;
 WHEN 'string' THEN
  IF actual_value#>>'{}' !~ '^[ -~]*$' THEN RAISE EXCEPTION 'Unsupported non-ASCII original commercial evidence field' USING ERRCODE='23514';END IF;RETURN actual_value::text;
 WHEN 'boolean' THEN RETURN actual_value::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE RAISE EXCEPTION 'Missing actual canonical commercial body' USING ERRCODE='23514';
 END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_fee_evidence(target_payment_uuid uuid) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE payment_record payments%ROWTYPE; route_record merchant_agreement_payment_routes%ROWTYPE; duty_record agreement_fee_duties%ROWTYPE; commercial_body jsonb;
BEGIN
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=target_payment_uuid;
 SELECT * INTO duty_record FROM agreement_fee_duties WHERE invoice_id=payment_record.invoice_id;
 IF payment_record.id IS NULL OR route_record.payment_id IS NULL OR duty_record.invoice_id IS NULL THEN RAISE EXCEPTION 'Require this actual provider payment, original route and gross fee duty before deriving its commercial evidence body' USING ERRCODE='23514';END IF;
 commercial_body=jsonb_build_object('originalOwnerDigest',duty_record.original_owner_digest,'payment',jsonb_build_object(
  'id',payment_record.id,'invoiceId',payment_record.invoice_id,'provider',payment_record.provider,'method',payment_record.method,'currency',payment_record.currency,'amountMinor',payment_record.amount_minor,'requestHash',payment_record.request_hash,
  'createdAt',to_char(payment_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'record',null,'route',jsonb_build_object(
  'paymentId',route_record.payment_id,'subscriptionId',route_record.subscription_id,'agreementRoutingVersion',route_record.agreement_routing_version,'collectionKind',route_record.collection_kind,
  'providerPlatformAccountId',route_record.provider_platform_account_id,'chargeAccountId',route_record.charge_account_id,'recipientAccountId',route_record.recipient_account_id,'settlementMerchantAccountId',route_record.settlement_merchant_account_id,
  'applicationFeeMinor',route_record.application_fee_minor,'providerApiVersion',route_record.provider_api_version,'originKind',route_record.origin_kind,'providerSubscriptionRef',route_record.provider_subscription_ref,
  'providerInvoiceRef',route_record.provider_invoice_ref,'providerPaymentIntentRef',route_record.provider_payment_intent_ref,'providerChargeRef',route_record.provider_charge_ref,'originalChargeReceiptId',route_record.original_charge_receipt_id,
  'createdAt',to_char(route_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 RETURN encode(sha256(convert_to(freeholder_controlled_cash_ascii_canonical(commercial_body),'UTF8')),'hex');
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_route(target_payment_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 route_record merchant_agreement_payment_routes%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; bank_record record;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=link_record.receipt_id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=target_payment_uuid;
 IF batch_record.id IS NULL OR receipt_record.id IS NULL OR original_receipt.id IS NULL OR resource_record.id IS NULL OR route_record.payment_id IS NULL
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR receipt_record.batch_id IS DISTINCT FROM batch_record.id OR receipt_record.receipt_id IS DISTINCT FROM original_receipt.id
  OR route_record.original_charge_receipt_id IS DISTINCT FROM original_receipt.id OR route_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR route_record.created_at IS DISTINCT FROM now() OR route_record.agreement_routing_version<>1 OR route_record.origin_kind IS DISTINCT FROM 'provider_schedule' OR route_record.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version
  OR route_record.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR route_record.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR route_record.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref OR route_record.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR route_record.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref OR route_record.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR route_record.recipient_account_id IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR route_record.settlement_merchant_account_id IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR route_record.collection_kind IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR route_record.application_fee_minor IS DISTINCT FROM receipt_record.fee_minor THEN
  RAISE EXCEPTION 'Only the actual uniquely linked receipt/payment and exact original accepted fee/recipient route may cross the controlled canonical boundary' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_normalized_payment(target_payment_uuid);
 SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,original_receipt.id);
 IF bank_record.actual_inspection_id IS NULL OR bank_record.actual_inspection_id IS DISTINCT FROM receipt_record.bank_inspection_id OR bank_record.actual_observation_id IS DISTINCT FROM receipt_record.bank_observation_id
  OR bank_record.immutable_bank_fingerprint IS DISTINCT FROM receipt_record.immutable_bank_revision
  OR NOT freeholder_controlled_bank_unreturned(bank_record.original_expectation||jsonb_build_object('feeMinor',receipt_record.fee_minor),bank_record.current_evidence) THEN
  RAISE EXCEPTION 'The exact current immutable returned bank/fee/recipient facts must remain genuine across our own canonical writes' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_cash_validate_observation(target_observation_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE observation_record merchant_payment_observations%ROWTYPE; link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 route_record merchant_agreement_payment_routes%ROWTYPE; bank_record record; expected_observation jsonb;
BEGIN
 SELECT * INTO observation_record FROM merchant_payment_observations WHERE id=target_observation_uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=observation_record.payment_id;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO route_record FROM merchant_agreement_payment_routes WHERE payment_id=link_record.payment_id;
 IF observation_record.id IS NULL OR batch_record.id IS NULL OR receipt_record.id IS NULL OR route_record.payment_id IS NULL OR observation_record.observed_at IS DISTINCT FROM now() THEN
  RAISE EXCEPTION 'Only a genuine same-transaction exact receipt bank observation can be an own canonical delta' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_validate_route(link_record.payment_id);
 SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,receipt_record.receipt_id);
 expected_observation=jsonb_build_object('payment_id',link_record.payment_id,'provider_event_ref','controlled-cash-bank:'||receipt_record.bank_observation_id::text||':'||receipt_record.receipt_id::text,
  'provider_api_version','2026-10-28.endive','provider_ref',route_record.provider_payment_intent_ref,'status','succeeded','amount_minor',receipt_record.amount_minor,'currency',receipt_record.currency,
  'provider_platform_account_id',route_record.provider_platform_account_id,'charge_account_id',route_record.charge_account_id,'recipient_account_id',route_record.recipient_account_id,'settlement_merchant_account_id',route_record.settlement_merchant_account_id,
  'application_fee_minor',receipt_record.fee_minor,'provider_charge_ref',route_record.provider_charge_ref,'application_fee_ref',bank_record.current_evidence->'fee'->>'providerRef','transfer_ref',bank_record.current_evidence->'transfer'->>'providerRef',
  'route_verified',true,'customer_charge_verified',true,'application_fee_currency',coalesce(bank_record.current_evidence->'fee'->>'currency',receipt_record.currency),
  'observed_application_fee_minor',coalesce((bank_record.current_evidence->'fee'->>'amountMinor')::bigint,0),'observed_fee_refunded_minor',coalesce((bank_record.current_evidence->'fee'->>'refundedMinor')::bigint,0),'settlement_verified',true);
 IF(to_jsonb(observation_record)-'id'-'observed_at') IS DISTINCT FROM expected_observation THEN
  RAISE EXCEPTION 'Every own observation field must derive from this exact genuine returned bank capture/fee/recipient proof; no public evidence override' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
-- Reconstruct ONLY the actual shared plan columns, after independently proving
-- each real payment's FIFO allocations. Whole current rows retain due dates,
-- currency, principal, cancellation, source and every other immutable field.
CREATE FUNCTION freeholder_controlled_cash_normalized_plans(target_batch_uuid uuid)
RETURNS TABLE(family text,identity text,fingerprint text) LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; actual_plan payment_plans%ROWTYPE; original_plan jsonb; installment_record payment_plan_installments%ROWTYPE; original_installment jsonb;
 receipt_record record; remaining numeric; available numeric; expected_allocation numeric; allocation_count integer; allocation_sum numeric; prior_allocation numeric; total_delta numeric; installment_delta numeric;
 restored text; expected_status text; last_ordinal integer;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Normalize only the genuine current application transaction' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_plan FROM payment_plans WHERE invoice_id=admitted_batch.invoice_id;
 IF actual_plan.id IS NULL THEN
  IF jsonb_array_length(admitted_batch.mutable_before_rows)<>0 OR EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id WHERE actual_link.batch_id=admitted_batch.id) THEN
   RAISE EXCEPTION 'A nonexistent original plan cannot own new allocations or lose a retained before-row' USING ERRCODE='23514';END IF;
  RETURN;
 END IF;
 SELECT original_row INTO original_plan FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plans' AND original_row->>'id'=actual_plan.id::text;
 IF original_plan IS NULL OR actual_plan.currency IS DISTINCT FROM admitted_batch.currency
  OR jsonb_array_length(admitted_batch.mutable_before_rows)<>1+(SELECT count(*) FROM payment_plan_installments actual_installment WHERE actual_installment.plan_id=actual_plan.id) THEN
  RAISE EXCEPTION 'Preserve the full exact original plan and installment set; no new/omitted principal row' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id
  JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id LEFT JOIN payment_plan_installments actual_installment ON actual_installment.id=actual_allocation.installment_id
  WHERE actual_link.batch_id=admitted_batch.id AND(actual_payment.status IS DISTINCT FROM 'succeeded' OR actual_installment.plan_id IS DISTINCT FROM actual_plan.id)) THEN
  RAISE EXCEPTION 'Only actual settled receipt payments can fund their exact original invoice plan' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.*,actual_payment.status AS payment_status FROM controlled_cash_application_receipts actual_proof
  JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=actual_proof.id AND actual_link.batch_id=admitted_batch.id
  JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.payment_status<>'succeeded' THEN CONTINUE;END IF;
  IF original_plan->'fields'->>'status' NOT IN('active','defaulted') THEN
   IF EXISTS(SELECT 1 FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id WHERE actual_link.receipt_proof_id=receipt_record.id) THEN
    RAISE EXCEPTION 'The unchanged shared spine does not allocate into a cancelled/completed original plan' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  remaining=receipt_record.amount_minor;
  FOR installment_record IN SELECT installment_row.* FROM payment_plan_installments installment_row WHERE installment_row.plan_id=actual_plan.id ORDER BY installment_row.due_at,installment_row.position LOOP
   SELECT original_row INTO original_installment FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=installment_record.id::text;
   IF original_installment IS NULL THEN RAISE EXCEPTION 'Every actual installment must retain its original full-row preimage' USING ERRCODE='23514';END IF;
   SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO prior_allocation FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id
    JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=actual_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal WHERE actual_allocation.installment_id=installment_record.id;
   available=installment_record.amount_minor::numeric-(original_installment->'fields'->>'paid_minor')::numeric-prior_allocation;
   IF available<0 THEN RAISE EXCEPTION 'Earlier actual receipts cannot allocate the same installment principal twice' USING ERRCODE='23514';END IF;
   expected_allocation=CASE WHEN original_installment->'fields'->>'status' IN('scheduled','due','partially_paid','defaulted') THEN least(remaining,available) ELSE 0 END;
   SELECT count(*),coalesce(sum(actual_allocation.amount_minor),0) INTO allocation_count,allocation_sum FROM payment_allocations actual_allocation
    JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.receipt_proof_id=receipt_record.id WHERE actual_allocation.installment_id=installment_record.id;
   IF allocation_sum IS DISTINCT FROM expected_allocation OR allocation_count<>(CASE WHEN expected_allocation>0 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Require the exact real oldest-due/position FIFO allocation, not a sum-only plan distribution' USING ERRCODE='23514';END IF;
   remaining=remaining-expected_allocation;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Actual settlement cannot exceed the exact unallocated original plan principal' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO total_delta FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id;
 SELECT coalesce(max(receipt_proof.ordinal),0) INTO last_ordinal FROM controlled_cash_application_receipts receipt_proof JOIN controlled_cash_application_links actual_link ON actual_link.receipt_proof_id=receipt_proof.id AND actual_link.batch_id=admitted_batch.id JOIN payments actual_payment ON actual_payment.id=actual_link.payment_id AND actual_payment.status='succeeded';
 expected_status=freeholder_controlled_cash_plan_status(admitted_batch.id,last_ordinal);
 IF actual_plan.paid_minor::numeric IS DISTINCT FROM(original_plan->'fields'->>'paid_minor')::numeric+total_delta OR actual_plan.status IS DISTINCT FROM expected_status THEN
  RAISE EXCEPTION 'The actual plan status and paid principal must derive only from its genuine allocated receipt prefix' USING ERRCODE='23514';END IF;
 restored=encode(sha256(convert_to((to_jsonb(actual_plan)||(original_plan->'fields')||jsonb_build_object('updated_at',(original_plan->'fields'->>'updated_at')::timestamptz))::text,'UTF8')),'hex');
 IF restored IS DISTINCT FROM original_plan->>'fingerprint' THEN RAISE EXCEPTION 'No other plan field can change during cash application' USING ERRCODE='23514';END IF;
 family='payment_plans';identity=actual_plan.id::text;fingerprint=restored;RETURN NEXT;
 FOR installment_record IN SELECT installment_row.* FROM payment_plan_installments installment_row WHERE installment_row.plan_id=actual_plan.id LOOP
  SELECT original_row INTO original_installment FROM jsonb_array_elements(admitted_batch.mutable_before_rows) original_row WHERE original_row->>'table'='payment_plan_installments' AND original_row->>'id'=installment_record.id::text;
  SELECT coalesce(sum(actual_allocation.amount_minor),0) INTO installment_delta FROM payment_allocations actual_allocation JOIN controlled_cash_application_links actual_link ON actual_link.payment_id=actual_allocation.payment_id AND actual_link.batch_id=admitted_batch.id WHERE actual_allocation.installment_id=installment_record.id;
  expected_status=CASE WHEN installment_delta=0 THEN original_installment->'fields'->>'status' WHEN installment_record.paid_minor=installment_record.amount_minor THEN 'paid' ELSE 'partially_paid' END;
  IF installment_record.paid_minor::numeric IS DISTINCT FROM(original_installment->'fields'->>'paid_minor')::numeric+installment_delta OR installment_record.status IS DISTINCT FROM expected_status THEN
   RAISE EXCEPTION 'Only genuine original FIFO allocations may change the exact installment paid/status columns' USING ERRCODE='23514';END IF;
  restored=encode(sha256(convert_to((to_jsonb(installment_record)||(original_installment->'fields')||jsonb_build_object('updated_at',(original_installment->'fields'->>'updated_at')::timestamptz))::text,'UTF8')),'hex');
  IF restored IS DISTINCT FROM original_installment->>'fingerprint' THEN RAISE EXCEPTION 'Preserve every other full installment row field and timestamp preimage' USING ERRCODE='23514';END IF;
  family='payment_plan_installments';identity=installment_record.id::text;fingerprint=restored;RETURN NEXT;
 END LOOP;
END $$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33/C1.08: OWNED UNAPPLIED additive continuation AFTER exact
-- controlled-cash-application-stages84.fragment.sql + period-source-null84.
-- No edits to frozen SQL0-85. A marker points to genuine current stage only.
CREATE FUNCTION freeholder_controlled_subscription_route_valid(proposed_route jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE pointer jsonb; batch_record controlled_cash_application_batches%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
 origin_record subscription_controlled_charge_origins%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; payment_record payments%ROWTYPE; stage_record jsonb;
BEGIN
 pointer=nullif(current_setting('freeholder.controlled_cash_application_batch_v1',true),'')::jsonb;
 IF pointer IS NULL OR jsonb_typeof(pointer) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(pointer))<>4
  OR NOT(pointer ?& ARRAY['batchId','collectionId','receiptId','admissionDigest'])
  OR coalesce(pointer->>'batchId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'collectionId','')!~'^[a-f0-9-]{36}$'
  OR coalesce(pointer->>'receiptId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'admissionDigest','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=(pointer->>'batchId')::uuid;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=(pointer->>'receiptId')::uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_proof.id AND receipt_id=receipt_proof.receipt_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_proof.receipt_id;
 SELECT * INTO origin_record FROM subscription_controlled_charge_origins WHERE receipt_id=original_receipt.id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 IF batch_record.id IS NULL OR receipt_proof.id IS NULL OR link_record.payment_id IS NULL OR original_receipt.id IS NULL OR origin_record.receipt_id IS NULL OR resource_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.protocol IS DISTINCT FROM 'controlled_net_gross.v1' OR batch_record.digest IS DISTINCT FROM pointer->>'admissionDigest'
  OR batch_record.collection_id::text IS DISTINCT FROM pointer->>'collectionId' OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR origin_record.resource_id IS DISTINCT FROM batch_record.resource_id OR origin_record.operation_id IS DISTINCT FROM receipt_proof.origin_operation_id
  OR origin_record.call_id IS DISTINCT FROM receipt_proof.origin_call_id OR origin_record.fact_id IS DISTINCT FROM receipt_proof.origin_fact_id
  OR original_receipt.subscription_id IS DISTINCT FROM batch_record.subscription_id OR resource_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR original_receipt.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR original_receipt.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.status IS DISTINCT FROM 'created'
  OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_record.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR proposed_route->>'payment_id' IS DISTINCT FROM payment_record.id::text OR proposed_route->>'subscription_id' IS DISTINCT FROM batch_record.subscription_id::text
  OR proposed_route->>'agreement_routing_version' IS DISTINCT FROM '1' OR proposed_route->>'origin_kind' IS DISTINCT FROM 'provider_schedule'
  OR proposed_route->>'original_charge_receipt_id' IS DISTINCT FROM original_receipt.id::text
  OR proposed_route->>'provider_api_version' IS DISTINCT FROM original_receipt.provider_api_version
  OR proposed_route->>'provider_platform_account_id' IS DISTINCT FROM original_receipt.provider_platform_account_id
  OR proposed_route->>'charge_account_id' IS DISTINCT FROM original_receipt.charge_account_id
  OR proposed_route->>'provider_subscription_ref' IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR proposed_route->>'provider_invoice_ref' IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR proposed_route->>'provider_payment_intent_ref' IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR proposed_route->>'provider_charge_ref' IS DISTINCT FROM original_receipt.provider_charge_ref OR original_receipt.provider_charge_ref IS NULL
  OR proposed_route->>'recipient_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'settlement_merchant_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'collection_kind' IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR proposed_route->>'application_fee_minor' IS DISTINCT FROM receipt_proof.fee_minor::text
  OR (proposed_route->>'created_at')::timestamptz IS DISTINCT FROM now() THEN RETURN false;END IF;
 -- Real post-birth row/link, exact settled prefix, complete current PG graph and
 -- immutable returned bank proof. Never a marker-only or planned-payment grant.
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_proof.receipt_id,payment_record.id);
 RETURN coalesce(stage_record->>'batchId'=batch_record.id::text AND stage_record->>'collectionId'=batch_record.collection_id::text
  AND stage_record->>'receiptId'=receipt_proof.receipt_id::text AND stage_record->>'paymentId'=payment_record.id::text
  AND stage_record->>'normalizedParentRevision'=batch_record.parent_pg_revision AND stage_record->>'complete'='false',false);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric; duty agreement_fee_duties%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original agreement payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO parent FROM invoices WHERE id=payment.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=payment.invoice_id;
 SELECT scope.* INTO original FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id
  WHERE scope.subscription_id=NEW.subscription_id AND s.merchant_scope_version=1;
 IF payment.id IS NULL OR parent.id IS NULL OR original.subscription_id IS NULL OR parent.source_type IS DISTINCT FROM 'subscription'
  OR split_part(parent.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text OR policy.invoice_id IS NULL OR policy.model IS DISTINCT FROM 'seller_merchant'
  OR payment.currency IS DISTINCT FROM parent.currency
  OR payment.provider<>'stripe' OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method','provider_schedule')
  OR NEW.collection_kind IS DISTINCT FROM original.collection_kind OR NEW.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id
  OR NEW.charge_account_id IS DISTINCT FROM original.charge_account_id OR NEW.recipient_account_id IS DISTINCT FROM original.recipient_account_id
  OR NEW.settlement_merchant_account_id IS DISTINCT FROM original.settlement_merchant_account_id
  OR(NEW.origin_kind='provider_schedule') IS DISTINCT FROM(payment.method='provider_schedule')
  OR(NEW.origin_kind='provider_schedule' AND NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version)
  OR(NEW.origin_kind='provider_schedule' AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt WHERE receipt.id=NEW.original_charge_receipt_id
   AND receipt.subscription_id=NEW.subscription_id AND receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id
   AND receipt.provider_api_version=NEW.provider_api_version AND receipt.provider_subscription_ref=NEW.provider_subscription_ref AND receipt.provider_invoice_ref=NEW.provider_invoice_ref
   AND receipt.provider_payment_intent_ref=NEW.provider_payment_intent_ref AND receipt.provider_charge_ref=NEW.provider_charge_ref AND receipt.amount_minor=payment.amount_minor AND receipt.currency=payment.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 IF split_part(parent.source_id,':',2)='proration' THEN
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=parent.id;
  SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor)),0) INTO paid,prior_fee FROM payments p
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id
   WHERE p.invoice_id=parent.id AND p.status='succeeded';
  IF duty.invoice_id IS NULL OR (NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW))) OR duty.total_minor<>parent.total_minor OR duty.credited_minor<>parent.credited_minor OR duty.target_fee_minor<>policy.fee_minor
   OR duty.cash_principal_minor<=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>duty.cash_principal_minor
   OR prior_fee<>floor(duty.cash_fee_target_minor::numeric*paid/duty.cash_principal_minor)
   OR NEW.application_fee_minor<>floor(duty.cash_fee_target_minor::numeric*(paid+payment.amount_minor)/duty.cash_principal_minor)-prior_fee
   OR EXISTS(SELECT 1 FROM payments p LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id WHERE p.invoice_id=parent.id AND p.status='succeeded'
    AND((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer<>1 OR p.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Bind only the physically bounded original gross-target fee while preserving its separately frozen merchant receivable and actual source assignments' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_agreement_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=payment.invoice_id AND p.status='succeeded';
 IF parent.total_minor=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>parent.total_minor
  OR prior_fee<>floor(policy.fee_minor::numeric*paid/parent.total_minor)
  OR NEW.application_fee_minor<>floor(policy.fee_minor::numeric*(paid+payment.amount_minor)/parent.total_minor)-prior_fee THEN
  RAISE EXCEPTION 'The original agreement payment and application fee must conserve every invoice cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION guard_subscription_controlled_agreement_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM subscription_controlled_charge_origins actual_origin WHERE actual_origin.receipt_id=NEW.original_charge_receipt_id) THEN
  IF TG_OP IS DISTINCT FROM 'INSERT' OR freeholder_controlled_subscription_route_valid(to_jsonb(NEW)) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Only the actual uniquely admitted controlled receipt/payment may create its exact original immutable merchant route' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER subscription_controlled_agreement_route_guard BEFORE INSERT OR UPDATE ON merchant_agreement_payment_routes FOR EACH ROW EXECUTE FUNCTION guard_subscription_controlled_agreement_route();

--> statement-breakpoint
CREATE FUNCTION freeholder_controlled_subscription_route_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('freeholder_controlled_subscription_route_valid(jsonb)') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='85c86262d3f819470ff6bb6e534e91357cbfb3e62bf4ae3b4a4eece2eabf5426')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_merchant_agreement_payment_route()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6afbc75ffcecfa9210c70a2646e6cb1751b5016367d845e498116c1362289d65')
  AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5315979c10ffba43177521dccf94ab401442f724f9bb372eb24802327d391c6f')
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38: OWNED UNAPPLIED after complete core3/783 corrected definitions.
-- Replace the deliberately closed old424 shape ONLY with genuine immutable
-- receipt/payment/bank/parent/current-TX complete proof. Old boundary triggers
-- and every applicable structural predicate remain; no marker supplies grant.
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
 IF link_row.receipt_id IS NULL OR receipt_proof.id IS NULL OR batch_row.id IS NULL
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
 IF current_batch.collection_id IS DISTINCT FROM collection_row.id THEN RETURN false;END IF;
 IF batch_row.id<>current_batch.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_batch.before_entries) original_entry
  WHERE original_entry->>'table'='payments' AND original_entry->>'id'=payment_row.id::text
   AND original_entry->>'fingerprint'=encode(sha256(convert_to(to_jsonb(payment_row)::text,'UTF8')),'hex')) THEN RETURN false;END IF;
 stage=freeholder_controlled_cash_stage(current_batch.id,null,null);
 RETURN stage->>'complete'='true' AND stage->>'batchId'=current_batch.id::text
  AND stage->>'normalizedParentRevision'=current_batch.parent_pg_revision;
END $$;

--> statement-breakpoint

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: complete local-binding successor; frozen source stays unchanged.
-- Only the local actual variable is renamed; qualified fact.actual columns remain.
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
 SELECT actual_result INTO listing FROM subscription_controlled_verifications WHERE operation_id=listed.id;
 IF listed.id IS NULL OR listing->>'complete' IS DISTINCT FROM 'true' OR jsonb_typeof(listing->'providerInvoiceRefs') IS DISTINCT FROM 'array'
  OR jsonb_typeof(listing->'actualInvoices') IS DISTINCT FROM 'array' OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(listing->'actualInvoices')
  OR jsonb_array_length(listing->'providerInvoiceRefs')<>jsonb_array_length(proof->'invoiceReadOperationIds')
  OR EXISTS(SELECT 1 FROM subscription_controlled_operations later WHERE later.resource_id=r.id AND later.kind='list_invoices' AND later.ordinal>listed.ordinal AND later.ordinal<o.ordinal) THEN RETURN false;END IF;
 SELECT min(prior.ordinal) INTO first_update FROM subscription_controlled_operations prior WHERE prior.resource_id=r.id AND prior.kind='update_calendar'
  AND EXISTS(SELECT 1 FROM subscription_controlled_calls admitted WHERE admitted.operation_id=prior.id);
 FOR read_id IN SELECT value FROM jsonb_array_elements(proof->'invoiceReadOperationIds') LOOP
  SELECT * INTO reader FROM subscription_controlled_operations WHERE id::text=(read_id#>>'{}') AND resource_id=r.id AND kind='read_invoice' AND ordinal>listed.ordinal AND ordinal<o.ordinal;
  SELECT actual_result INTO observed_invoice FROM subscription_controlled_verifications WHERE operation_id=reader.id;
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

-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33/C1.08: OWNED UNAPPLIED after genuine complete fde + c942 route.
-- Actual target protocol stays v1. Only a signed, same-TX complete atomic batch
-- selects v2 endpoint conservation; every legacy prefix rule remains in place.
ALTER TABLE controlled_cash_application_batches DROP CONSTRAINT controlled_cash_batches_protocol;
--> statement-breakpoint
ALTER TABLE controlled_cash_application_batches ADD CONSTRAINT controlled_cash_batches_protocol CHECK(protocol IN('controlled_net_gross.v1','controlled_cash_atomic.v1') AND admission_transaction_id ~ '^[0-9]+$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_guard_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_collection subscription_controlled_collections%ROWTYPE; actual_quote subscription_controlled_quotes%ROWTYPE; actual_invoice invoices%ROWTYPE;
 actual_snapshot jsonb; actual_bank jsonb; selected_ids uuid[]; expected_cash numeric; actual_mutable jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original controlled cash application admissions are immutable financial evidence' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_collection FROM subscription_controlled_collections WHERE id=NEW.collection_id;
 SELECT * INTO actual_quote FROM subscription_controlled_quotes WHERE id=actual_collection.quote_id;
 SELECT * INTO actual_invoice FROM invoices WHERE id=actual_collection.invoice_id;
 PERFORM freeholder_controlled_cash_require_prefix(NEW.resource_id);
 IF NEW.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR actual_collection.id IS NULL OR actual_quote.id IS NULL OR actual_invoice.id IS NULL OR NEW.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR actual_collection.quote_id IS DISTINCT FROM NEW.quote_id OR actual_quote.resource_id IS DISTINCT FROM NEW.resource_id
  OR NOT EXISTS(SELECT 1 FROM subscription_controlled_resources original_resource WHERE original_resource.id=NEW.resource_id AND original_resource.subscription_id=NEW.subscription_id)
  OR actual_collection.invoice_id IS DISTINCT FROM NEW.invoice_id OR actual_collection.terms_id IS DISTINCT FROM NEW.terms_id
  OR actual_collection.accepted_quote_digest IS DISTINCT FROM NEW.accepted_quote_digest OR actual_collection.canonical_target_digest IS DISTINCT FROM NEW.canonical_target_digest
  OR actual_invoice.currency IS DISTINCT FROM NEW.currency OR actual_invoice.status IS DISTINCT FROM NEW.invoice_before_status
  OR actual_invoice.paid_minor IS DISTINCT FROM NEW.invoice_before_paid_minor OR actual_invoice.credited_minor IS DISTINCT FROM NEW.invoice_before_credited_minor OR actual_invoice.refunded_minor<>0
  OR to_jsonb(actual_invoice)->>'paid_at' IS DISTINCT FROM NEW.invoice_before_paid_at OR to_jsonb(actual_invoice)->>'updated_at' IS DISTINCT FROM NEW.invoice_before_updated_at
  OR encode(sha256(convert_to(to_jsonb(actual_invoice)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.invoice_before_fingerprint THEN
  RAISE EXCEPTION 'The immutable application admission must bind the exact real accepted collection and complete current canonical invoice' USING ERRCODE='23514';END IF;
 actual_snapshot=freeholder_controlled_cash_parent_snapshot(NEW.collection_id);
 IF actual_snapshot->'entries' IS DISTINCT FROM NEW.before_entries OR actual_snapshot->>'revision' IS DISTINCT FROM NEW.parent_pg_revision THEN
  RAISE EXCEPTION 'A parent admission cannot omit or rewrite any physical current source family or raw occurrence' USING ERRCODE='23514';END IF;
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO selected_ids FROM jsonb_array_elements_text(NEW.requested_receipt_ids);
 IF cardinality(selected_ids) NOT BETWEEN 1 AND 5000 OR cardinality(selected_ids)<>(SELECT count(DISTINCT value) FROM unnest(selected_ids) value)
  OR NEW.requested_receipt_ids IS DISTINCT FROM to_jsonb(selected_ids) THEN RAISE EXCEPTION 'Freeze the exact sorted unique retained receipt UUID batch' USING ERRCODE='23514';END IF;
 actual_bank=freeholder_controlled_cash_bank_invoice(NEW.collection_id);
 IF EXISTS(SELECT 1 FROM unnest(selected_ids) selected_id WHERE NOT(actual_bank->'positiveReceiptIds' @> to_jsonb(ARRAY[selected_id])))
  OR EXISTS(SELECT 1 FROM merchant_agreement_payment_routes prior_route WHERE prior_route.original_charge_receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM controlled_cash_application_links prior_link WHERE prior_link.receipt_id=ANY(selected_ids))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual_bank->'positiveReceiptIds') bank_id WHERE NOT(bank_id::uuid=ANY(selected_ids)) AND NOT EXISTS(
   SELECT 1 FROM merchant_agreement_payment_routes original_route JOIN payments original_payment ON original_payment.id=original_route.payment_id
   WHERE original_route.original_charge_receipt_id=bank_id::uuid AND original_payment.invoice_id=NEW.invoice_id AND original_payment.status='succeeded'
    AND original_payment.refunded_minor=0 AND original_payment.provider='stripe' AND original_payment.method='provider_schedule')) THEN
  RAISE EXCEPTION 'Every actual positive bank receipt must be either exact already canonical cash or explicitly admitted new cash; no receipt reuse or value adoption' USING ERRCODE='23514';END IF;
 SELECT sum(original_receipt.amount_minor) INTO expected_cash FROM subscription_provider_charge_receipts original_receipt WHERE original_receipt.id=ANY(selected_ids) AND original_receipt.currency=NEW.currency;
 IF expected_cash IS DISTINCT FROM NEW.expected_cash_minor::numeric OR NEW.invoice_before_paid_minor::numeric+expected_cash+NEW.invoice_before_credited_minor>actual_invoice.total_minor::numeric
  OR NEW.invoice_before_paid_minor::numeric+expected_cash IS DISTINCT FROM (actual_bank->>'paidMinor')::numeric THEN
  RAISE EXCEPTION 'Preserve actual partial bank cash and unpaid remainder; never clip an overage or invent a second principal' USING ERRCODE='23514';END IF;
 -- Freeze only the exact shared plan columns that settlement may mutate, with
 -- original PG timestamp precision and full-row SHA for every affected row.
 SELECT coalesce(jsonb_agg(jsonb_build_object('table',candidate.family,'id',candidate.identity,'fingerprint',candidate.fingerprint,'fields',candidate.fields) ORDER BY candidate.family,candidate.identity),'[]'::jsonb)
 INTO actual_mutable FROM(
  SELECT 'payment_plans'::text family,actual_plan.id::text identity,encode(sha256(convert_to(to_jsonb(actual_plan)::text,'UTF8')),'hex') fingerprint,
   jsonb_build_object('paid_minor',actual_plan.paid_minor,'status',actual_plan.status,'updated_at',to_jsonb(actual_plan)->>'updated_at') fields FROM payment_plans actual_plan WHERE actual_plan.invoice_id=NEW.invoice_id
  UNION ALL SELECT 'payment_plan_installments',actual_installment.id::text,encode(sha256(convert_to(to_jsonb(actual_installment)::text,'UTF8')),'hex'),
   jsonb_build_object('paid_minor',actual_installment.paid_minor,'status',actual_installment.status,'updated_at',to_jsonb(actual_installment)->>'updated_at')
   FROM payment_plan_installments actual_installment JOIN payment_plans actual_plan ON actual_plan.id=actual_installment.plan_id WHERE actual_plan.invoice_id=NEW.invoice_id
 ) candidate;
 IF NEW.mutable_before_rows IS DISTINCT FROM actual_mutable THEN RAISE EXCEPTION 'The full exact original payment-plan preimage must be complete; no plan-row backfill or partial selector' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE; original_origin subscription_controlled_charge_origins%ROWTYPE;
 actual_bank record; actual_observation subscription_provider_charge_observations%ROWTYPE; actual_inspection merchant_cash_return_inspections%ROWTYPE; exact_observation_ids uuid[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original exact receipt/bank admissions are immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=NEW.batch_id;
 IF admitted_batch.id IS NULL OR admitted_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Receipt admission belongs to the same actual original application transaction' USING ERRCODE='23514';END IF;
 PERFORM freeholder_controlled_cash_prewrite(admitted_batch.id);
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO original_origin FROM subscription_controlled_charge_origins WHERE receipt_id=NEW.receipt_id;
 SELECT * INTO actual_inspection FROM merchant_cash_return_inspections WHERE id=NEW.bank_inspection_id;
 SELECT * INTO actual_observation FROM subscription_provider_charge_observations WHERE id=NEW.original_observation_id;
 SELECT * INTO actual_bank FROM freeholder_controlled_receipt_bank_observation(admitted_batch.collection_id,NEW.receipt_id);
 IF original_receipt.id IS NULL OR original_origin.receipt_id IS NULL OR actual_inspection.id IS NULL OR actual_observation.id IS NULL OR actual_bank.actual_inspection_id IS NULL
  OR NOT(admitted_batch.requested_receipt_ids @> to_jsonb(ARRAY[NEW.receipt_id])) OR original_receipt.subscription_id IS DISTINCT FROM admitted_batch.subscription_id
  OR NEW.ordinal IS DISTINCT FROM(SELECT ordinal::integer FROM jsonb_array_elements_text(admitted_batch.requested_receipt_ids) WITH ORDINALITY selected_id(value,ordinal) WHERE value=NEW.receipt_id::text)
  OR original_origin.resource_id IS DISTINCT FROM admitted_batch.resource_id OR original_origin.operation_id IS DISTINCT FROM NEW.origin_operation_id OR original_origin.call_id IS DISTINCT FROM NEW.origin_call_id OR original_origin.fact_id IS DISTINCT FROM NEW.origin_fact_id
  OR original_receipt.amount_minor IS DISTINCT FROM NEW.amount_minor OR original_receipt.currency IS DISTINCT FROM NEW.currency OR NEW.currency IS DISTINCT FROM admitted_batch.currency
  OR encode(sha256(convert_to(to_jsonb(original_receipt)::text,'UTF8')),'hex') IS DISTINCT FROM NEW.receipt_fingerprint
  OR actual_inspection.payment_id IS NOT NULL OR actual_inspection.subscription_charge_receipt_id IS DISTINCT FROM NEW.receipt_id OR actual_inspection.subscription_charge_observation_id IS DISTINCT FROM NEW.original_observation_id
  OR actual_inspection.caller->>'id' IS DISTINCT FROM NEW.bank_finish_caller_id::text OR actual_bank.actual_inspection_id IS DISTINCT FROM NEW.bank_inspection_id OR actual_bank.actual_observation_id IS DISTINCT FROM NEW.bank_observation_id
  OR NEW.processed_at IS DISTINCT FROM(SELECT date_trunc('milliseconds',original_bank.created_at) FROM merchant_cash_return_observations original_bank WHERE original_bank.id=NEW.bank_observation_id AND original_bank.inspection_id=NEW.bank_inspection_id)
  OR actual_bank.immutable_bank_fingerprint IS DISTINCT FROM NEW.immutable_bank_revision OR actual_bank.bank_fingerprint IS DISTINCT FROM NEW.namespace_revision
  OR actual_observation.subscription_id IS DISTINCT FROM original_receipt.subscription_id OR actual_observation.provider_payment_intent_ref IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR actual_observation.provider_platform_account_id IS DISTINCT FROM original_receipt.provider_platform_account_id OR actual_observation.charge_account_id IS DISTINCT FROM original_receipt.charge_account_id
  OR actual_observation.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR actual_observation.currency IS DISTINCT FROM original_receipt.currency
  OR actual_observation.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR actual_observation.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR actual_observation.provider_charge_ref IS NOT NULL AND actual_observation.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
  OR NOT actual_observation.customer_charge_verified OR NOT actual_observation.merchant_route_verified THEN
  RAISE EXCEPTION 'Only genuine original receipt/caller/returned bank lineage in the exact platform/account/PI namespace can supply a prospective cash admission' USING ERRCODE='23514';END IF;
 -- Match the existing authenticated source's retained display order. This is
 -- array identity only: genuine bank chronology uses the separate lineage.
 SELECT coalesce(array_agg(observed.id ORDER BY observed.created_at,observed.id),ARRAY[]::uuid[]) INTO exact_observation_ids FROM subscription_provider_charge_observations observed
  WHERE observed.subscription_id=original_receipt.subscription_id AND observed.provider_platform_account_id=original_receipt.provider_platform_account_id
   AND observed.charge_account_id IS NOT DISTINCT FROM original_receipt.charge_account_id AND observed.provider_payment_intent_ref=original_receipt.provider_payment_intent_ref;
 IF NEW.original_observation_ids IS DISTINCT FROM to_jsonb(exact_observation_ids)
  OR EXISTS(SELECT 1 FROM subscription_provider_charge_observations observed WHERE observed.id=ANY(exact_observation_ids) AND(
   observed.provider_api_version IS DISTINCT FROM original_receipt.provider_api_version OR observed.provider_subscription_ref IS DISTINCT FROM original_receipt.provider_subscription_ref
   OR observed.provider_invoice_ref IS DISTINCT FROM original_receipt.provider_invoice_ref OR observed.amount_minor IS DISTINCT FROM original_receipt.amount_minor OR observed.currency IS DISTINCT FROM original_receipt.currency
   OR observed.provider_charge_ref IS NOT NULL AND observed.provider_charge_ref IS DISTINCT FROM original_receipt.provider_charge_ref
   OR observed.actual_destination_account_id IS DISTINCT FROM original_receipt.actual_destination_account_id OR observed.actual_settlement_merchant_account_id IS DISTINCT FROM original_receipt.actual_settlement_merchant_account_id
   OR NOT observed.customer_charge_verified OR NOT observed.merchant_route_verified))
  OR NOT freeholder_controlled_bank_unreturned(actual_bank.original_expectation||jsonb_build_object('feeMinor',NEW.fee_minor),actual_bank.current_evidence)
  OR NEW.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||NEW.receipt_id::text
  OR NEW.payment_request_hash IS DISTINCT FROM encode(sha256(convert_to(format('{"amountMinor":%s,"idempotencyKey":"%s","invoiceId":"%s","metadata":{},"method":"provider_schedule","provider":"stripe","subscriptionChargeReceiptId":"%s"}',
   NEW.amount_minor,NEW.payment_idempotency_key,admitted_batch.invoice_id,NEW.receipt_id),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Keep every original observation and exact real shared request; current fee/recipient/refund/dispute facts cannot be waived by a marker' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_receipts_complete(target_batch_uuid uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE admitted_batch controlled_cash_application_batches%ROWTYPE; proof_count integer; actual_ids jsonb; actual_cash numeric; actual_fee numeric;
 actual_invoice invoices%ROWTYPE; original_policy invoice_market_policies%ROWTYPE; actual_duty agreement_fee_duties%ROWTYPE;
 original_paid numeric; original_fee numeric; carried_fee numeric; cash_principal numeric; fee_target numeric; receipt_record controlled_cash_application_receipts%ROWTYPE;
BEGIN
 SELECT * INTO admitted_batch FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 IF admitted_batch.id IS NULL OR admitted_batch.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR admitted_batch.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Use only the same real immutable application transaction' USING ERRCODE='23514';END IF;
 SELECT count(*),jsonb_agg(receipt_proof.receipt_id ORDER BY receipt_proof.ordinal),sum(receipt_proof.amount_minor),sum(receipt_proof.fee_minor)
 INTO proof_count,actual_ids,actual_cash,actual_fee FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id;
 IF proof_count NOT BETWEEN 1 AND 5000 OR actual_ids IS DISTINCT FROM admitted_batch.requested_receipt_ids OR actual_cash IS DISTINCT FROM admitted_batch.expected_cash_minor::numeric OR actual_fee IS DISTINCT FROM admitted_batch.expected_fee_minor::numeric
  OR EXISTS(SELECT 1 FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id AND receipt_proof.ordinal<1)
  OR(SELECT max(receipt_proof.ordinal) FROM controlled_cash_application_receipts receipt_proof WHERE receipt_proof.batch_id=admitted_batch.id)<>proof_count THEN
  RAISE EXCEPTION 'The exact complete UUID batch and contiguous receipt/fee prefix must exist before any payment mutation' USING ERRCODE='23514';END IF;
 SELECT * INTO actual_invoice FROM invoices WHERE id=admitted_batch.invoice_id;
 SELECT * INTO original_policy FROM invoice_market_policies WHERE invoice_id=admitted_batch.invoice_id;
 SELECT * INTO actual_duty FROM agreement_fee_duties WHERE invoice_id=admitted_batch.invoice_id;
 -- Original real payments only. New actual links in this batch are accounted
 -- separately by the exact staged delta; they never rewrite original paid cash.
 SELECT coalesce(sum(actual_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0)
 INTO original_paid,original_fee FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
 WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND actual_payment.status='succeeded'
  AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id);
 IF original_policy.invoice_id IS NULL OR original_paid IS DISTINCT FROM admitted_batch.invoice_before_paid_minor::numeric
  OR EXISTS(SELECT 1 FROM payments actual_payment LEFT JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=actual_payment.id
   WHERE actual_payment.invoice_id=admitted_batch.invoice_id AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links own_link WHERE own_link.batch_id=admitted_batch.id AND own_link.payment_id=actual_payment.id)
    AND(actual_payment.status IN('created','processing') OR actual_payment.status='succeeded' AND(original_route.payment_id IS NULL OR actual_payment.refunded_minor<>0))) THEN
  RAISE EXCEPTION 'Keep complete real prior principal, original fee routes and every pending/refunded attempt; no virtual prefix or missing original fee owner' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(actual_application.fee_obligation_minor),0) INTO carried_fee FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id;
 IF(SELECT coalesce(sum(actual_reservation.amount_minor),0) FROM invoice_credit_applications actual_application JOIN invoice_credit_reservations actual_reservation ON actual_reservation.id=actual_application.reservation_id WHERE actual_application.invoice_id=admitted_batch.invoice_id) IS DISTINCT FROM admitted_batch.invoice_before_credited_minor::numeric
  OR EXISTS(SELECT 1 FROM invoice_credit_applications actual_application WHERE actual_application.invoice_id=admitted_batch.invoice_id AND actual_application.fee_evidence_digest IS NULL) THEN
  RAISE EXCEPTION 'Retain every actual original noncash credit and its fee assignment before physical cash application' USING ERRCODE='23514';END IF;
 cash_principal=actual_invoice.total_minor::numeric-admitted_batch.invoice_before_credited_minor::numeric;
 fee_target=greatest(0,original_policy.fee_minor::numeric-carried_fee);
 IF actual_duty.invoice_id IS NOT NULL THEN
  IF actual_duty.total_minor IS DISTINCT FROM actual_invoice.total_minor OR actual_duty.target_fee_minor IS DISTINCT FROM original_policy.fee_minor
   OR actual_duty.credited_minor IS DISTINCT FROM admitted_batch.invoice_before_credited_minor OR actual_duty.carried_fee_minor::numeric IS DISTINCT FROM carried_fee OR actual_duty.cash_principal_minor::numeric IS DISTINCT FROM cash_principal THEN
   RAISE EXCEPTION 'Preserve the frozen gross target fee duty and exact carried credit epoch' USING ERRCODE='23514';END IF;
  fee_target=actual_duty.cash_fee_target_minor;
 END IF;
 IF cash_principal<=0 OR fee_target>cash_principal OR original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Restore the exact original cumulative cash commission; never silently reprice historical fee allocations' USING ERRCODE='23514';END IF;
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=admitted_batch.id ORDER BY actual_proof.ordinal LOOP
  IF receipt_record.prior_cash_minor::numeric IS DISTINCT FROM original_paid OR receipt_record.prior_allocated_fee_minor::numeric IS DISTINCT FROM original_fee
   OR(admitted_batch.protocol='controlled_net_gross.v1' AND receipt_record.fee_minor::numeric IS DISTINCT FROM floor(fee_target*(original_paid+receipt_record.amount_minor::numeric)/cash_principal)-original_fee) THEN
   RAISE EXCEPTION 'Every later fee plan must bind its exact preceding real receipt prefix and deterministic residual' USING ERRCODE='23514';END IF;
  original_paid=original_paid+receipt_record.amount_minor;original_fee=original_fee+receipt_record.fee_minor;
 END LOOP;
 IF original_fee IS DISTINCT FROM floor(fee_target*original_paid/cash_principal) THEN
  RAISE EXCEPTION 'Every actual fee must conserve the original cumulative endpoint within this complete atomic batch; unseen future receipts cannot supply a residual' USING ERRCODE='23514';END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_before_settlement(target_payment_uuid uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE link_record controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE;
 payment_record payments%ROWTYPE; stage_record jsonb; prior_cash numeric; prior_fee numeric;
BEGIN
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=link_record.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=link_record.batch_id;
 SELECT * INTO payment_record FROM payments WHERE id=target_payment_uuid;
 IF link_record.receipt_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR payment_record.id IS NULL OR payment_record.status NOT IN('created','processing') THEN
  RAISE EXCEPTION 'Only a genuine newly linked original receipt can cross the current settlement boundary' USING ERRCODE='23514';END IF;
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,payment_record.id);
 IF(SELECT count(*) FROM merchant_agreement_payment_routes original_route WHERE original_route.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM merchant_payment_observations original_observation WHERE original_observation.payment_id=payment_record.id)<>1
  OR(SELECT count(*) FROM agreement_fee_cash_assignments original_fee WHERE original_fee.payment_id=payment_record.id)<>(CASE WHEN EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id) THEN 1 ELSE 0 END)
  OR(SELECT count(*) FROM money_state_events created_event WHERE created_event.subject_type='payment' AND created_event.subject_id=payment_record.id AND created_event.from_state IS NULL AND created_event.to_state='created')<>1
  OR(SELECT count(*) FROM controlled_cash_application_links earlier_link JOIN controlled_cash_application_receipts earlier_proof ON earlier_proof.id=earlier_link.receipt_proof_id AND earlier_proof.ordinal<receipt_record.ordinal
   JOIN payments earlier_payment ON earlier_payment.id=earlier_link.payment_id AND earlier_payment.status='succeeded' WHERE earlier_link.batch_id=batch_record.id)<>receipt_record.ordinal-1 THEN
  RAISE EXCEPTION 'Settle only after the actual current route, exact returned-bank observation, fee promise, creation history and every earlier real receipt are complete' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(original_payment.amount_minor),0),coalesce(sum(original_route.application_fee_minor),0) INTO prior_cash,prior_fee FROM payments original_payment
  JOIN merchant_agreement_payment_routes original_route ON original_route.payment_id=original_payment.id WHERE original_payment.invoice_id=batch_record.invoice_id AND original_payment.status='succeeded';
 IF prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric OR prior_fee IS DISTINCT FROM receipt_record.prior_allocated_fee_minor::numeric THEN
  RAISE EXCEPTION 'A later frozen fee plan is usable only when its exact earlier cash/fee allocations ACTUALLY exist; no virtual paid prefix' USING ERRCODE='23514';END IF;
 RETURN stage_record;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_cash_stage(target_batch_uuid uuid,target_receipt_uuid uuid DEFAULT null,target_payment_uuid uuid DEFAULT null) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE batch_record controlled_cash_application_batches%ROWTYPE; target_proof controlled_cash_application_receipts%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; payment_record payments%ROWTYPE; invoice_record invoices%ROWTYPE; bank_record record; normalized_parent jsonb; final_snapshot jsonb;
 count_links integer; count_receipts integer; route_count integer; fee_count integer; observation_count integer; created_count integer; processing_count integer; succeeded_count integer; invoice_event_count integer; plan_event_count integer;
 prior_cash numeric; prior_count integer; settled_cash numeric=0; settled_fee numeric=0; settled_ids jsonb='[]'::jsonb; bank_revisions jsonb='[]'::jsonb;
 expected_from text; expected_to text; plan_from text; plan_to text; has_duty boolean;
BEGIN
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=target_batch_uuid;
 SELECT * INTO invoice_record FROM invoices WHERE id=batch_record.invoice_id;
 IF batch_record.id IS NULL OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR invoice_record.id IS NULL OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Only this original real transaction can prove its own canonical stage' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL THEN
  SELECT * INTO target_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=target_receipt_uuid;
  IF target_proof.id IS NULL THEN RAISE EXCEPTION 'The target stage must be an exact actual admitted receipt UUID' USING ERRCODE='23514';END IF;
 ELSE IF target_payment_uuid IS NOT NULL THEN RAISE EXCEPTION 'A canonical payment cannot supply an unbound batch stage' USING ERRCODE='23514';END IF;END IF;
 normalized_parent=freeholder_controlled_cash_normalized_parent(batch_record.id);
 SELECT count(*) INTO count_links FROM controlled_cash_application_links WHERE batch_id=batch_record.id;
 SELECT count(*) INTO count_receipts FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id;
 has_duty=EXISTS(SELECT 1 FROM agreement_fee_duties actual_duty WHERE actual_duty.invoice_id=batch_record.invoice_id);
 FOR receipt_record IN SELECT actual_proof.* FROM controlled_cash_application_receipts actual_proof WHERE actual_proof.batch_id=batch_record.id ORDER BY actual_proof.ordinal LOOP
  SELECT * INTO bank_record FROM freeholder_controlled_receipt_bank_observation(batch_record.collection_id,receipt_record.receipt_id);
  IF bank_record.actual_inspection_id IS NULL OR bank_record.actual_inspection_id IS DISTINCT FROM receipt_record.bank_inspection_id OR bank_record.actual_observation_id IS DISTINCT FROM receipt_record.bank_observation_id
   OR bank_record.immutable_bank_fingerprint IS DISTINCT FROM receipt_record.immutable_bank_revision
   OR count_links=0 AND bank_record.bank_fingerprint IS DISTINCT FROM receipt_record.namespace_revision
   OR NOT freeholder_controlled_bank_unreturned(bank_record.original_expectation||jsonb_build_object('feeMinor',receipt_record.fee_minor),bank_record.current_evidence) THEN
   RAISE EXCEPTION 'Require every exact immutable returned source bank proof plus FULL current parent normalization; never cache scalar authority across a changed namespace' USING ERRCODE='23514';END IF;
  bank_revisions=bank_revisions||jsonb_build_array(jsonb_build_object('receiptId',receipt_record.receipt_id,'immutableBankRevision',bank_record.immutable_bank_fingerprint,'currentNamespaceRevision',bank_record.bank_fingerprint));
  SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_record.id AND receipt_id=receipt_record.receipt_id;
  IF link_record.receipt_id IS NULL THEN
   IF target_receipt_uuid IS NULL OR receipt_record.ordinal<target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND target_payment_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A missing actual earlier payment cannot be supplied by planned receipt order or a completed-looking batch' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
  IF target_receipt_uuid IS NOT NULL AND(receipt_record.ordinal>target_proof.ordinal OR receipt_record.receipt_id=target_receipt_uuid AND link_record.payment_id IS DISTINCT FROM target_payment_uuid)
   OR payment_record.status<>'succeeded' AND(receipt_record.receipt_id IS DISTINCT FROM target_receipt_uuid OR link_record.payment_id IS DISTINCT FROM target_payment_uuid) THEN
   RAISE EXCEPTION 'Only the exact current genuine payment may be in progress; every earlier receipt must already be real settled canonical cash' USING ERRCODE='23514';END IF;
  PERFORM freeholder_controlled_cash_normalized_payment(payment_record.id);
  SELECT count(*) INTO route_count FROM merchant_agreement_payment_routes WHERE payment_id=payment_record.id;
  SELECT count(*) INTO fee_count FROM agreement_fee_cash_assignments WHERE payment_id=payment_record.id;
  SELECT count(*) INTO observation_count FROM merchant_payment_observations WHERE payment_id=payment_record.id;
  SELECT count(*) FILTER(WHERE actual_event.to_state='created'),count(*) FILTER(WHERE actual_event.to_state='processing'),count(*) FILTER(WHERE actual_event.to_state='succeeded')
   INTO created_count,processing_count,succeeded_count FROM money_state_events actual_event WHERE actual_event.subject_type='payment' AND actual_event.subject_id=payment_record.id;
  IF route_count>1 OR fee_count>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count>1 OR created_count>1 OR processing_count>1 OR succeeded_count>1
   OR payment_record.status='created' AND(processing_count<>0 OR succeeded_count<>0) OR payment_record.status='processing' AND(created_count<>1 OR processing_count<>1 OR succeeded_count<>0)
   OR payment_record.status='succeeded' AND(route_count<>1 OR fee_count<>(CASE WHEN has_duty THEN 1 ELSE 0 END) OR observation_count<>1 OR created_count<>1 OR succeeded_count<>1) THEN
   RAISE EXCEPTION 'The exact real shared payment/route/fee/observation/event prefix must be complete at settlement and unique at every stage' USING ERRCODE='23514';END IF;
  IF route_count=1 THEN PERFORM freeholder_controlled_cash_validate_route(payment_record.id);END IF;
  SELECT count(*) INTO invoice_event_count FROM money_state_events actual_event WHERE actual_event.subject_type='invoice' AND actual_event.subject_id=batch_record.invoice_id AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  SELECT count(*) INTO plan_event_count FROM money_state_events actual_event JOIN payment_plans actual_plan ON actual_plan.id=actual_event.subject_id AND actual_plan.invoice_id=batch_record.invoice_id WHERE actual_event.subject_type='payment_plan' AND actual_event.metadata->>'paymentId'=payment_record.id::text;
  IF payment_record.status='succeeded' THEN
   SELECT count(*),batch_record.invoice_before_paid_minor::numeric+coalesce(sum(prior_payment.amount_minor),0) INTO prior_count,prior_cash FROM controlled_cash_application_links prior_link
    JOIN controlled_cash_application_receipts prior_proof ON prior_proof.id=prior_link.receipt_proof_id AND prior_proof.ordinal<receipt_record.ordinal
    JOIN payments prior_payment ON prior_payment.id=prior_link.payment_id AND prior_payment.status='succeeded' WHERE prior_link.batch_id=batch_record.id;
   IF prior_count<>receipt_record.ordinal-1 OR prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric THEN RAISE EXCEPTION 'Every cumulative plan prefix must already exist as exact actual succeeded receipts before later use' USING ERRCODE='23514';END IF;
   expected_from=CASE WHEN prior_count=0 THEN batch_record.invoice_before_status WHEN prior_cash+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   expected_to=CASE WHEN prior_cash+receipt_record.amount_minor+batch_record.invoice_before_credited_minor=invoice_record.total_minor THEN 'paid' ELSE 'partially_paid' END;
   plan_from=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal-1);plan_to=freeholder_controlled_cash_plan_status(batch_record.id,receipt_record.ordinal);
   IF invoice_event_count<>(CASE WHEN expected_from IS DISTINCT FROM expected_to THEN 1 ELSE 0 END) OR plan_event_count<>(CASE WHEN plan_from IS DISTINCT FROM plan_to THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Preserve the exact shared status-change event set; a sum alone cannot supply canonical settlement history' USING ERRCODE='23514';END IF;
   settled_cash=settled_cash+receipt_record.amount_minor;settled_fee=settled_fee+receipt_record.fee_minor;settled_ids=settled_ids||jsonb_build_array(receipt_record.receipt_id);
  ELSIF invoice_event_count<>0 OR plan_event_count<>0 THEN RAISE EXCEPTION 'An unfinished receipt cannot fabricate an invoice or plan paid effect' USING ERRCODE='23514';END IF;
 END LOOP;
 IF target_receipt_uuid IS NULL AND(count_links<>count_receipts OR jsonb_array_length(settled_ids)<>count_receipts OR settled_cash IS DISTINCT FROM batch_record.expected_cash_minor::numeric OR settled_fee IS DISTINCT FROM batch_record.expected_fee_minor::numeric) THEN
  RAISE EXCEPTION 'The whole immutable real receipt batch must conserve exact cash/fee/credit and settle atomically; partial batch refusal rolls back every canonical write' USING ERRCODE='23514';END IF;
 IF target_receipt_uuid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM controlled_cash_application_links actual_link WHERE actual_link.batch_id=batch_record.id AND actual_link.receipt_id=target_receipt_uuid)
  AND count_links<>target_proof.ordinal-1 THEN RAISE EXCEPTION 'The next birth must be the exact next real receipt after a complete actual settled prefix' USING ERRCODE='23514';END IF;
 final_snapshot=freeholder_controlled_cash_parent_snapshot(batch_record.collection_id);
 IF final_snapshot->'entries' IS DISTINCT FROM normalized_parent->'currentEntries' OR final_snapshot->>'revision' IS DISTINCT FROM normalized_parent->>'currentParentRevision' THEN
  RAISE EXCEPTION 'Current external raw/financial/source evidence changed during stage verification; preserve it and refuse this money mutation' USING ERRCODE='23514';END IF;
 RETURN normalized_parent||jsonb_build_object('receiptId',target_receipt_uuid,'paymentId',target_payment_uuid,'settledReceiptIds',settled_ids,'bankRevisions',bank_revisions,'complete',target_receipt_uuid IS NULL);
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
CREATE FUNCTION freeholder_controlled_cash_atomic_fee_valid(target_payment_uuid uuid,proposed_fee bigint,proposed_prior_cash numeric,proposed_prior_fee numeric) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual_link controlled_cash_application_links%ROWTYPE; receipt_record controlled_cash_application_receipts%ROWTYPE; batch_record controlled_cash_application_batches%ROWTYPE; current_stage jsonb;
BEGIN
 SELECT * INTO actual_link FROM controlled_cash_application_links WHERE payment_id=target_payment_uuid;
 SELECT * INTO receipt_record FROM controlled_cash_application_receipts WHERE id=actual_link.receipt_proof_id;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=actual_link.batch_id;
 IF actual_link.payment_id IS NULL OR receipt_record.id IS NULL OR batch_record.id IS NULL OR batch_record.protocol IS DISTINCT FROM 'controlled_cash_atomic.v1'
  OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text OR actual_link.receipt_id IS DISTINCT FROM receipt_record.receipt_id OR receipt_record.batch_id IS DISTINCT FROM batch_record.id
  OR proposed_fee IS DISTINCT FROM receipt_record.fee_minor OR proposed_prior_cash IS DISTINCT FROM receipt_record.prior_cash_minor::numeric OR proposed_prior_fee IS DISTINCT FROM receipt_record.prior_allocated_fee_minor::numeric THEN RETURN false;END IF;
 -- The full actual current normalized parent, immutable bank/current namespace,
 -- complete receipt set, real earlier settled prefix and endpoint are required.
 -- A pointer, a copied protocol string or an intermediate floor is insufficient.
 current_stage=freeholder_controlled_cash_stage(batch_record.id,receipt_record.receipt_id,target_payment_uuid);
 RETURN coalesce(current_stage->>'batchId'=batch_record.id::text AND current_stage->>'receiptId'=receipt_record.receipt_id::text
  AND current_stage->>'paymentId'=target_payment_uuid::text AND current_stage->>'normalizedParentRevision'=batch_record.parent_pg_revision AND current_stage->>'complete'='false',false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_controlled_subscription_route_valid(proposed_route jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE pointer jsonb; batch_record controlled_cash_application_batches%ROWTYPE; receipt_proof controlled_cash_application_receipts%ROWTYPE;
 link_record controlled_cash_application_links%ROWTYPE; original_receipt subscription_provider_charge_receipts%ROWTYPE;
 origin_record subscription_controlled_charge_origins%ROWTYPE; resource_record subscription_controlled_resources%ROWTYPE; payment_record payments%ROWTYPE; stage_record jsonb;
BEGIN
 pointer=nullif(current_setting('freeholder.controlled_cash_application_batch_v1',true),'')::jsonb;
 IF pointer IS NULL OR jsonb_typeof(pointer) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(pointer))<>4
  OR NOT(pointer ?& ARRAY['batchId','collectionId','receiptId','admissionDigest'])
  OR coalesce(pointer->>'batchId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'collectionId','')!~'^[a-f0-9-]{36}$'
  OR coalesce(pointer->>'receiptId','')!~'^[a-f0-9-]{36}$' OR coalesce(pointer->>'admissionDigest','')!~'^[a-f0-9]{64}$' THEN RETURN false;END IF;
 SELECT * INTO batch_record FROM controlled_cash_application_batches WHERE id=(pointer->>'batchId')::uuid;
 SELECT * INTO receipt_proof FROM controlled_cash_application_receipts WHERE batch_id=batch_record.id AND receipt_id=(pointer->>'receiptId')::uuid;
 SELECT * INTO link_record FROM controlled_cash_application_links WHERE batch_id=batch_record.id AND receipt_proof_id=receipt_proof.id AND receipt_id=receipt_proof.receipt_id;
 SELECT * INTO original_receipt FROM subscription_provider_charge_receipts WHERE id=receipt_proof.receipt_id;
 SELECT * INTO origin_record FROM subscription_controlled_charge_origins WHERE receipt_id=original_receipt.id;
 SELECT * INTO resource_record FROM subscription_controlled_resources WHERE id=batch_record.resource_id;
 SELECT * INTO payment_record FROM payments WHERE id=link_record.payment_id;
 IF batch_record.id IS NULL OR receipt_proof.id IS NULL OR link_record.payment_id IS NULL OR original_receipt.id IS NULL OR origin_record.receipt_id IS NULL OR resource_record.id IS NULL OR payment_record.id IS NULL
  OR batch_record.protocol NOT IN('controlled_net_gross.v1','controlled_cash_atomic.v1') OR batch_record.digest IS DISTINCT FROM pointer->>'admissionDigest'
  OR batch_record.collection_id::text IS DISTINCT FROM pointer->>'collectionId' OR batch_record.admission_transaction_id IS DISTINCT FROM txid_current()::text
  OR origin_record.resource_id IS DISTINCT FROM batch_record.resource_id OR origin_record.operation_id IS DISTINCT FROM receipt_proof.origin_operation_id
  OR origin_record.call_id IS DISTINCT FROM receipt_proof.origin_call_id OR origin_record.fact_id IS DISTINCT FROM receipt_proof.origin_fact_id
  OR original_receipt.subscription_id IS DISTINCT FROM batch_record.subscription_id OR resource_record.subscription_id IS DISTINCT FROM batch_record.subscription_id
  OR original_receipt.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR original_receipt.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.invoice_id IS DISTINCT FROM batch_record.invoice_id OR payment_record.status IS DISTINCT FROM 'created'
  OR payment_record.provider IS DISTINCT FROM 'stripe' OR payment_record.method IS DISTINCT FROM 'provider_schedule'
  OR payment_record.amount_minor IS DISTINCT FROM receipt_proof.amount_minor OR payment_record.currency IS DISTINCT FROM receipt_proof.currency
  OR payment_record.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key OR payment_record.request_hash IS DISTINCT FROM receipt_proof.payment_request_hash
  OR proposed_route->>'payment_id' IS DISTINCT FROM payment_record.id::text OR proposed_route->>'subscription_id' IS DISTINCT FROM batch_record.subscription_id::text
  OR proposed_route->>'agreement_routing_version' IS DISTINCT FROM '1' OR proposed_route->>'origin_kind' IS DISTINCT FROM 'provider_schedule'
  OR proposed_route->>'original_charge_receipt_id' IS DISTINCT FROM original_receipt.id::text
  OR proposed_route->>'provider_api_version' IS DISTINCT FROM original_receipt.provider_api_version
  OR proposed_route->>'provider_platform_account_id' IS DISTINCT FROM original_receipt.provider_platform_account_id
  OR proposed_route->>'charge_account_id' IS DISTINCT FROM original_receipt.charge_account_id
  OR proposed_route->>'provider_subscription_ref' IS DISTINCT FROM original_receipt.provider_subscription_ref
  OR proposed_route->>'provider_invoice_ref' IS DISTINCT FROM original_receipt.provider_invoice_ref
  OR proposed_route->>'provider_payment_intent_ref' IS DISTINCT FROM original_receipt.provider_payment_intent_ref
  OR proposed_route->>'provider_charge_ref' IS DISTINCT FROM original_receipt.provider_charge_ref OR original_receipt.provider_charge_ref IS NULL
  OR proposed_route->>'recipient_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'destinationAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'settlement_merchant_account_id' IS DISTINCT FROM coalesce(resource_record.original_scope->>'settlementMerchantAccountId',resource_record.original_scope->>'providerAccountId')
  OR proposed_route->>'collection_kind' IS DISTINCT FROM (CASE WHEN resource_record.original_scope->>'destinationAccountId' IS NOT NULL THEN 'destination' ELSE 'direct' END)
  OR proposed_route->>'application_fee_minor' IS DISTINCT FROM receipt_proof.fee_minor::text
  OR (proposed_route->>'created_at')::timestamptz IS DISTINCT FROM now() THEN RETURN false;END IF;
 -- Real post-birth row/link, exact settled prefix, complete current PG graph and
 -- immutable returned bank proof. Never a marker-only or planned-payment grant.
 stage_record=freeholder_controlled_cash_stage(batch_record.id,receipt_proof.receipt_id,payment_record.id);
 RETURN coalesce(stage_record->>'batchId'=batch_record.id::text AND stage_record->>'collectionId'=batch_record.collection_id::text
  AND stage_record->>'receiptId'=receipt_proof.receipt_id::text AND stage_record->>'paymentId'=payment_record.id::text
  AND stage_record->>'normalizedParentRevision'=batch_record.parent_pg_revision AND stage_record->>'complete'='false',false);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_merchant_agreement_payment_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment payments%ROWTYPE; parent invoices%ROWTYPE; policy invoice_market_policies%ROWTYPE; original record; paid numeric; prior_fee numeric; duty agreement_fee_duties%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original agreement payment routing is immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO payment FROM payments WHERE id=NEW.payment_id;
 SELECT * INTO parent FROM invoices WHERE id=payment.invoice_id FOR UPDATE;
 SELECT * INTO policy FROM invoice_market_policies WHERE invoice_id=payment.invoice_id;
 SELECT scope.* INTO original FROM subscription_merchant_scopes scope JOIN subscriptions s ON s.id=scope.subscription_id
  WHERE scope.subscription_id=NEW.subscription_id AND s.merchant_scope_version=1;
 IF payment.id IS NULL OR parent.id IS NULL OR original.subscription_id IS NULL OR parent.source_type IS DISTINCT FROM 'subscription'
  OR split_part(parent.source_id,':',1) IS DISTINCT FROM NEW.subscription_id::text OR policy.invoice_id IS NULL OR policy.model IS DISTINCT FROM 'seller_merchant'
  OR payment.currency IS DISTINCT FROM parent.currency
  OR payment.provider<>'stripe' OR payment.status<>'created' OR payment.method NOT IN('hosted_checkout','saved_method','provider_schedule')
  OR NEW.collection_kind IS DISTINCT FROM original.collection_kind OR NEW.provider_platform_account_id IS DISTINCT FROM original.provider_platform_account_id
  OR NEW.charge_account_id IS DISTINCT FROM original.charge_account_id OR NEW.recipient_account_id IS DISTINCT FROM original.recipient_account_id
  OR NEW.settlement_merchant_account_id IS DISTINCT FROM original.settlement_merchant_account_id
  OR(NEW.origin_kind='provider_schedule') IS DISTINCT FROM(payment.method='provider_schedule')
  OR(NEW.origin_kind='provider_schedule' AND NEW.provider_api_version IS DISTINCT FROM original.provider_schedule_api_version)
  OR(NEW.origin_kind='provider_schedule' AND NOT EXISTS(SELECT 1 FROM subscription_provider_charge_receipts receipt WHERE receipt.id=NEW.original_charge_receipt_id
   AND receipt.subscription_id=NEW.subscription_id AND receipt.provider_platform_account_id=NEW.provider_platform_account_id AND receipt.charge_account_id IS NOT DISTINCT FROM NEW.charge_account_id
   AND receipt.provider_api_version=NEW.provider_api_version AND receipt.provider_subscription_ref=NEW.provider_subscription_ref AND receipt.provider_invoice_ref=NEW.provider_invoice_ref
   AND receipt.provider_payment_intent_ref=NEW.provider_payment_intent_ref AND receipt.provider_charge_ref=NEW.provider_charge_ref AND receipt.amount_minor=payment.amount_minor AND receipt.currency=payment.currency))
  OR EXISTS(SELECT 1 FROM merchant_payment_observations o JOIN payments p ON p.id=o.payment_id WHERE p.invoice_id=payment.invoice_id AND o.status='succeeded' AND(p.status<>'succeeded' OR o.amount_minor<>p.amount_minor OR o.currency<>p.currency OR(o.provider_ref IS DISTINCT FROM p.provider_ref AND o.provider_ref IS DISTINCT FROM p.provider_checkout_ref)))
  OR NEW.application_fee_minor>payment.amount_minor
  OR EXISTS(SELECT 1 FROM payment_merchant_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM merchant_payment_routes WHERE payment_id=NEW.payment_id)
  OR EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=payment.invoice_id AND p.id<>payment.id AND p.status IN('created','processing')) THEN
  RAISE EXCEPTION 'Bind each new agreement payment to its immutable original merchant namespace.' USING ERRCODE='23514';
 END IF;
 IF split_part(parent.source_id,':',2)='proration' THEN
  SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=parent.id;
  SELECT coalesce(sum(p.amount_minor),0),coalesce(sum(coalesce(a.fee_owed_minor,g.application_fee_minor)),0) INTO paid,prior_fee FROM payments p
   LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id
   WHERE p.invoice_id=parent.id AND p.status='succeeded';
  IF duty.invoice_id IS NULL OR (NEW.origin_kind<>'attempt' AND NOT freeholder_controlled_subscription_route_valid(to_jsonb(NEW))) OR duty.total_minor<>parent.total_minor OR duty.credited_minor<>parent.credited_minor OR duty.target_fee_minor<>policy.fee_minor
   OR duty.cash_principal_minor<=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>duty.cash_principal_minor
   OR(NOT freeholder_controlled_cash_atomic_fee_valid(payment.id,NEW.application_fee_minor,paid,prior_fee) AND(
    prior_fee<>floor(duty.cash_fee_target_minor::numeric*paid/duty.cash_principal_minor)
    OR NEW.application_fee_minor<>floor(duty.cash_fee_target_minor::numeric*(paid+payment.amount_minor)/duty.cash_principal_minor)-prior_fee))
   OR EXISTS(SELECT 1 FROM payments p LEFT JOIN commercial_payment_attestations a ON a.payment_id=p.id LEFT JOIN merchant_agreement_payment_routes g ON g.payment_id=p.id WHERE p.invoice_id=parent.id AND p.status='succeeded'
    AND((a.payment_id IS NOT NULL)::integer+(g.payment_id IS NOT NULL)::integer<>1 OR p.refunded_minor<>0)) THEN
   RAISE EXCEPTION 'Bind only the physically bounded original gross-target fee while preserving its separately frozen merchant receivable and actual source assignments' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT COALESCE(sum(p.amount_minor),0),COALESCE(sum(r.application_fee_minor),0) INTO paid,prior_fee
 FROM payments p JOIN merchant_agreement_payment_routes r ON r.payment_id=p.id WHERE p.invoice_id=payment.invoice_id AND p.status='succeeded';
 IF parent.total_minor=0 OR paid<>parent.paid_minor OR paid+payment.amount_minor>parent.total_minor
  OR(NOT freeholder_controlled_cash_atomic_fee_valid(payment.id,NEW.application_fee_minor,paid,prior_fee) AND(
   prior_fee<>floor(policy.fee_minor::numeric*paid/parent.total_minor)
   OR NEW.application_fee_minor<>floor(policy.fee_minor::numeric*(paid+payment.amount_minor)/parent.total_minor)-prior_fee)) THEN
  RAISE EXCEPTION 'The original agreement payment and application fee must conserve every invoice cent.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeholder_guard_agreement_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE duty agreement_fee_duties%ROWTYPE;i invoices%ROWTYPE;a subscription_prorations%ROWTYPE;p payments%ROWTYPE;x invoice_credit_applications%ROWTYPE;r invoice_credit_reservations%ROWTYPE;
 prior_cash numeric;prior_fee numeric;current_state record;
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('freeholder.agreement_fee_v1',true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Original commission duty, assignments, eligibility and actual remittances are immutable guarded receipts' USING ERRCODE='23514';END IF;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id;
 IF TG_TABLE_NAME='agreement_fee_duties' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=NEW.acceptance_id;
  IF a.id IS NULL OR a.state<>'accepted' OR a.original_trial_ends_at IS NOT NULL OR a.debit_invoice_id IS DISTINCT FROM i.id OR i.source_type<>'subscription' OR i.source_id<>a.subscription_id::text||':proration:'||a.id::text
   OR i.currency<>NEW.currency OR i.total_minor<>NEW.total_minor OR i.credited_minor<>NEW.credited_minor OR i.paid_minor<>0 OR i.status IN('draft','void')
   OR NEW.merchant_profile_id<>a.profile_id OR NEW.profile_version<>a.profile_version OR NEW.accepted_quote_digest<>a.accepted_quote_digest OR NEW.target_fee_minor<>a.debit_fee_obligation_minor OR NEW.carried_fee_minor<>a.applied_fee_obligation_minor
   OR NOT EXISTS(SELECT 1 FROM invoice_market_policies m WHERE m.invoice_id=i.id AND m.model='seller_merchant' AND m.fee_minor=NEW.target_fee_minor)
   OR(SELECT count(*) FROM invoice_lines WHERE invoice_id=i.id)<>1 THEN RAISE EXCEPTION 'Freeze one exact accepted target commission epoch before collection, without rewriting an old or order-v1 policy' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO duty FROM agreement_fee_duties WHERE invoice_id=NEW.invoice_id;
 IF duty.invoice_id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'Restore the exact original accepted commission duty before its children' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='agreement_fee_credit_assignments' THEN
  SELECT * INTO x FROM invoice_credit_applications WHERE reservation_id=NEW.application_id;SELECT * INTO r FROM invoice_credit_reservations WHERE id=x.reservation_id;
  IF x.reservation_id IS NULL OR x.invoice_id<>i.id OR r.target_source_id<>i.source_id OR NEW.amount_minor<>r.amount_minor OR NEW.fee_obligation_minor<>x.fee_obligation_minor OR NEW.proven_collected_minor<>x.fee_proven_collected_minor OR x.fee_evidence_digest IS NULL THEN
   RAISE EXCEPTION 'Each carried commission assignment retains its exact actual application and original fee proof' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_cash_assignments' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  IF p.id IS NULL OR p.invoice_id<>i.id OR p.status<>'created' OR p.currency<>duty.currency OR NEW.amount_minor<>p.amount_minor OR freeholder_original_payment_fee(p.id) IS DISTINCT FROM NEW.fee_obligation_minor
   OR(NEW.origin='recorded_external' AND(p.provider<>'manual' OR NOT EXISTS(SELECT 1 FROM commercial_payment_attestations WHERE payment_id=p.id)))
   OR(NEW.origin='provider' AND(p.provider<>'stripe' OR NOT EXISTS(SELECT 1 FROM merchant_agreement_payment_routes WHERE payment_id=p.id))) THEN
   RAISE EXCEPTION 'A physical fee assignment needs its exact real principal attempt and one original provider route or external attestation' USING ERRCODE='23514';END IF;
  SELECT coalesce(sum(q.amount_minor),0),coalesce(sum(c.fee_obligation_minor),0) INTO prior_cash,prior_fee FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND q.status='succeeded';
  IF duty.cash_principal_minor<=0 OR prior_cash<>i.paid_minor OR prior_cash+p.amount_minor>duty.cash_principal_minor
   OR(NOT freeholder_controlled_cash_atomic_fee_valid(p.id,NEW.fee_obligation_minor,prior_cash,prior_fee) AND(
    prior_fee<>floor(duty.cash_fee_target_minor::numeric*prior_cash/duty.cash_principal_minor)
    OR NEW.fee_obligation_minor<>floor(duty.cash_fee_target_minor::numeric*(prior_cash+p.amount_minor)/duty.cash_principal_minor)-prior_fee))
   OR EXISTS(SELECT 1 FROM payments q LEFT JOIN agreement_fee_cash_assignments c ON c.payment_id=q.id WHERE q.invoice_id=i.id AND q.id<>p.id AND(q.status IN('created','processing')OR(q.status='succeeded' AND(c.payment_id IS NULL OR q.refunded_minor<>0)))) THEN
   RAISE EXCEPTION 'Preserve complete original cash assignments and cumulative physical-fee residuals within the actual cash cap' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_eligibility' THEN
  SELECT * INTO a FROM subscription_prorations WHERE id=duty.acceptance_id;
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR i.status<>'paid' OR i.paid_at IS NULL OR NEW.paid_at<>i.paid_at OR i.paid_at>a.effective_at OR i.refunded_minor<>0 OR i.paid_minor+i.credited_minor<>i.total_minor
   OR NEW.cash_payment_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(eligible_payment.id::text ORDER BY eligible_payment.id) FROM payments eligible_payment WHERE eligible_payment.invoice_id=i.id AND eligible_payment.status='succeeded'),'[]'::jsonb)
   OR NEW.credit_application_ids IS DISTINCT FROM coalesce((SELECT jsonb_agg(c.application_id::text ORDER BY c.application_id) FROM agreement_fee_credit_assignments c WHERE c.invoice_id=i.id),'[]'::jsonb) THEN
   RAISE EXCEPTION 'Only authentic full canonical consideration in the accepted window establishes eligibility; it never proves commission remittance' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='agreement_fee_remittances' THEN
  SELECT * INTO current_state FROM freeholder_agreement_fee_current(i.id);
  IF NOT current_state.known OR NOT current_state.eligible OR NEW.currency<>duty.currency THEN RAISE EXCEPTION 'Resolve complete actual cash and noncash disposition before attesting commission money' USING ERRCODE='23514';END IF;
  IF NEW.direction='remitted' AND current_state.recorded+NEW.amount_minor>current_state.owed THEN RAISE EXCEPTION 'An actual remittance cannot exceed the current original whole-consideration receivable' USING ERRCODE='23514';END IF;
  IF NEW.direction='returned' AND NOT EXISTS(SELECT 1 FROM agreement_fee_remittances f WHERE f.id=NEW.original_remittance_id AND f.invoice_id=i.id AND f.direction='remitted'
   AND coalesce((SELECT sum(q.amount_minor) FROM agreement_fee_remittances q WHERE q.original_remittance_id=f.id),0)+NEW.amount_minor<=f.amount_minor) THEN
   RAISE EXCEPTION 'An actual commission return names its exact original bounded remittance receipt' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Unknown original commission receipt family' USING ERRCODE='23514';END IF;
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
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='merchant_agreement_payment_route_guard' AND t.tgfoid=to_regprocedure('guard_merchant_agreement_payment_route()') AND t.tgenabled IN('O','A') AND t.tgtype=31 AND NOT t.tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='merchant_agreement_payment_routes'::regclass AND t.tgname='subscription_controlled_agreement_route_guard' AND t.tgfoid=to_regprocedure('guard_subscription_controlled_agreement_route()') AND t.tgenabled IN('O','A') AND t.tgtype=23 AND NOT t.tgisinternal),false);
$$;
