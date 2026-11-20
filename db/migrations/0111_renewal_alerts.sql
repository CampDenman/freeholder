-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.40 Renewal alerts: a register of third-party charges, and a record of
-- every warning given about one.
--
-- Additive only. Two new tables, no change to anything that exists, so an
-- instance that never enables the module carries two empty tables and nothing
-- else. Not schema-breaking.
--
-- The unique index on (subscription_id, renewal_at) is the product rule, not
-- an optimisation: one alert per charge, enforced by the database. Deciding
-- that by comparing a last_alert_sent timestamp against a window derived from
-- the renewal date and the lead time double-sends and goes silent at the
-- boundaries, and leaves nothing to point at afterwards.
CREATE TABLE tracked_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 name text NOT NULL,
 cost_minor bigint NOT NULL,
 currency text NOT NULL DEFAULT 'USD',
 cycle text NOT NULL DEFAULT 'monthly' CHECK(cycle IN ('monthly','annual','custom')),
 custom_interval_days integer,
 first_charge_at timestamptz NOT NULL,
 next_renewal_at timestamptz NOT NULL,
 alert_days integer NOT NULL DEFAULT 3,
 notes text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX tracked_subscriptions_contact_idx ON tracked_subscriptions(contact_id);
--> statement-breakpoint
CREATE INDEX tracked_subscriptions_due_idx ON tracked_subscriptions(status,next_renewal_at);
--> statement-breakpoint
CREATE TABLE renewal_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES tracked_subscriptions(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 renewal_at timestamptz NOT NULL,
 days_ahead integer NOT NULL,
 mail_delivery_id uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX renewal_alerts_subscription_renewal_key ON renewal_alerts(subscription_id,renewal_at);
--> statement-breakpoint
CREATE INDEX renewal_alerts_contact_idx ON renewal_alerts(contact_id);
