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
