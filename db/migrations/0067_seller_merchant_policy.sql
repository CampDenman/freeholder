-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: merchant routing is immutable once an invoice is issued.
CREATE TABLE invoice_market_policies (
 invoice_id uuid PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
 model text NOT NULL,
 adapter text NOT NULL,
 site_fee_bps integer NOT NULL,
 hold_days integer NOT NULL,
 fee_minor bigint NOT NULL DEFAULT 0,
 seller_user_id uuid,
 merchant_name text,
 provider_account_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_market_policies_model_check CHECK (model IN ('hold','instant','seller_merchant')),
 CONSTRAINT invoice_market_policies_fee_bps_check CHECK (site_fee_bps BETWEEN 0 AND 10000),
 CONSTRAINT invoice_market_policies_hold_days_check CHECK (hold_days BETWEEN 0 AND 365),
 CONSTRAINT invoice_market_policies_fee_check CHECK (fee_minor >= 0),
 CONSTRAINT invoice_market_policies_merchant_check CHECK (model <> 'seller_merchant' OR
  (adapter='stripe_connect' AND seller_user_id IS NOT NULL AND merchant_name IS NOT NULL AND provider_account_id IS NOT NULL))
);
--> statement-breakpoint
-- Existing invoices were issued under platform collection. They must not
-- become seller charges when the owner later changes the site's default.
INSERT INTO invoice_market_policies(invoice_id,model,adapter,site_fee_bps,hold_days,fee_minor)
SELECT i.id, CASE WHEN s.payout_model='instant' THEN 'instant' ELSE 'hold' END,
 COALESCE(s.payout_adapter,'manual'), COALESCE(s.site_fee_bps,0), COALESCE(s.hold_days,14),
 floor((i.total_minor-i.tax_minor)::numeric*COALESCE(s.site_fee_bps,0)/10000)::bigint
FROM invoices i LEFT JOIN member_settings s ON s.id=1 WHERE i.status <> 'draft';
--> statement-breakpoint
-- No historical transfer-only account is assumed able to accept charges.
ALTER TABLE member_payout_accounts ADD COLUMN charges_ready boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE member_payout_accounts ADD COLUMN merchant_name text;
--> statement-breakpoint
CREATE TABLE payment_merchant_routes (
 payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
 provider_account_id text NOT NULL,
 application_fee_minor bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT payment_merchant_routes_account_check CHECK (provider_account_id ~ '^acct_[A-Za-z0-9]+$'),
 CONSTRAINT payment_merchant_routes_fee_check CHECK (application_fee_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE payment_provider_customers ADD COLUMN provider_account_id text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE payment_methods ADD COLUMN provider_account_id text NOT NULL DEFAULT '';
--> statement-breakpoint
DROP INDEX payment_provider_customers_ref_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX payment_provider_customers_ref_idx ON payment_provider_customers(provider,provider_account_id,provider_customer_ref);
--> statement-breakpoint
DROP INDEX payment_methods_provider_ref_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX payment_methods_provider_ref_idx ON payment_methods(provider,provider_account_id,provider_method_ref);
--> statement-breakpoint
DROP INDEX payment_methods_customer_ref_idx;
--> statement-breakpoint
CREATE INDEX payment_methods_customer_ref_idx ON payment_methods(provider,provider_account_id,provider_customer_ref);
--> statement-breakpoint
CREATE TABLE subscription_market_policies (
 subscription_id uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
 model text NOT NULL,
 adapter text NOT NULL,
 site_fee_bps integer NOT NULL,
 hold_days integer NOT NULL,
 seller_user_id uuid,
 merchant_name text,
 provider_account_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT subscription_market_policies_model_check CHECK (model IN ('hold','instant','seller_merchant')),
 CONSTRAINT subscription_market_policies_fee_bps_check CHECK (site_fee_bps BETWEEN 0 AND 10000),
 CONSTRAINT subscription_market_policies_hold_days_check CHECK (hold_days BETWEEN 0 AND 365),
 CONSTRAINT subscription_market_policies_merchant_check CHECK (model <> 'seller_merchant' OR
  (adapter='stripe_connect' AND seller_user_id IS NOT NULL AND merchant_name IS NOT NULL AND provider_account_id IS NOT NULL))
);
--> statement-breakpoint
-- Existing member agreements, including trials without invoices, remain
-- platform-collected. No migration invents connected-account authority.
INSERT INTO subscription_market_policies(subscription_id,model,adapter,site_fee_bps,hold_days,seller_user_id)
SELECT a.id,CASE WHEN s.payout_model='instant' THEN 'instant' ELSE 'hold' END,
 COALESCE(s.payout_adapter,'manual'),COALESCE(s.site_fee_bps,0),COALESCE(s.hold_days,14),p.seller_user_id
FROM subscriptions a JOIN plans plan ON plan.id=a.plan_id
JOIN products p ON p.id=plan.product_id
LEFT JOIN member_settings s ON s.id=1 WHERE p.seller_user_id IS NOT NULL;
