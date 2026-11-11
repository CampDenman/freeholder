-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.42: owner-pinned public verification keys; no signing secrets.
CREATE TABLE plugin_publisher_keys (
 key_id text PRIMARY KEY CHECK (key_id ~ '^[a-f0-9]{64}$'),
 publisher text NOT NULL,
 public_key text NOT NULL,
 trusted_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
--> statement-breakpoint
ALTER TABLE plugin_registries ADD COLUMN publisher_key_id text REFERENCES plugin_publisher_keys(key_id);
--> statement-breakpoint
ALTER TABLE installed_plugins ADD COLUMN previous_artifact jsonb;
--> statement-breakpoint
-- Reverify all existing registrations under the unambiguous artifact hash.
-- Caller-supplied HMAC secrets never established a trusted publisher.
UPDATE installed_plugins SET status='disabled',
 disabled_reason='Review this artifact again with an owner-trusted Ed25519 signature before enabling it.',
 updated_at=now();
