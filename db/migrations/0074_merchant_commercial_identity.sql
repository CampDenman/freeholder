-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
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
