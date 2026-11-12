-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- freeholder:schema-breaking New merchant documents require contact-owned identity and merge witnesses. Prior writers refuse ambiguous financial ownership and incomplete personal-copy erasure. Restore the pre-upgrade database and objects for full rollback.
-- C12.38: deliberately public support data is refreshed at the account and
-- frozen separately for each original agreement/invoice. Historical documents
-- receive no guessed support details from today's account.
ALTER TABLE member_payout_accounts ADD COLUMN merchant_support jsonb;
--> statement-breakpoint
ALTER TABLE subscription_market_policies ADD COLUMN merchant_support jsonb;
--> statement-breakpoint
ALTER TABLE invoice_market_policies ADD COLUMN merchant_support jsonb;
--> statement-breakpoint
ALTER TABLE invoice_market_policies ADD COLUMN merchant_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE subscription_market_policies ADD COLUMN merchant_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT;
--> statement-breakpoint
-- Identity ownership follows the existing unique login→contact spine. Public
-- commercial values remain historical: never copy today's support data back.
UPDATE invoice_market_policies p SET merchant_contact_id=c.id FROM contacts c WHERE p.seller_user_id=c.user_id;
--> statement-breakpoint
UPDATE subscription_market_policies p SET merchant_contact_id=c.id FROM contacts c WHERE p.seller_user_id=c.user_id;
--> statement-breakpoint
CREATE INDEX invoice_market_policies_merchant_contact_idx ON invoice_market_policies(merchant_contact_id);
--> statement-breakpoint
CREATE INDEX subscription_market_policies_merchant_contact_idx ON subscription_market_policies(merchant_contact_id);
--> statement-breakpoint
-- An already-deleted login has no owner to bind. Remove that orphaned public
-- personal copy rather than reconstructing a name from a current account.
UPDATE invoice_market_policies p SET merchant_name='[privacy-erased-merchant]' WHERE p.model='seller_merchant' AND p.seller_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=p.seller_user_id);
--> statement-breakpoint
UPDATE subscription_market_policies p SET merchant_name='[privacy-erased-merchant]' WHERE p.model='seller_merchant' AND p.seller_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=p.seller_user_id);
--> statement-breakpoint
-- Pre74 history cannot reconstruct the original owner of this new pointer.
-- Keep the actual current owner; do not invent before-state hashes for undo.
UPDATE contact_merge_operations m SET undoable=false,
 undo_blockers=array_append(m.undo_blockers,'Merchant document ownership was introduced after this merge; restore the pre-upgrade snapshot to separate it safely.')
WHERE m.undone_at IS NULL AND (
 (EXISTS(SELECT 1 FROM invoice_market_policies p WHERE p.merchant_contact_id IN(m.duplicate_contact_id,m.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.reference_state) e WHERE e->>'table'='invoice_market_policies'))
 OR
 (EXISTS(SELECT 1 FROM subscription_market_policies p WHERE p.merchant_contact_id IN(m.duplicate_contact_id,m.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.reference_state) e WHERE e->>'table'='subscription_market_policies'))
);
--> statement-breakpoint
CREATE FUNCTION guard_merchant_document_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.model='seller_merchant' AND NEW.merchant_contact_id IS NULL AND NEW.merchant_name<>'[privacy-erased-merchant]' THEN
  RAISE EXCEPTION 'A new merchant document requires its original contact owner.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_merchant_document_owner BEFORE INSERT ON invoice_market_policies
 FOR EACH ROW EXECUTE FUNCTION guard_merchant_document_owner();
--> statement-breakpoint
CREATE TRIGGER agreement_merchant_document_owner BEFORE INSERT ON subscription_market_policies
 FOR EACH ROW EXECUTE FUNCTION guard_merchant_document_owner();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_merge_witness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (
  EXISTS(SELECT 1 FROM invoice_market_policies p WHERE p.merchant_contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='invoice_market_policies')
 ) OR (
  EXISTS(SELECT 1 FROM subscription_market_policies p WHERE p.merchant_contact_id IN(NEW.duplicate_contact_id,NEW.surviving_contact_id))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.reference_state) e WHERE e->>'table'='subscription_market_policies')
 ) THEN
  RAISE EXCEPTION 'This contact merge requires its original merchant document witness.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_document_merge_witness BEFORE INSERT ON contact_merge_operations
 FOR EACH ROW EXECUTE FUNCTION guard_merchant_merge_witness();
--> statement-breakpoint
CREATE FUNCTION guard_merchant_privacy_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='erasure' AND NEW.status IN('completed','partially_completed')
 AND NOT EXISTS(SELECT 1 FROM privacy_retention_exceptions h JOIN data_requests held_request ON held_request.id=h.data_request_id WHERE held_request.contact_id=NEW.contact_id
  AND h.scope IN('members.merchantIdentity','members','commerce.money') AND length(trim(h.legal_basis))>0
  AND (h.expires_at IS NULL OR h.expires_at>clock_timestamp()))
 AND (
  EXISTS(SELECT 1 FROM invoice_market_policies p WHERE p.merchant_contact_id=NEW.contact_id
   AND (p.merchant_support IS NOT NULL OR (p.merchant_name IS NOT NULL AND p.merchant_name<>'[privacy-erased-merchant]')))
  OR EXISTS(SELECT 1 FROM subscription_market_policies p WHERE p.merchant_contact_id=NEW.contact_id
   AND (p.merchant_support IS NOT NULL OR (p.merchant_name IS NOT NULL AND p.merchant_name<>'[privacy-erased-merchant]')))
 ) THEN
  RAISE EXCEPTION 'Original merchant commercial identity erasure is still incomplete.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER merchant_document_privacy_completion BEFORE UPDATE ON data_requests
 FOR EACH ROW EXECUTE FUNCTION guard_merchant_privacy_completion();
