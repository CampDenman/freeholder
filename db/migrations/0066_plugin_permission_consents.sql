-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.40: old installation/signature approval is not permission consent.
CREATE TABLE plugin_permission_consents (
 name text PRIMARY KEY,
 scope_hash text NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
 permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
 reviewed_version text NOT NULL,
 approved_by text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 runtime_disabled_at timestamptz,
 disabled_reason text
);
--> statement-breakpoint
UPDATE installed_plugins SET status='disabled',
 disabled_reason='Review and approve this plugin permission list before enabling it.',
 updated_at=now();
--> statement-breakpoint
-- Existing accepted work keeps every intended listener. New events remember
-- which inactive plugin subscribers were deliberately not enrolled.
ALTER TABLE outbox_events ADD COLUMN inactive_plugin_listeners jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(inactive_plugin_listeners) = 'array');
