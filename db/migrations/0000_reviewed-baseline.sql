-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Reviewed baseline (C10.19). One migration replaces the pre-1.0 0000–0167
-- chain. Sibling 0168_* first-party plugin migrations are not on this branch
-- and must be folded in when those PRs land.
--
-- freeholder:schema-breaking one-time pre-1.0 collapse of 0000-0167; the N-1 upgrade gate loses its chain-apply anchor and image-swap rollback against the previous journal is broken once
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"adapter" text,
	"model" text,
	"credential_ref" text,
	"base_url" text,
	"input_cents_per_million" integer,
	"output_cents_per_million" integer,
	"max_concurrency" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"brief_template" text NOT NULL,
	"params_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brief_template" text NOT NULL,
	"default_agent_id" uuid,
	"params_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"schedule_cron" text,
	"timezone" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"catch_up" boolean DEFAULT false NOT NULL,
	"last_outcome" text,
	"event_pattern" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"autonomy_ceiling" text,
	"budget_cents" integer,
	"reports_to_briefing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"root_id" uuid NOT NULL,
	"agent_id" uuid,
	"title" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_trust" text DEFAULT 'owner' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"depends_on" uuid[] DEFAULT '{}' NOT NULL,
	"due_at" timestamp with time zone,
	"autonomy_ceiling" text,
	"budget_cents" integer,
	"result" jsonb,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by_actor" text NOT NULL,
	"source" text DEFAULT 'human' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"api_key_id" uuid,
	"tool_scopes" text[] DEFAULT '{}' NOT NULL,
	"autonomy" text DEFAULT 'suggest' NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"budget_period" text DEFAULT 'month' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"device_hash" text,
	"network_hash" text,
	"device_label" text NOT NULL,
	"ip_hint" text,
	"reason" text,
	"notice_status" text DEFAULT 'not_needed' NOT NULL,
	"notice_attempts" integer DEFAULT 0 NOT NULL,
	"notice_error" text,
	"notice_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"role_key" text NOT NULL,
	"module" text NOT NULL,
	"access" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_role_module_pk" PRIMARY KEY("role_key","module")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"assignable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"device_hash" text,
	"network_hash" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_verified_at" timestamp with time zone,
	"step_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"delivery_adapter" text,
	"provider_ref" text,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_secret" text NOT NULL,
	"last_used_step" integer,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"challenge" text,
	"pending_secret" text,
	"ip_hint" text,
	"user_agent" text,
	"device_hash" text,
	"network_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text NOT NULL,
	"otp_secret" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefing_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"briefing_id" uuid NOT NULL,
	"key" text NOT NULL,
	"source" text DEFAULT 'core' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"severity" text DEFAULT 'changed' NOT NULL,
	"playbook_run_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefing_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"status" text DEFAULT 'assembling' NOT NULL,
	"assembled_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" text NOT NULL,
	"freeholder_range" text,
	"declared_scopes" text[] DEFAULT '{}' NOT NULL,
	"author" text,
	"license" text,
	"document" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_entries_kind_valid" CHECK ("catalogue_entries"."kind" in ('playbook', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "catalogue_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid,
	"source_url" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"checksum" text NOT NULL,
	"installed_id" uuid,
	"installed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" uuid,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_connection_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"kind" text DEFAULT 'personal' NOT NULL,
	"scopes_granted" text[] DEFAULT '{}' NOT NULL,
	"credentials" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"shared_with_business" boolean DEFAULT false NOT NULL,
	"detail_visibility" text DEFAULT 'busy_only' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"scope_string" text,
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"timezone" text,
	"role" text DEFAULT 'busy_source' NOT NULL,
	"sync_token" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_calendar_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"busy" boolean DEFAULT true NOT NULL,
	"title" text,
	"booking_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_merge_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"surviving_contact_id" uuid NOT NULL,
	"duplicate_contact_id" uuid NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"duplicate_before" jsonb NOT NULL,
	"survivor_after" jsonb NOT NULL,
	"reference_state" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"undoable" boolean DEFAULT true NOT NULL,
	"undo_blockers" text[] DEFAULT '{}' NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_contact_id" uuid NOT NULL,
	"to_contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"since" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_relationships_not_self" CHECK ("contact_relationships"."from_contact_id" <> "contact_relationships"."to_contact_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"phone_status" text DEFAULT 'unknown' NOT NULL,
	"phone_invalid_at" timestamp with time zone,
	"phone_invalid_reason" text,
	"phone_invalid_provider_code" text,
	"org_id" uuid,
	"source" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lifecycle_stage" text DEFAULT 'lead' NOT NULL,
	"preferred_locale" text,
	"timezone" text,
	"country" text,
	"owner_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_phone_state_consistent" CHECK (("contacts"."phone_status" = 'invalid' and "contacts"."phone_invalid_at" is not null)
        or ("contacts"."phone_status" <> 'invalid' and "contacts"."phone_invalid_at" is null
          and "contacts"."phone_invalid_reason" is null and "contacts"."phone_invalid_provider_code" is null)),
	CONSTRAINT "contacts_phone_status_allowed" CHECK ("contacts"."phone_status" in ('unknown', 'valid', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"help_text" text,
	"options" text[] DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"locale" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_a_id" uuid,
	"contact_b_id" uuid,
	"contact_a_name" text NOT NULL,
	"contact_a_email" text,
	"contact_b_name" text NOT NULL,
	"contact_b_email" text,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"event_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribute_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"hub_enabled" boolean DEFAULT false NOT NULL,
	"hub_url" text DEFAULT 'https://freeholder.ai' NOT NULL,
	"receive_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribute_settings_singleton" CHECK ("contribute_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "contribution_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"reporter_email" text,
	"reporter_name" text,
	"external_url" text,
	"hub_receipt_id" uuid,
	"spoke_id" uuid,
	"reply_url" text,
	"reply_token" text,
	"content_hash" text NOT NULL,
	"include_doctor" boolean DEFAULT false NOT NULL,
	"doctor_report" jsonb,
	"platform_version" text,
	"dco_attested" boolean DEFAULT false NOT NULL,
	"dco_signer" text,
	"checklist_id" text,
	"parent_id" uuid,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributions_title_len" CHECK (char_length("contributions"."title") between 1 and 200),
	CONSTRAINT "contributions_body_len" CHECK (char_length("contributions"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "demo_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"contribution_key" text NOT NULL,
	"contribution_version" integer NOT NULL,
	"fixture_key" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_records_generation_positive" CHECK ("demo_records"."generation" > 0),
	CONSTRAINT "demo_records_contribution_version_positive" CHECK ("demo_records"."contribution_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_key" text NOT NULL,
	"scenario_version" integer NOT NULL,
	"locale" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_scenario_runs_generation_positive" CHECK ("demo_scenario_runs"."generation" > 0),
	CONSTRAINT "demo_scenario_runs_status_valid" CHECK ("demo_scenario_runs"."status" in ('active', 'purged')),
	CONSTRAINT "demo_scenario_runs_purge_consistent" CHECK (("demo_scenario_runs"."status" = 'purged' and "demo_scenario_runs"."purged_at" is not null) or ("demo_scenario_runs"."status" = 'active' and "demo_scenario_runs"."purged_at" is null))
);
--> statement-breakpoint
CREATE TABLE "demo_scenarios" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title_key" text NOT NULL,
	"description_key" text NOT NULL,
	"preset" text NOT NULL,
	"required_modules" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"fixture_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_locale" text NOT NULL,
	"supported_locales" text[] NOT NULL,
	"tour_flow_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_scenarios_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "demo_scenarios_version_positive" CHECK ("demo_scenarios"."version" > 0),
	CONSTRAINT "demo_scenarios_status_valid" CHECK ("demo_scenarios"."status" in ('draft', 'active', 'retired')),
	CONSTRAINT "demo_scenarios_fixture_manifest_array" CHECK (jsonb_typeof("demo_scenarios"."fixture_manifest") = 'array')
);
--> statement-breakpoint
CREATE TABLE "design_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"font_sans" text,
	"font_mono" text,
	"radius" text,
	"motion" text,
	"measure" text,
	"gutter" text,
	"logo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_settings_singleton" CHECK ("design_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "content_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"source_subscription_id" uuid,
	"source_pass_balance_id" uuid,
	"source_unlock_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grants_used_nonnegative" CHECK ("entitlement_grants"."used" >= 0),
	CONSTRAINT "entitlement_grants_window" CHECK ("entitlement_grants"."ends_at" is null or "entitlement_grants"."ends_at" > "entitlement_grants"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grantor_type" text NOT NULL,
	"grantor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"resource" jsonb NOT NULL,
	"quantity" integer,
	"period" text DEFAULT 'total' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_quantity_positive" CHECK ("entitlements"."quantity" is null or "entitlements"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pass_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"quantity_original" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"source_order_id" uuid,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pass_balances_original_positive" CHECK ("pass_balances"."quantity_original" >= 1),
	CONSTRAINT "pass_balances_remaining_nonnegative" CHECK ("pass_balances"."quantity_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event_deliveries" (
	"event_id" uuid NOT NULL,
	"listener_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_deliveries_pk" PRIMARY KEY("event_id","listener_id"),
	CONSTRAINT "outbox_event_deliveries_status_check" CHECK ("outbox_event_deliveries"."status" in ('pending', 'processing', 'delivered', 'dead_letter')),
	CONSTRAINT "outbox_event_deliveries_attempts_nonnegative" CHECK ("outbox_event_deliveries"."attempts" >= 0),
	CONSTRAINT "outbox_event_deliveries_listener_not_blank" CHECK (length(trim("outbox_event_deliveries"."listener_id")) > 0),
	CONSTRAINT "outbox_event_deliveries_processing_lease_check" CHECK ("outbox_event_deliveries"."status" <> 'processing' or "outbox_event_deliveries"."lease_expires_at" is not null),
	CONSTRAINT "outbox_event_deliveries_delivered_timestamp_check" CHECK ("outbox_event_deliveries"."status" <> 'delivered' or "outbox_event_deliveries"."delivered_at" is not null),
	CONSTRAINT "outbox_event_deliveries_dead_letter_timestamp_check" CHECK ("outbox_event_deliveries"."status" <> 'dead_letter' or "outbox_event_deliveries"."dead_lettered_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "outbox_events_attempts_nonnegative" CHECK ("outbox_events"."attempts" >= 0),
	CONSTRAINT "outbox_events_replay_count_nonnegative" CHECK ("outbox_events"."replay_count" >= 0),
	CONSTRAINT "outbox_events_dispatched_timestamp_check" CHECK ("outbox_events"."status" <> 'dispatched' or "outbox_events"."dispatched_at" is not null),
	CONSTRAINT "outbox_events_dead_letter_timestamp_check" CHECK ("outbox_events"."status" <> 'dead_letter' or "outbox_events"."dead_lettered_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "guidance_flows" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title_key" text NOT NULL,
	"description_key" text NOT NULL,
	"audience_roles" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_flows_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "guidance_flows_version_positive" CHECK ("guidance_flows"."version" > 0),
	CONSTRAINT "guidance_flows_status_valid" CHECK ("guidance_flows"."status" in ('draft', 'active', 'retired')),
	CONSTRAINT "guidance_flows_steps_array" CHECK (jsonb_typeof("guidance_flows"."steps") = 'array')
);
--> statement-breakpoint
CREATE TABLE "guidance_progress" (
	"user_id" uuid NOT NULL,
	"flow_key" text NOT NULL,
	"flow_version" integer NOT NULL,
	"completed_steps" text[] DEFAULT '{}' NOT NULL,
	"seen_steps" text[] DEFAULT '{}' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_progress_user_flow_version_pk" PRIMARY KEY("user_id","flow_key","flow_version"),
	CONSTRAINT "guidance_progress_version_positive" CHECK ("guidance_progress"."flow_version" > 0),
	CONSTRAINT "guidance_progress_state_valid" CHECK ("guidance_progress"."state" in ('active', 'dismissed', 'completed')),
	CONSTRAINT "guidance_progress_completed_consistent" CHECK (("guidance_progress"."state" = 'completed' and "guidance_progress"."completed_at" is not null) or ("guidance_progress"."state" <> 'completed' and "guidance_progress"."completed_at" is null)),
	CONSTRAINT "guidance_progress_dismissed_consistent" CHECK (("guidance_progress"."state" = 'dismissed' and "guidance_progress"."dismissed_at" is not null) or ("guidance_progress"."state" <> 'dismissed' and "guidance_progress"."dismissed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "entity_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"translated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"job_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_idempotency_keys_key_not_blank" CHECK (length(trim("job_idempotency_keys"."idempotency_key")) > 0),
	CONSTRAINT "job_idempotency_keys_payload_hash_length" CHECK (length("job_idempotency_keys"."payload_hash") = 64),
	CONSTRAINT "job_idempotency_keys_expiry_after_creation" CHECK ("job_idempotency_keys"."expires_at" > "job_idempotency_keys"."created_at")
);
--> statement-breakpoint
CREATE TABLE "job_runtime_heartbeats" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'starting' NOT NULL,
	"platform_version" text NOT NULL,
	"registered_jobs" integer DEFAULT 0 NOT NULL,
	"mounted_workers" integer DEFAULT 0 NOT NULL,
	"scheduled_jobs" integer DEFAULT 0 NOT NULL,
	"queued_jobs" integer DEFAULT 0 NOT NULL,
	"ready_jobs" integer DEFAULT 0 NOT NULL,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"dead_letters" integer DEFAULT 0 NOT NULL,
	"queue_lag_seconds" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "job_runtime_heartbeats_role_check" CHECK ("job_runtime_heartbeats"."role" in ('producer', 'worker')),
	CONSTRAINT "job_runtime_heartbeats_state_check" CHECK ("job_runtime_heartbeats"."state" in ('starting', 'ready', 'degraded', 'stopping', 'stopped')),
	CONSTRAINT "job_runtime_heartbeats_version_not_blank" CHECK (length(trim("job_runtime_heartbeats"."platform_version")) between 1 and 100),
	CONSTRAINT "job_runtime_heartbeats_error_code_length" CHECK ("job_runtime_heartbeats"."last_error_code" is null or length("job_runtime_heartbeats"."last_error_code") between 1 and 80),
	CONSTRAINT "job_runtime_heartbeats_counts_nonnegative" CHECK ("job_runtime_heartbeats"."registered_jobs" >= 0 and "job_runtime_heartbeats"."mounted_workers" >= 0 and "job_runtime_heartbeats"."scheduled_jobs" >= 0 and "job_runtime_heartbeats"."queued_jobs" >= 0 and "job_runtime_heartbeats"."ready_jobs" >= 0 and "job_runtime_heartbeats"."active_jobs" >= 0 and "job_runtime_heartbeats"."failed_jobs" >= 0 and "job_runtime_heartbeats"."dead_letters" >= 0 and "job_runtime_heartbeats"."queue_lag_seconds" >= 0),
	CONSTRAINT "job_runtime_heartbeats_workers_match_role" CHECK (("job_runtime_heartbeats"."role" = 'producer' and "job_runtime_heartbeats"."mounted_workers" = 0) or "job_runtime_heartbeats"."role" = 'worker'),
	CONSTRAINT "job_runtime_heartbeats_stop_timestamp" CHECK ("job_runtime_heartbeats"."state" <> 'stopped' or "job_runtime_heartbeats"."stopped_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "business_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"schema_type" text,
	"street" text,
	"unit" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"phone" text,
	"email" text,
	"google_business_profile_url" text,
	"same_as" text[] DEFAULT '{}' NOT NULL,
	"price_range" text,
	"timezone" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_locations_country_alpha2" CHECK ("business_locations"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "business_locations_latitude" CHECK ("business_locations"."latitude" is null or "business_locations"."latitude" between -90 and 90),
	CONSTRAINT "business_locations_longitude" CHECK ("business_locations"."longitude" is null or "business_locations"."longitude" between -180 and 180),
	CONSTRAINT "business_locations_geo_pair" CHECK (("business_locations"."latitude" is null) = ("business_locations"."longitude" is null))
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"weekday" smallint,
	"on_date" date,
	"opens" time,
	"closes" time,
	"closed" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_hours_weekly_or_dated" CHECK (("opening_hours"."weekday" is null) != ("opening_hours"."on_date" is null)),
	CONSTRAINT "opening_hours_weekday_range" CHECK ("opening_hours"."weekday" is null or "opening_hours"."weekday" between 0 and 6),
	CONSTRAINT "opening_hours_times_present" CHECK (case when "opening_hours"."closed" then "opening_hours"."opens" is null and "opening_hours"."closes" is null
           else "opening_hours"."opens" is not null and "opening_hours"."closes" is not null end)
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"center_latitude" numeric(9, 6),
	"center_longitude" numeric(9, 6),
	"radius_km" numeric(8, 2),
	"regions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_shape" CHECK (case "service_areas"."kind"
            when 'radius' then "service_areas"."center_latitude" is not null and "service_areas"."center_longitude" is not null and "service_areas"."radius_km" is not null
            when 'regions' then array_length("service_areas"."regions", 1) is not null
            else false
          end)
);
--> statement-breakpoint
CREATE TABLE "mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"idempotency_key" text,
	"requested_by" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_deliveries_purpose_allowed" CHECK ("mail_deliveries"."purpose" in ('transactional', 'bulk')),
	CONSTRAINT "mail_deliveries_provider_allowed" CHECK ("mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses', 'none')),
	CONSTRAINT "mail_deliveries_status_allowed" CHECK ("mail_deliveries"."status" in ('queued', 'submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')),
	CONSTRAINT "mail_deliveries_provider_purpose" CHECK (("mail_deliveries"."purpose" = 'transactional' and "mail_deliveries"."provider" in ('gmail', 'outlook', 'smtp', 'console')) or ("mail_deliveries"."purpose" = 'bulk' and "mail_deliveries"."provider" in ('resend', 'postmark', 'ses', 'none'))),
	CONSTRAINT "mail_deliveries_recipient_lower" CHECK ("mail_deliveries"."recipient" = lower("mail_deliveries"."recipient")),
	CONSTRAINT "mail_deliveries_recipient_bounded" CHECK (length("mail_deliveries"."recipient") <= 320),
	CONSTRAINT "mail_deliveries_subject_bounded" CHECK (length("mail_deliveries"."subject") <= 998),
	CONSTRAINT "mail_deliveries_attempts_nonnegative" CHECK ("mail_deliveries"."attempts" >= 0),
	CONSTRAINT "mail_deliveries_terminal_consistent" CHECK ("mail_deliveries"."status" <> 'delivered' or "mail_deliveries"."delivered_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "mail_oauth_states" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"purpose" text DEFAULT 'mail' NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"return_to" text DEFAULT '/admin/settings' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_oauth_states_hash_format" CHECK ("mail_oauth_states"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_oauth_states_provider_allowed" CHECK ("mail_oauth_states"."provider" in ('google', 'microsoft')),
	CONSTRAINT "mail_oauth_states_safe_return" CHECK ("mail_oauth_states"."return_to" ~ '^/(admin|portal/contact-import)(/|$|\?)'),
	CONSTRAINT "mail_oauth_states_expiry_order" CHECK ("mail_oauth_states"."expires_at" > "mail_oauth_states"."created_at"),
	CONSTRAINT "mail_oauth_states_consumed_order" CHECK ("mail_oauth_states"."consumed_at" is null or "mail_oauth_states"."consumed_at" >= "mail_oauth_states"."created_at")
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_envelope_present" CHECK (char_length("mail_outbox"."encrypted_message") > 20)
);
--> statement-breakpoint
CREATE TABLE "mail_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"delivery_id" uuid,
	"provider_ref" text,
	"recipient" text NOT NULL,
	"event_type" text NOT NULL,
	"detail" text,
	"raw_digest" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_provider_events_provider_allowed" CHECK ("mail_provider_events"."provider" in ('resend', 'postmark', 'ses')),
	CONSTRAINT "mail_provider_events_type_allowed" CHECK ("mail_provider_events"."event_type" in ('submitted', 'delivered', 'delayed', 'soft_bounce', 'hard_bounce', 'complaint', 'suppressed', 'failed')),
	CONSTRAINT "mail_provider_events_recipient_lower" CHECK ("mail_provider_events"."recipient" = lower("mail_provider_events"."recipient")),
	CONSTRAINT "mail_provider_events_recipient_bounded" CHECK (length("mail_provider_events"."recipient") <= 320),
	CONSTRAINT "mail_provider_events_digest_format" CHECK ("mail_provider_events"."raw_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mail_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"connected_account_id" uuid,
	"email" text NOT NULL,
	"display_name" text,
	"provider_identity" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"verification_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_senders_purpose_allowed" CHECK ("mail_senders"."purpose" in ('transactional', 'bulk')),
	CONSTRAINT "mail_senders_provider_allowed" CHECK ("mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console', 'resend', 'postmark', 'ses')),
	CONSTRAINT "mail_senders_verification_allowed" CHECK ("mail_senders"."verification_status" in ('pending', 'verified', 'failed')),
	CONSTRAINT "mail_senders_status_allowed" CHECK ("mail_senders"."status" in ('active', 'paused', 'needs_attention')),
	CONSTRAINT "mail_senders_email_lower" CHECK ("mail_senders"."email" = lower("mail_senders"."email")),
	CONSTRAINT "mail_senders_email_bounded" CHECK (length("mail_senders"."email") <= 320),
	CONSTRAINT "mail_senders_provider_purpose" CHECK (("mail_senders"."purpose" = 'transactional' and "mail_senders"."provider" in ('gmail', 'outlook', 'smtp', 'console')) or ("mail_senders"."purpose" = 'bulk' and "mail_senders"."provider" in ('resend', 'postmark', 'ses'))),
	CONSTRAINT "mail_senders_connection_consistent" CHECK (("mail_senders"."provider" in ('gmail', 'outlook') and "mail_senders"."connected_account_id" is not null) or ("mail_senders"."provider" not in ('gmail', 'outlook') and "mail_senders"."connected_account_id" is null)),
	CONSTRAINT "mail_senders_default_ready" CHECK ("mail_senders"."is_default" = false or ("mail_senders"."status" = 'active' and "mail_senders"."verification_status" = 'verified' and "mail_senders"."provider" <> 'console'))
);
--> statement-breakpoint
CREATE TABLE "mail_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"provider" text NOT NULL,
	"source_event_id" uuid,
	"detail" text,
	"active" boolean DEFAULT true NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_suppressions_reason_allowed" CHECK ("mail_suppressions"."reason" in ('hard_bounce', 'complaint', 'provider', 'manual')),
	CONSTRAINT "mail_suppressions_provider_allowed" CHECK ("mail_suppressions"."provider" in ('resend', 'postmark', 'ses', 'manual')),
	CONSTRAINT "mail_suppressions_source_consistent" CHECK (("mail_suppressions"."reason" = 'manual' and "mail_suppressions"."provider" = 'manual') or ("mail_suppressions"."reason" <> 'manual' and "mail_suppressions"."provider" <> 'manual')),
	CONSTRAINT "mail_suppressions_email_lower" CHECK ("mail_suppressions"."email" = lower("mail_suppressions"."email")),
	CONSTRAINT "mail_suppressions_email_bounded" CHECK (length("mail_suppressions"."email") <= 320),
	CONSTRAINT "mail_suppressions_release_consistent" CHECK (("mail_suppressions"."active" = true and "mail_suppressions"."released_at" is null) or ("mail_suppressions"."active" = false and "mail_suppressions"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alt_text" text,
	"blurhash" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"scan_status" text DEFAULT 'not_configured' NOT NULL,
	"scan_engine" text,
	"scan_message" text,
	"scanned_at" timestamp with time zone,
	"checksum_sha256" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"uploaded_by" text,
	"focal_x" integer DEFAULT 5000 NOT NULL,
	"focal_y" integer DEFAULT 5000 NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_bytes_nonnegative" CHECK ("assets"."byte_size" >= 0),
	CONSTRAINT "assets_legacy_bytes_nonnegative" CHECK ("assets"."bytes" >= 0),
	CONSTRAINT "assets_focal_x_range" CHECK ("assets"."focal_x" between 0 and 10000),
	CONSTRAINT "assets_focal_y_range" CHECK ("assets"."focal_y" between 0 and 10000),
	CONSTRAINT "assets_trash_dates_consistent" CHECK (("assets"."status" = 'trashed' and "assets"."deleted_at" is not null and "assets"."purge_after" is not null) or ("assets"."status" <> 'trashed' and "assets"."deleted_at" is null and "assets"."purge_after" is null))
);
--> statement-breakpoint
CREATE TABLE "media_alt_text_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"suggestion" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"source_checksum" text NOT NULL,
	"authored_alt_text_at_request" text,
	"requested_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_alt_text_status_valid" CHECK ("media_alt_text_suggestions"."status" in ('ready', 'accepted', 'dismissed', 'superseded')),
	CONSTRAINT "media_alt_text_review_consistent" CHECK (("media_alt_text_suggestions"."status" = 'ready' and "media_alt_text_suggestions"."reviewed_by" is null and "media_alt_text_suggestions"."reviewed_at" is null) or ("media_alt_text_suggestions"."status" <> 'ready' and "media_alt_text_suggestions"."reviewed_by" is not null and "media_alt_text_suggestions"."reviewed_at" is not null)),
	CONSTRAINT "media_alt_text_suggestion_length" CHECK (char_length("media_alt_text_suggestions"."suggestion") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "media_capture_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_capture_chunks_sequence_nonneg" CHECK ("media_capture_chunks"."sequence" >= 0),
	CONSTRAINT "media_capture_chunks_bytes_positive" CHECK ("media_capture_chunks"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_capture_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"staged_key" text NOT NULL,
	"staged_bytes" bigint NOT NULL,
	"staged_mime" text NOT NULL,
	"upload_id" uuid,
	"asset_id" uuid,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_capture_items_bytes_positive" CHECK ("media_capture_items"."staged_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_capture_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_type" text,
	"target_id" text,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"token" text,
	"permission_granted_at" timestamp with time zone,
	"display_surface" text,
	"trim_start_ms" integer DEFAULT 0 NOT NULL,
	"trim_end_ms" integer,
	"caption" text,
	"focal_x" integer DEFAULT 5000 NOT NULL,
	"focal_y" integer DEFAULT 5000 NOT NULL,
	"staged_key" text,
	"staged_bytes" bigint,
	"staged_mime" text,
	"staged_filename" text,
	"upload_id" uuid,
	"asset_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_capture_sessions_source_valid" CHECK ("media_capture_sessions"."source" in ('camera','microphone','screen','share_sheet','camera_roll','upload_link','import','social')),
	CONSTRAINT "media_capture_sessions_status_valid" CHECK ("media_capture_sessions"."status" in ('pending','live','preview','confirmed','discarded','expired')),
	CONSTRAINT "media_capture_sessions_trim_start_nonneg" CHECK ("media_capture_sessions"."trim_start_ms" >= 0),
	CONSTRAINT "media_capture_sessions_trim_window" CHECK ("media_capture_sessions"."trim_end_ms" is null or "media_capture_sessions"."trim_end_ms" >= "media_capture_sessions"."trim_start_ms"),
	CONSTRAINT "media_capture_sessions_focal_x_range" CHECK ("media_capture_sessions"."focal_x" between 0 and 10000),
	CONSTRAINT "media_capture_sessions_focal_y_range" CHECK ("media_capture_sessions"."focal_y" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"asset_id" uuid,
	"upload_id" uuid,
	"role" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"bytes" bigint,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_objects_attachment_consistent" CHECK (("media_objects"."state" = 'attached' and "media_objects"."asset_id" is not null) or "media_objects"."state" = 'pending')
);
--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy" text NOT NULL,
	"state" text DEFAULT 'created' NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"declared_mime" text NOT NULL,
	"detected_mime" text,
	"expected_bytes" bigint NOT NULL,
	"provider_upload_id" text,
	"asset_id" uuid,
	"uploaded_by" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_uploads_expected_bytes_positive" CHECK ("media_uploads"."expected_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"subject" text,
	"reply_channel" text NOT NULL,
	"number_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"assignee_user_id" uuid,
	"thread_key" text,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"unread" boolean DEFAULT false NOT NULL,
	"assistant_escalated_at" timestamp with time zone,
	"assistant_escalation_reason" text,
	"assistant_escalation_resolved_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_subject" CHECK ("conversations"."subject" is null or char_length("conversations"."subject") <= 500),
	CONSTRAINT "conversations_snoozed_has_time" CHECK ("conversations"."status" <> 'snoozed' or "conversations"."snoozed_until" is not null),
	CONSTRAINT "conversations_assistant_escalation_reason" CHECK ("conversations"."assistant_escalation_reason" is null or char_length("conversations"."assistant_escalation_reason") <= 1000),
	CONSTRAINT "conversations_assistant_escalation_state" CHECK ("conversations"."assistant_escalation_resolved_at" is null or "conversations"."assistant_escalated_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "keyword_rule_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_ref" text NOT NULL,
	"rule_id" uuid,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_rule_events_action_allowed" CHECK ("keyword_rule_events"."action" in ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')),
	CONSTRAINT "keyword_rule_events_outcome_allowed" CHECK ("keyword_rule_events"."outcome" in ('applied','refused','noop'))
);
--> statement-breakpoint
CREATE TABLE "keyword_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"normalized_keyword" text NOT NULL,
	"match" text DEFAULT 'exact' NOT NULL,
	"action" text NOT NULL,
	"action_value" text,
	"reply_body" text,
	"locale" text DEFAULT '*' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_rules_keyword_length" CHECK (char_length("keyword_rules"."keyword") between 1 and 100),
	CONSTRAINT "keyword_rules_action_value" CHECK (("keyword_rules"."action" in ('tag', 'route') and "keyword_rules"."action_value" is not null)
        or ("keyword_rules"."action" not in ('tag', 'route') and "keyword_rules"."action_value" is null)),
	CONSTRAINT "keyword_rules_match_allowed" CHECK ("keyword_rules"."match" in ('exact', 'prefix')),
	CONSTRAINT "keyword_rules_action_allowed" CHECK ("keyword_rules"."action" in ('opt_out','opt_in','help','auto_reply','tag','route','booking_confirm')),
	CONSTRAINT "keyword_rules_reply_required" CHECK ("keyword_rules"."action" not in ('help', 'auto_reply') or "keyword_rules"."reply_body" is not null)
);
--> statement-breakpoint
CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_text" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text,
	"policy_exception" text,
	"policy_exception_ref" text,
	"body" text NOT NULL,
	"media_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"chat_session_id" uuid,
	"template_id" uuid,
	"sent_by" text NOT NULL,
	"sent_by_user_id" uuid,
	"provider_ref" text,
	"recipient_address" text,
	"segments" integer,
	"cost_minor" integer,
	"cost_currency" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body" CHECK (char_length("messages"."body") between 1 and 100000),
	CONSTRAINT "messages_cost" CHECK ("messages"."cost_minor" is null or "messages"."cost_minor" >= 0),
	CONSTRAINT "messages_recipient_address_length" CHECK ("messages"."recipient_address" is null or char_length("messages"."recipient_address") <= 320),
	CONSTRAINT "messages_policy_exception_pair" CHECK (("messages"."policy_exception" is null and "messages"."policy_exception_ref" is null)
        or ("messages"."policy_exception" is not null and "messages"."policy_exception_ref" is not null)),
	CONSTRAINT "messages_cost_currency" CHECK ("messages"."cost_minor" is null or "messages"."cost_currency" is not null)
);
--> statement-breakpoint
CREATE TABLE "site_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_chat_sessions_token_hash" CHECK ("site_chat_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "site_chat_sessions_expiry" CHECK ("site_chat_sessions"."expires_at" > "site_chat_sessions"."created_at"),
	CONSTRAINT "site_chat_sessions_locale" CHECK (char_length("site_chat_sessions"."locale") between 2 and 35)
);
--> statement-breakpoint
CREATE TABLE "sms_compliance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"intent" text NOT NULL,
	"keyword" text NOT NULL,
	"locale" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_compliance_events_keyword" CHECK (char_length("sms_compliance_events"."keyword") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_by" uuid,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"contact_id" uuid,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'team' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"pinned_at" timestamp with time zone,
	"mentions" uuid[] DEFAULT '{}' NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_body" CHECK (char_length("notes"."body") between 1 and 20000),
	CONSTRAINT "notes_pinned_has_time" CHECK ("notes"."pinned" = false or "notes"."pinned_at" is not null),
	CONSTRAINT "notes_edited_has_time" CHECK ("notes"."edit_count" = 0 or "notes"."edited_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"app_version" text NOT NULL,
	"contract_version" integer NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_not_blank" CHECK (length(trim("device_tokens"."token")) > 0),
	CONSTRAINT "device_tokens_contract_version" CHECK ("device_tokens"."contract_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"digest_id" uuid,
	"channel" text NOT NULL,
	"kind" text DEFAULT 'immediate' NOT NULL,
	"status" text NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_ref" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_allowed" CHECK ("notification_deliveries"."channel" in ('in_app', 'email', 'sms', 'push')),
	CONSTRAINT "notification_deliveries_kind_allowed" CHECK ("notification_deliveries"."kind" in ('immediate', 'digest', 'escalation')),
	CONSTRAINT "notification_deliveries_status_allowed" CHECK ("notification_deliveries"."status" in ('pending', 'deferred', 'processing', 'delivered', 'skipped', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_nonnegative" CHECK ("notification_deliveries"."attempts" >= 0),
	CONSTRAINT "notification_deliveries_terminal_consistent" CHECK ("notification_deliveries"."status" <> 'delivered' or "notification_deliveries"."delivered_at" is not null),
	CONSTRAINT "notification_deliveries_digest_consistent" CHECK (("notification_deliveries"."kind" = 'digest' and "notification_deliveries"."status" in ('deferred', 'processing', 'delivered', 'skipped', 'failed')) or ("notification_deliveries"."kind" <> 'digest' and "notification_deliveries"."digest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_contact_id" uuid,
	"recipient" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"idempotency_key" text NOT NULL,
	"item_count" integer NOT NULL,
	"provider" text,
	"provider_ref" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digests_one_recipient" CHECK (num_nonnulls("notification_digests"."recipient_user_id", "notification_digests"."recipient_contact_id") = 1),
	CONSTRAINT "notification_digests_recipient_lower" CHECK ("notification_digests"."recipient" = lower("notification_digests"."recipient")),
	CONSTRAINT "notification_digests_items_positive" CHECK ("notification_digests"."item_count" >= 1),
	CONSTRAINT "notification_digests_status_allowed" CHECK ("notification_digests"."status" in ('processing', 'delivered', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"topic" text NOT NULL,
	"channel" text NOT NULL,
	"mode" text DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_one_recipient" CHECK (num_nonnulls("notification_preferences"."user_id", "notification_preferences"."contact_id") = 1),
	CONSTRAINT "notification_preferences_channel_allowed" CHECK ("notification_preferences"."channel" in ('in_app', 'email', 'sms', 'push')),
	CONSTRAINT "notification_preferences_mode_allowed" CHECK ("notification_preferences"."mode" in ('immediate', 'digest', 'off')),
	CONSTRAINT "notification_preferences_in_app_immediate" CHECK ("notification_preferences"."channel" <> 'in_app' or "notification_preferences"."mode" in ('immediate', 'off')),
	CONSTRAINT "notification_preferences_digest_email_only" CHECK ("notification_preferences"."mode" <> 'digest' or "notification_preferences"."channel" = 'email'),
	CONSTRAINT "notification_preferences_topic_bounded" CHECK (length("notification_preferences"."topic") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "notification_receipts" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"digest_cadence" text DEFAULT 'daily' NOT NULL,
	"digest_minute" integer DEFAULT 480 NOT NULL,
	"digest_weekday" integer DEFAULT 1 NOT NULL,
	"timezone" text,
	"escalation_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_one_recipient" CHECK (num_nonnulls("notification_settings"."user_id", "notification_settings"."contact_id") = 1),
	CONSTRAINT "notification_settings_cadence_allowed" CHECK ("notification_settings"."digest_cadence" in ('daily', 'weekly')),
	CONSTRAINT "notification_settings_minute_allowed" CHECK ("notification_settings"."digest_minute" between 0 and 1439),
	CONSTRAINT "notification_settings_weekday_allowed" CHECK ("notification_settings"."digest_weekday" between 1 and 7),
	CONSTRAINT "notification_settings_escalation_allowed" CHECK ("notification_settings"."escalation_minutes" between 5 and 10080)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_contact_id" uuid,
	"external_recipient" text,
	"topic" text NOT NULL,
	"priority" text DEFAULT 'information' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"reply_to" text,
	"source_event_id" text,
	"source_event_name" text,
	"idempotency_key" text NOT NULL,
	"dedupe_key" text,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"escalate_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_one_recipient" CHECK (num_nonnulls("notifications"."recipient_user_id", "notifications"."recipient_contact_id", "notifications"."external_recipient") = 1),
	CONSTRAINT "notifications_priority_allowed" CHECK ("notifications"."priority" in ('information', 'warning', 'critical')),
	CONSTRAINT "notifications_topic_bounded" CHECK (length("notifications"."topic") between 1 and 100),
	CONSTRAINT "notifications_title_bounded" CHECK (length("notifications"."title") between 1 and 240),
	CONSTRAINT "notifications_body_bounded" CHECK (length("notifications"."body") between 1 and 4000),
	CONSTRAINT "notifications_href_internal" CHECK ("notifications"."href" is null or ("notifications"."href" ~ '^/' and length("notifications"."href") <= 1000)),
	CONSTRAINT "notifications_external_lower" CHECK ("notifications"."external_recipient" is null or "notifications"."external_recipient" = lower("notifications"."external_recipient")),
	CONSTRAINT "notifications_occurrences_positive" CHECK ("notifications"."occurrence_count" >= 1),
	CONSTRAINT "notifications_occurrence_order" CHECK ("notifications"."last_occurred_at" >= "notifications"."first_occurred_at"),
	CONSTRAINT "notifications_escalation_consistent" CHECK ("notifications"."escalated_at" is null or "notifications"."escalate_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "paywall_meter_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paywall_id" uuid NOT NULL,
	"contact_id" uuid,
	"anon_id" text,
	"window_starts_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paywall_meters_subject" CHECK (("paywall_meter_counters"."contact_id" is not null and "paywall_meter_counters"."anon_id" is null)
        or ("paywall_meter_counters"."contact_id" is null and "paywall_meter_counters"."anon_id" is not null)),
	CONSTRAINT "paywall_meters_count_nonnegative" CHECK ("paywall_meter_counters"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "paywalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb NOT NULL,
	"mode" text DEFAULT 'hard' NOT NULL,
	"meter_count" integer DEFAULT 0 NOT NULL,
	"meter_window_days" integer DEFAULT 30 NOT NULL,
	"preview_strategy" text DEFAULT 'blocks' NOT NULL,
	"preview_value" integer DEFAULT 1 NOT NULL,
	"required_entitlement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upsell_page_id" uuid,
	"seo_policy" text DEFAULT 'fully_gated' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paywalls_meter_count_nonnegative" CHECK ("paywalls"."meter_count" >= 0),
	CONSTRAINT "paywalls_meter_window_positive" CHECK ("paywalls"."meter_window_days" >= 1),
	CONSTRAINT "paywalls_preview_value_nonnegative" CHECK ("paywalls"."preview_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"origin" text,
	"kind" text,
	"status" text DEFAULT 'discover' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"source" text NOT NULL,
	"tier" text DEFAULT 'local' NOT NULL,
	"integrity" text NOT NULL,
	"signature" text,
	"license" text NOT NULL,
	"freeholder" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disabled_reason" text,
	"previous_version" text,
	"installed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"tier" text DEFAULT 'community' NOT NULL,
	"signature" text,
	"cached_index" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_retentions" (
	"name" text PRIMARY KEY NOT NULL,
	"retention" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"channel" text,
	"state" text NOT NULL,
	"method" text NOT NULL,
	"terms_version" text,
	"source_url" text,
	"ip" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_purpose" CHECK ("consent_records"."purpose" in ('marketing', 'analytics', 'data_processing')),
	CONSTRAINT "consent_records_purpose_channel" CHECK (("consent_records"."purpose" = 'marketing' and "consent_records"."channel" in ('email', 'sms', 'push'))
        or ("consent_records"."purpose" = 'analytics' and "consent_records"."channel" = 'web')
        or ("consent_records"."purpose" = 'data_processing' and "consent_records"."channel" is null)),
	CONSTRAINT "consent_records_state" CHECK ("consent_records"."state" in ('granted', 'denied', 'withdrawn')),
	CONSTRAINT "consent_records_method" CHECK ("consent_records"."method" in ('form', 'preference_center', 'double_opt_in', 'verbal', 'written', 'contract', 'import', 'system')),
	CONSTRAINT "consent_records_expiry_after_event" CHECK ("consent_records"."expires_at" is null or "consent_records"."expires_at" > "consent_records"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "data_request_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_request_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text DEFAULT 'application/json' NOT NULL,
	"body" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_request_artifacts_sha256_length" CHECK (length("data_request_artifacts"."sha256") = 64),
	CONSTRAINT "data_request_artifacts_expiry_after_creation" CHECK ("data_request_artifacts"."expires_at" > "data_request_artifacts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"jurisdiction" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" text NOT NULL,
	"verification_method" text,
	"verified_at" timestamp with time zone,
	"response_due_at" timestamp with time zone NOT NULL,
	"resolution" text,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_requests_kind" CHECK ("data_requests"."kind" in ('access', 'export', 'correction', 'erasure')),
	CONSTRAINT "data_requests_status" CHECK ("data_requests"."status" in ('submitted', 'verified', 'in_progress', 'completed', 'partially_completed', 'denied', 'cancelled')),
	CONSTRAINT "data_requests_verified_state" CHECK ("data_requests"."status" not in ('verified', 'in_progress', 'completed', 'partially_completed') or "data_requests"."verified_at" is not null),
	CONSTRAINT "data_requests_fulfilled_state" CHECK ("data_requests"."status" not in ('completed', 'partially_completed', 'denied') or "data_requests"."fulfilled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "privacy_retention_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_request_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"legal_basis" text NOT NULL,
	"notes" text,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_retention_exceptions_reason" CHECK ("privacy_retention_exceptions"."reason" in ('legal_obligation', 'legal_claim', 'contractual_obligation', 'accounting_tax', 'security_fraud')),
	CONSTRAINT "privacy_retention_exceptions_expiry_after_creation" CHECK ("privacy_retention_exceptions"."expires_at" is null or "privacy_retention_exceptions"."expires_at" > "privacy_retention_exceptions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "run_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"service_name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_autonomy" text DEFAULT 'approve' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"node_id" text,
	"service_name" text,
	"input" jsonb,
	"output" jsonb,
	"tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_version_id" uuid,
	"agent_id" uuid,
	"contact_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"error" text,
	"wake_at" timestamp with time zone,
	"step_count" integer DEFAULT 0 NOT NULL,
	"resume_node_id" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"kind" text NOT NULL,
	"starts" time,
	"ends" time,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_exceptions_order" CHECK ("availability_exceptions"."ends_on" >= "availability_exceptions"."starts_on"),
	CONSTRAINT "availability_exceptions_times" CHECK (case when "availability_exceptions"."kind" = 'closed'
           then "availability_exceptions"."starts" is null and "availability_exceptions"."ends" is null
           else "availability_exceptions"."starts" is not null and "availability_exceptions"."ends" is not null
                and "availability_exceptions"."ends" > "availability_exceptions"."starts" end)
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts" time NOT NULL,
	"ends" time NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"kind" text DEFAULT 'bookable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday" CHECK ("availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_order" CHECK ("availability_rules"."ends" > "availability_rules"."starts"),
	CONSTRAINT "availability_rules_effective_order" CHECK ("availability_rules"."effective_from" is null or "availability_rules"."effective_to" is null
          or "availability_rules"."effective_to" >= "availability_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "booking_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"contact_id" uuid,
	"name" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_participants_seats" CHECK ("booking_participants"."seat_count" > 0),
	CONSTRAINT "booking_participants_identified" CHECK ("booking_participants"."contact_id" is not null or "booking_participants"."name" is not null)
);
--> statement-breakpoint
CREATE TABLE "booking_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"offset_min" integer NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reminders_offset" CHECK ("booking_reminders"."offset_min" between 0 and 43200)
);
--> statement-breakpoint
CREATE TABLE "booking_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"service_offering_id" uuid,
	"calendar_id" uuid,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"offer_token" text,
	"offer_starts_at" timestamp with time zone,
	"offer_ends_at" timestamp with time zone,
	"booking_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_waitlist_order" CHECK ("booking_waitlist"."window_end" > "booking_waitlist"."window_start"),
	CONSTRAINT "booking_waitlist_seats" CHECK ("booking_waitlist"."seat_count" > 0),
	CONSTRAINT "booking_waitlist_offer_complete" CHECK ("booking_waitlist"."status" <> 'offered'
        or ("booking_waitlist"."offer_token" is not null and "booking_waitlist"."offer_expires_at" is not null
            and "booking_waitlist"."offer_starts_at" is not null and "booking_waitlist"."offer_ends_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"service_offering_id" uuid,
	"calendar_id" uuid NOT NULL,
	"secondary_calendar_ids" uuid[] DEFAULT '{}' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone_at_booking" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"location_id" uuid,
	"location_detail" text,
	"capacity_used" integer DEFAULT 1 NOT NULL,
	"exclusive" boolean DEFAULT true NOT NULL,
	"invoice_id" uuid,
	"rescheduled_from_id" uuid,
	"reschedule_token" text,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"cancellation_policy" jsonb,
	"cancellation_outcome" jsonb,
	"intake_submission_id" uuid,
	"waiver_id" uuid,
	"source" text DEFAULT 'admin' NOT NULL,
	"notes" text,
	"cancellation_reason" text,
	"provider_event_ref" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_order" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_capacity_positive" CHECK ("bookings"."capacity_used" > 0)
);
--> statement-breakpoint
CREATE TABLE "calendar_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"service_offering_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"skill_level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_memberships_priority" CHECK ("calendar_memberships"."priority" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"user_id" uuid,
	"location_id" uuid,
	"timezone" text NOT NULL,
	"capacity_default" integer DEFAULT 1 NOT NULL,
	"colour" text,
	"external_calendar_id" uuid,
	"booking_horizon_days" integer DEFAULT 180 NOT NULL,
	"min_notice_min" integer DEFAULT 120 NOT NULL,
	"max_per_day" integer,
	"ics_token" text,
	"ics_import_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_capacity_positive" CHECK ("calendars"."capacity_default" > 0),
	CONSTRAINT "calendars_horizon_positive" CHECK ("calendars"."booking_horizon_days" > 0),
	CONSTRAINT "calendars_notice_not_negative" CHECK ("calendars"."min_notice_min" >= 0),
	CONSTRAINT "calendars_max_per_day_positive" CHECK ("calendars"."max_per_day" is null or "calendars"."max_per_day" > 0),
	CONSTRAINT "calendars_person_has_holder" CHECK (("calendars"."kind" = 'person') = ("calendars"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "external_busy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"source" text DEFAULT 'ics' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"busy" boolean DEFAULT true NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_busy_blocks_order" CHECK ("external_busy_blocks"."ends_at" > "external_busy_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "contact_score_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"rule_id" uuid,
	"rule_name" text NOT NULL,
	"event_name" text NOT NULL,
	"points" integer NOT NULL,
	"decay_days" integer DEFAULT 0 NOT NULL,
	"source_event_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"event_name" text,
	"match_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"decay_days" integer DEFAULT 0 NOT NULL,
	"max_awards" integer,
	"advance_to" text,
	"threshold_score" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_rules_name" CHECK (char_length("scoring_rules"."name") between 1 and 120),
	CONSTRAINT "scoring_rules_points" CHECK ("scoring_rules"."points" between -1000 and 1000),
	CONSTRAINT "scoring_rules_decay" CHECK ("scoring_rules"."decay_days" between 0 and 3650),
	CONSTRAINT "scoring_rules_max_awards" CHECK ("scoring_rules"."max_awards" is null or "scoring_rules"."max_awards" between 1 and 10000),
	CONSTRAINT "scoring_rules_shape" CHECK (("scoring_rules"."kind" = 'event' and "scoring_rules"."event_name" is not null and "scoring_rules"."threshold_score" is null)
          or ("scoring_rules"."kind" = 'threshold' and "scoring_rules"."threshold_score" is not null and "scoring_rules"."advance_to" is not null))
);
--> statement-breakpoint
CREATE TABLE "csp_violations" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"document_path" text NOT NULL,
	"effective_directive" text NOT NULL,
	"blocked_source" text NOT NULL,
	"source_path" text,
	"disposition" text DEFAULT 'enforce' NOT NULL,
	"status_code" integer,
	"line_number" integer,
	"column_number" integer,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	CONSTRAINT "csp_violations_occurrences_positive" CHECK ("csp_violations"."occurrences" > 0),
	CONSTRAINT "csp_violations_disposition_valid" CHECK ("csp_violations"."disposition" in ('enforce', 'report'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segment_members_segment_id_contact_id_pk" PRIMARY KEY("segment_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'dynamic' NOT NULL,
	"definition" jsonb NOT NULL,
	"member_count_cached" integer,
	"last_evaluated_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_name" CHECK (char_length("segments"."name") between 1 and 120),
	CONSTRAINT "segments_slug_shape" CHECK ("segments"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "segments_static_captured" CHECK ("segments"."kind" <> 'static' or "segments"."captured_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status" text DEFAULT '301' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"schema_type" text DEFAULT 'LocalBusiness' NOT NULL,
	"country" text NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"enabled_locales" text[] DEFAULT '{"en"}' NOT NULL,
	"base_currency" text NOT NULL,
	"timezone" text NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"first_day_of_week" integer DEFAULT 1 NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_singleton" CHECK ("business_profile"."id" = 1),
	CONSTRAINT "business_profile_country_alpha2" CHECK ("business_profile"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "business_profile_currency_alpha3" CHECK ("business_profile"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "business_profile_first_day" CHECK ("business_profile"."first_day_of_week" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "module_settings" (
	"module" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"contact_id" uuid,
	"title" text NOT NULL,
	"details" text,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"assignee_user_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"cadence" text,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"recurred_from_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title" CHECK (char_length("tasks"."title") between 1 and 300),
	CONSTRAINT "tasks_subject_pair" CHECK (("tasks"."subject_type" is null) = ("tasks"."subject_id" is null)),
	CONSTRAINT "tasks_done_has_time" CHECK ("tasks"."status" <> 'done' or "tasks"."completed_at" is not null),
	CONSTRAINT "tasks_recurrence_needs_due" CHECK ("tasks"."cadence" is null or "tasks"."due_at" is not null),
	CONSTRAINT "tasks_interval" CHECK ("tasks"."interval_count" between 1 and 52)
);
--> statement-breakpoint
CREATE TABLE "available_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"channel" text NOT NULL,
	"digest" text NOT NULL,
	"severity" text DEFAULT 'none' NOT NULL,
	"cvss" numeric(3, 1),
	"schema_breaking" boolean DEFAULT false NOT NULL,
	"min_from_version" text NOT NULL,
	"plugin_api" text NOT NULL,
	"notes_url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "available_releases_version_not_blank" CHECK (length(trim("available_releases"."version")) > 0),
	CONSTRAINT "available_releases_digest_shape" CHECK ("available_releases"."digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "available_releases_cvss_range" CHECK ("available_releases"."cvss" is null or ("available_releases"."cvss" >= 0 and "available_releases"."cvss" <= 10)),
	CONSTRAINT "available_releases_severity_matches_score" CHECK (("available_releases"."cvss" is null and "available_releases"."severity" = 'none') or ("available_releases"."cvss" is not null and "available_releases"."severity" <> 'none'))
);
--> statement-breakpoint
CREATE TABLE "release_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"actor" text NOT NULL,
	"source_ref" text,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_notes_title_not_blank" CHECK (length(trim("release_notes"."title")) > 0),
	CONSTRAINT "release_notes_visibility" CHECK ("release_notes"."visibility" in ('internal', 'public'))
);
--> statement-breakpoint
CREATE TABLE "update_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"preflight" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_id" uuid,
	"rolled_back_from_run_id" uuid,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "update_runs_from_not_blank" CHECK (length(trim("update_runs"."from_version")) > 0),
	CONSTRAINT "update_runs_to_not_blank" CHECK (length(trim("update_runs"."to_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "update_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"channel" text DEFAULT 'security' NOT NULL,
	"apply_level" text DEFAULT 'security' NOT NULL,
	"window" jsonb DEFAULT '{"days":["tue","wed","thu"],"start":"03:00"}'::jsonb NOT NULL,
	"drain" boolean DEFAULT true NOT NULL,
	"notify_channels" text[] DEFAULT '{"email","sms"}' NOT NULL,
	"keep_snapshots" integer DEFAULT 5 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "update_settings_singleton" CHECK ("update_settings"."id" = 1),
	CONSTRAINT "update_settings_keep_snapshots" CHECK ("update_settings"."keep_snapshots" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "update_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"version" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "update_snapshots_fingerprint_not_blank" CHECK (length(trim("update_snapshots"."fingerprint")) > 0),
	CONSTRAINT "update_snapshots_version_not_blank" CHECK (length(trim("update_snapshots"."version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" text[] DEFAULT '{}' NOT NULL,
	"sort_key" text,
	"sort_dir" text,
	"owner_user_id" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_name" CHECK (char_length("saved_views"."name") between 1 and 120),
	CONSTRAINT "saved_views_entity_key" CHECK (char_length("saved_views"."entity") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"outbox_event_id" uuid,
	"event_name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"secret" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"cells" text[] DEFAULT '{}' NOT NULL,
	"email" text,
	"outcome" text DEFAULT 'skip' NOT NULL,
	"errors" text[] DEFAULT '{}' NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_id" uuid,
	"created" boolean DEFAULT false NOT NULL,
	"before_state" jsonb,
	"relationship_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"delimiter" text DEFAULT ',' NOT NULL,
	"headers" text[] DEFAULT '{}' NOT NULL,
	"mapping" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"source_kind" text DEFAULT 'owner_csv' NOT NULL,
	"signup_flow" text,
	"subject_contact_id" uuid,
	"allowed_fields" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'mapping' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"committed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_imports_filename" CHECK (char_length("contact_imports"."filename") between 1 and 300),
	CONSTRAINT "contact_imports_committed_has_time" CHECK ("contact_imports"."status" <> 'committed' or "contact_imports"."committed_at" is not null),
	CONSTRAINT "contact_imports_reverted_has_time" CHECK ("contact_imports"."status" <> 'reverted' or "contact_imports"."reverted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "signup_contact_import_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flow" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"import_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_contact_import_policies" (
	"flow" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_sources" text[] DEFAULT ARRAY['csv','vcard','device']::text[] NOT NULL,
	"allowed_fields" text[] DEFAULT ARRAY['email','name','phone']::text[] NOT NULL,
	"max_contacts" integer DEFAULT 100 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_contact_import_policy_max" CHECK ("signup_contact_import_policies"."max_contacts" between 1 and 500),
	CONSTRAINT "signup_contact_import_policy_sources" CHECK ("signup_contact_import_policies"."allowed_sources" <@ ARRAY['google','microsoft','vcard','csv','device']::text[]),
	CONSTRAINT "signup_contact_import_policy_fields" CHECK ("signup_contact_import_policies"."allowed_fields" <@ ARRAY['email','name','phone']::text[] and "signup_contact_import_policies"."allowed_fields" @> ARRAY['email']::text[])
);
--> statement-breakpoint
CREATE TABLE "messaging_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"e164" text NOT NULL,
	"label" text,
	"country" text,
	"kind" text DEFAULT 'long_code' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"purpose" text DEFAULT 'transactional' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"health_unknown" boolean DEFAULT false NOT NULL,
	"health_problem" text,
	"provider_status" text,
	"health_checked_at" timestamp with time zone,
	"registrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_numbers_e164" CHECK (char_length("messaging_numbers"."e164") between 1 and 40),
	CONSTRAINT "messaging_numbers_problem" CHECK ("messaging_numbers"."healthy" = true or "messaging_numbers"."health_problem" is not null)
);
--> statement-breakpoint
CREATE TABLE "messaging_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"contact_id" uuid,
	"segment_id" uuid,
	"quiet_from" time,
	"quiet_to" time,
	"timezone_source" text DEFAULT 'contact' NOT NULL,
	"max_per_day" integer,
	"max_per_week" integer,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_windows_scope_target" CHECK (("messaging_windows"."scope" = 'global' and "messaging_windows"."contact_id" is null and "messaging_windows"."segment_id" is null)
        or ("messaging_windows"."scope" = 'contact' and "messaging_windows"."contact_id" is not null and "messaging_windows"."segment_id" is null)
        or ("messaging_windows"."scope" = 'segment' and "messaging_windows"."segment_id" is not null and "messaging_windows"."contact_id" is null)),
	CONSTRAINT "messaging_windows_quiet_pair" CHECK (("messaging_windows"."quiet_from" is null and "messaging_windows"."quiet_to" is null)
        or ("messaging_windows"."quiet_from" is not null and "messaging_windows"."quiet_to" is not null and "messaging_windows"."quiet_from" <> "messaging_windows"."quiet_to")),
	CONSTRAINT "messaging_windows_has_policy" CHECK ("messaging_windows"."quiet_from" is not null or "messaging_windows"."max_per_day" is not null or "messaging_windows"."max_per_week" is not null),
	CONSTRAINT "messaging_windows_daily_cap" CHECK ("messaging_windows"."max_per_day" is null or "messaging_windows"."max_per_day" > 0),
	CONSTRAINT "messaging_windows_weekly_cap" CHECK ("messaging_windows"."max_per_week" is null or "messaging_windows"."max_per_week" > 0)
);
--> statement-breakpoint
CREATE TABLE "booking_audience_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_audience_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts" time NOT NULL,
	"ends" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_audience_hours_weekday" CHECK ("booking_audience_hours"."weekday" between 0 and 6),
	CONSTRAINT "booking_audience_hours_order" CHECK ("booking_audience_hours"."ends" > "booking_audience_hours"."starts")
);
--> statement-breakpoint
CREATE TABLE "booking_audience_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"service_offering_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"who" text DEFAULT 'public' NOT NULL,
	"token" text,
	"contact_tag" text,
	"hours" text DEFAULT 'calendar' NOT NULL,
	"min_notice_min" integer,
	"booking_horizon_days" integer,
	"buffer_before_min" integer,
	"buffer_after_min" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_audiences_token_present" CHECK (("booking_audiences"."who" = 'token') = ("booking_audiences"."token" is not null)),
	CONSTRAINT "booking_audiences_tag_present" CHECK (("booking_audiences"."who" = 'tag') = ("booking_audiences"."contact_tag" is not null)),
	CONSTRAINT "booking_audiences_notice" CHECK ("booking_audiences"."min_notice_min" is null or "booking_audiences"."min_notice_min" >= 0),
	CONSTRAINT "booking_audiences_horizon" CHECK ("booking_audiences"."booking_horizon_days" is null or "booking_audiences"."booking_horizon_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"pricing" text DEFAULT 'house' NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"budget_cents" integer,
	"pacing" text DEFAULT 'even' NOT NULL,
	"invoice_id" uuid,
	"reconciled_at" timestamp with time zone,
	"reconciled_delivered_minor" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"approval_state" text DEFAULT 'none' NOT NULL,
	"approval_note" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"click_url" text NOT NULL,
	"alt_text" text,
	"headline" text,
	"body" text,
	"cta_label" text,
	"tag_html" text,
	"provider" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dayparting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency_cap" integer,
	"frequency_period_hours" integer DEFAULT 24 NOT NULL,
	"goal_impressions" integer,
	"goal_clicks" integer,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"breakpoint" text NOT NULL,
	"iab_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lazy" boolean DEFAULT true NOT NULL,
	"refresh_seconds" integer DEFAULT 0 NOT NULL,
	"allow_house_fill" boolean DEFAULT true NOT NULL,
	"allow_third_party" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"viewable_impressions" integer DEFAULT 0 NOT NULL,
	"uniques" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_txt_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"account_id" text NOT NULL,
	"relationship" text NOT NULL,
	"certification_authority_id" text,
	"surface" text DEFAULT 'both' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_name" text,
	"website" text,
	"notes" text,
	"billing_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_attributions" (
	"anon_id" text PRIMARY KEY NOT NULL,
	"first_source" text NOT NULL,
	"first_medium" text,
	"first_campaign" text,
	"first_term" text,
	"first_content" text,
	"first_path" text NOT NULL,
	"first_referrer" text,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_source" text NOT NULL,
	"last_medium" text,
	"last_campaign" text,
	"last_term" text,
	"last_content" text,
	"last_path" text NOT NULL,
	"last_referrer" text,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text,
	"anon_id" text NOT NULL,
	"session_id" text NOT NULL,
	"contact_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text,
	"locale" text,
	"visitor_kind" text DEFAULT 'human' NOT NULL,
	"bot_reasons" text[] DEFAULT '{}' NOT NULL,
	"classification_override" text,
	"classification_note" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_classification_override_valid" CHECK ("analytics_events"."classification_override" is null or "analytics_events"."classification_override" in ('human', 'bot', 'suspected'))
);
--> statement-breakpoint
CREATE TABLE "assistant_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_scope_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"model" text,
	"base_url" text,
	"credential_ref" text,
	"input_cents_per_million" integer,
	"output_cents_per_million" integer,
	"max_output_tokens" integer DEFAULT 700 NOT NULL,
	"display_name" text,
	"spend_cap_cents" integer DEFAULT 0 NOT NULL,
	"spend_period" text DEFAULT 'month' NOT NULL,
	"replies_per_conversation" integer DEFAULT 20 NOT NULL,
	"replies_per_hour" integer DEFAULT 60 NOT NULL,
	"tone" text DEFAULT 'professional' NOT NULL,
	"refuse_topics" text[] DEFAULT '{}' NOT NULL,
	"escalate_topics" text[] DEFAULT '{}' NOT NULL,
	"contact_form_path" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_settings_singleton" CHECK ("assistant_settings"."id" = 1),
	CONSTRAINT "assistant_settings_spend_cap" CHECK ("assistant_settings"."spend_cap_cents" >= 0),
	CONSTRAINT "assistant_settings_max_output" CHECK ("assistant_settings"."max_output_tokens" between 64 and 4000),
	CONSTRAINT "assistant_settings_replies_per_conversation" CHECK ("assistant_settings"."replies_per_conversation" between 0 and 500),
	CONSTRAINT "assistant_settings_replies_per_hour" CHECK ("assistant_settings"."replies_per_hour" between 0 and 5000),
	CONSTRAINT "assistant_settings_prices" CHECK (("assistant_settings"."input_cents_per_million" is null or "assistant_settings"."input_cents_per_million" >= 0)
        and ("assistant_settings"."output_cents_per_million" is null or "assistant_settings"."output_cents_per_million" >= 0)),
	CONSTRAINT "assistant_settings_model_present" CHECK ("assistant_settings"."provider" = 'none' or "assistant_settings"."model" is not null)
);
--> statement-breakpoint
CREATE TABLE "assistant_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"chat_session_id" uuid,
	"message_id" uuid,
	"outcome" text NOT NULL,
	"detail" text,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"action" text,
	"action_allowed" boolean,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_turns_cost" CHECK ("assistant_turns"."cost_cents" >= 0),
	CONSTRAINT "assistant_turns_tokens" CHECK ("assistant_turns"."input_tokens" >= 0 and "assistant_turns"."output_tokens" >= 0),
	CONSTRAINT "assistant_turns_detail" CHECK ("assistant_turns"."detail" is null or char_length("assistant_turns"."detail") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"question" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"knowledge_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_contact_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"last_entered_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"note" text,
	"trigger_kind" text NOT NULL,
	"event_pattern" text,
	"schedule_cron" text,
	"entry_segment_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"trigger_kind" text DEFAULT 'event' NOT NULL,
	"event_pattern" text,
	"schedule_cron" text,
	"timezone" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"entry_segment_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"draft_graph" jsonb,
	"autonomy_ceiling" text,
	"budget_minor" integer,
	"reentry" text DEFAULT 'once' NOT NULL,
	"cooldown_days" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_code_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief" text NOT NULL,
	"plugin_name" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered_as" text,
	"pull_request_url" text,
	"branch" text,
	"refusal_reason" text,
	"model" text NOT NULL,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_by_actor" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_code_proposals_status_valid" CHECK ("builder_code_proposals"."status" in ('ready','refused','delivered','rejected')),
	CONSTRAINT "builder_code_proposals_refusal_reason" CHECK ("builder_code_proposals"."status" <> 'refused' or "builder_code_proposals"."refusal_reason" is not null),
	CONSTRAINT "builder_code_proposals_delivery" CHECK ("builder_code_proposals"."status" <> 'delivered'
          or ("builder_code_proposals"."delivered_as" is not null and "builder_code_proposals"."delivered_at" is not null)),
	CONSTRAINT "builder_code_proposals_usage_valid" CHECK ("builder_code_proposals"."input_tokens" >= 0 and "builder_code_proposals"."output_tokens" >= 0),
	CONSTRAINT "builder_code_proposals_files_valid" CHECK (jsonb_typeof("builder_code_proposals"."files") = 'array')
);
--> statement-breakpoint
CREATE TABLE "builder_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief" text NOT NULL,
	"lane" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"base_snapshot" jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"apply_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_by_actor" text NOT NULL,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_proposals_lane_valid" CHECK ("builder_proposals"."lane" in ('structure','vocabulary','refused')),
	CONSTRAINT "builder_proposals_status_valid" CHECK ("builder_proposals"."status" in ('ready','applied','rejected','stale','rolled_back')),
	CONSTRAINT "builder_proposals_usage_valid" CHECK ("builder_proposals"."input_tokens" >= 0 and "builder_proposals"."output_tokens" >= 0 and "builder_proposals"."total_tokens" >= "builder_proposals"."input_tokens" + "builder_proposals"."output_tokens"),
	CONSTRAINT "builder_proposals_changes_valid" CHECK (jsonb_typeof("builder_proposals"."changes") = 'array' and ("builder_proposals"."lane" = 'structure' or jsonb_array_length("builder_proposals"."changes") = 0)),
	CONSTRAINT "builder_proposals_lifecycle_valid" CHECK (("builder_proposals"."status" <> 'applied' or "builder_proposals"."applied_at" is not null) and ("builder_proposals"."status" <> 'rolled_back' or ("builder_proposals"."applied_at" is not null and "builder_proposals"."rolled_back_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text,
	"group_name" text,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_comparable" boolean DEFAULT false NOT NULL,
	"enum_options" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_key_valid" CHECK (char_length("attribute_definitions"."key") between 1 and 40 and "attribute_definitions"."key" ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
	CONSTRAINT "attribute_definitions_label_valid" CHECK (char_length("attribute_definitions"."label") between 1 and 80),
	CONSTRAINT "attribute_definitions_kind_valid" CHECK ("attribute_definitions"."kind" in ('text','number','bool','enum','measure')),
	CONSTRAINT "attribute_definitions_measure_unit" CHECK ("attribute_definitions"."kind" <> 'measure' or ("attribute_definitions"."unit" is not null and char_length("attribute_definitions"."unit") between 1 and 24))
);
--> statement-breakpoint
CREATE TABLE "back_in_stock_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"location_id" uuid,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_product_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_mode" text DEFAULT 'sum' NOT NULL,
	"amount_minor" bigint,
	"percent_off_ppm" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_components_qty_positive" CHECK ("bundle_components"."quantity" > 0),
	CONSTRAINT "bundle_components_mode_valid" CHECK ("bundle_components"."price_mode" in ('sum','fixed','percent_off')),
	CONSTRAINT "bundle_components_fixed_amount" CHECK (("bundle_components"."price_mode" <> 'fixed' and "bundle_components"."amount_minor" is null) or ("bundle_components"."price_mode" = 'fixed' and "bundle_components"."amount_minor" > 0)),
	CONSTRAINT "bundle_components_percent" CHECK (("bundle_components"."price_mode" <> 'percent_off' and "bundle_components"."percent_off_ppm" is null) or ("bundle_components"."price_mode" = 'percent_off' and "bundle_components"."percent_off_ppm" between 1 and 1000000)),
	CONSTRAINT "bundle_components_position_valid" CHECK ("bundle_components"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"free_until_hours" integer DEFAULT 24 NOT NULL,
	"fee_type" text DEFAULT 'none' NOT NULL,
	"fee_value" bigint,
	"reschedule_limit" integer DEFAULT 1 NOT NULL,
	"no_show_fee_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_policies_name_valid" CHECK (char_length("cancellation_policies"."name") between 1 and 80),
	CONSTRAINT "cancellation_policies_free_hours" CHECK ("cancellation_policies"."free_until_hours" >= 0),
	CONSTRAINT "cancellation_policies_reschedule" CHECK ("cancellation_policies"."reschedule_limit" >= 0),
	CONSTRAINT "cancellation_policies_no_show" CHECK ("cancellation_policies"."no_show_fee_minor" >= 0),
	CONSTRAINT "cancellation_policies_fee_type" CHECK ("cancellation_policies"."fee_type" in ('none','fixed','percent','forfeit_deposit')),
	CONSTRAINT "cancellation_policies_fee_value" CHECK (("cancellation_policies"."fee_type" in ('none','forfeit_deposit') and "cancellation_policies"."fee_value" is null)
        or ("cancellation_policies"."fee_type" = 'fixed' and "cancellation_policies"."fee_value" > 0)
        or ("cancellation_policies"."fee_type" = 'percent' and "cancellation_policies"."fee_value" between 1 and 1000000))
);
--> statement-breakpoint
CREATE TABLE "cart_coupons" (
	"cart_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid,
	"quantity" integer NOT NULL,
	"reservation_id" uuid,
	"gallery_id" uuid,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_qty" CHECK ("cart_items"."quantity" > 0),
	CONSTRAINT "cart_items_provenance" CHECK (("cart_items"."gallery_id" is null and "cart_items"."asset_id" is null) or ("cart_items"."gallery_id" is not null and "cart_items"."asset_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "cart_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"coupon_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"contact_id" uuid,
	"currency" text NOT NULL,
	"kind" text DEFAULT 'cart' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"name" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_currency" CHECK ("carts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "carts_kind_valid" CHECK ("carts"."kind" in ('cart','saved')),
	CONSTRAINT "carts_status_valid" CHECK ("carts"."status" in ('open','converted','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"cart_id" uuid,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_discount" CHECK ("coupon_redemptions"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_off_ppm" integer,
	"amount_minor" bigint,
	"currency" text,
	"min_subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"max_redemptions" integer,
	"per_contact_limit" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"recovery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_valid" CHECK ("coupons"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
	CONSTRAINT "coupons_kind_valid" CHECK ("coupons"."kind" in ('percent','fixed','free_shipping')),
	CONSTRAINT "coupons_percent" CHECK ("coupons"."percent_off_ppm" is null or ("coupons"."percent_off_ppm" > 0 and "coupons"."percent_off_ppm" <= 1000000)),
	CONSTRAINT "coupons_amount" CHECK ("coupons"."amount_minor" is null or "coupons"."amount_minor" > 0),
	CONSTRAINT "coupons_currency" CHECK ("coupons"."currency" is null or "coupons"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "coupons_min" CHECK ("coupons"."min_subtotal_minor" >= 0),
	CONSTRAINT "coupons_limits" CHECK (("coupons"."max_redemptions" is null or "coupons"."max_redemptions" > 0) and "coupons"."per_contact_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tag" text,
	"lifecycle_stage" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"exemption_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_groups_name_valid" CHECK (char_length("customer_groups"."name") between 1 and 80),
	CONSTRAINT "customer_groups_tag_valid" CHECK ("customer_groups"."tag" is null or (char_length("customer_groups"."tag") between 1 and 50)),
	CONSTRAINT "customer_groups_lifecycle_valid" CHECK ("customer_groups"."lifecycle_stage" is null or "customer_groups"."lifecycle_stage" in ('lead','prospect','customer','repeat'))
);
--> statement-breakpoint
CREATE TABLE "delivery_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"on_date" timestamp with time zone,
	"starts" text NOT NULL,
	"ends" text NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"cutoff_hours" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_windows_capacity" CHECK ("delivery_windows"."capacity" > 0),
	CONSTRAINT "delivery_windows_cutoff" CHECK ("delivery_windows"."cutoff_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "digital_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"token" text NOT NULL,
	"asset_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_items_qty" CHECK ("fulfillment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid,
	"kind" text DEFAULT 'physical' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"box_id" uuid,
	"weight_g" integer,
	"carrier" text,
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_kind_valid" CHECK ("fulfillments"."kind" in ('physical','digital')),
	CONSTRAINT "fulfillments_status_valid" CHECK ("fulfillments"."status" in ('pending','picking','packed','shipped','delivered','failed','returned')),
	CONSTRAINT "fulfillments_weight" CHECK ("fulfillments"."weight_g" is null or "fulfillments"."weight_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gift_card_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_redemptions_amount" CHECK ("gift_card_redemptions"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"currency" text NOT NULL,
	"issued_minor" bigint NOT NULL,
	"remaining_minor" bigint NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"share_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_valid" CHECK ("gift_cards"."code" ~ '^[A-Z0-9][A-Z0-9-]{7,31}$'),
	CONSTRAINT "gift_cards_currency" CHECK ("gift_cards"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gift_cards_status_valid" CHECK ("gift_cards"."status" in ('active','redeemed','void')),
	CONSTRAINT "gift_cards_amounts" CHECK ("gift_cards"."issued_minor" > 0 and "gift_cards"."remaining_minor" >= 0 and "gift_cards"."remaining_minor" <= "gift_cards"."issued_minor")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"bin" text,
	"safety_stock" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"incoming" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_safety" CHECK ("inventory_items"."safety_stock" >= 0),
	CONSTRAINT "inventory_items_reorder" CHECK ("inventory_items"."reorder_point" >= 0),
	CONSTRAINT "inventory_items_incoming" CHECK ("inventory_items"."incoming" >= 0),
	CONSTRAINT "inventory_items_bin_valid" CHECK ("inventory_items"."bin" is null or char_length("inventory_items"."bin") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "offer_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"trigger_variant_id" uuid,
	"offer_variant_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_rules_kind_valid" CHECK ("offer_rules"."kind" in ('bump','post_add')),
	CONSTRAINT "offer_rules_name_valid" CHECK (char_length("offer_rules"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "option_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_types_code_valid" CHECK (char_length("option_types"."code") between 1 and 40 and "option_types"."code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "option_types_name_valid" CHECK (char_length("option_types"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku_fragment" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_values_fragment_valid" CHECK (char_length("option_values"."sku_fragment") between 1 and 24 and "option_values"."sku_fragment" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "option_values_name_valid" CHECK (char_length("option_values"."name") between 1 and 80),
	CONSTRAINT "option_values_position_valid" CHECK ("option_values"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gallery_id" uuid,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_provenance" CHECK (("order_items"."gallery_id" is null and "order_items"."asset_id" is null) or ("order_items"."gallery_id" is not null and "order_items"."asset_id" is not null)),
	CONSTRAINT "order_items_qty" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_amounts" CHECK ("order_items"."unit_amount_minor" >= 0 and "order_items"."line_total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"cart_id" uuid,
	"invoice_id" uuid,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"coupon_id" uuid,
	"shipping_method_id" uuid,
	"shipping_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_currency" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('pending_payment','paid','fulfilling','fulfilled','refunded','cancelled')),
	CONSTRAINT "orders_totals" CHECK ("orders"."subtotal_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."shipping_minor" >= 0 and "orders"."tax_minor" >= 0 and "orders"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "packaging_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"inner_length_mm" integer NOT NULL,
	"inner_width_mm" integer NOT NULL,
	"inner_height_mm" integer NOT NULL,
	"max_weight_g" integer NOT NULL,
	"tare_weight_g" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_boxes_name" CHECK (char_length("packaging_boxes"."name") between 1 and 80),
	CONSTRAINT "packaging_boxes_dims" CHECK ("packaging_boxes"."inner_length_mm" > 0 and "packaging_boxes"."inner_width_mm" > 0 and "packaging_boxes"."inner_height_mm" > 0),
	CONSTRAINT "packaging_boxes_weight" CHECK ("packaging_boxes"."max_weight_g" > 0 and "packaging_boxes"."tare_weight_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid,
	"mode" text NOT NULL,
	"min_qty" integer NOT NULL,
	"max_qty" integer,
	"unit_amount_minor" bigint,
	"percent_off_ppm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_breaks_mode_valid" CHECK ("price_breaks"."mode" in ('volume','tiered')),
	CONSTRAINT "price_breaks_min_positive" CHECK ("price_breaks"."min_qty" > 0),
	CONSTRAINT "price_breaks_window_valid" CHECK ("price_breaks"."max_qty" is null or "price_breaks"."max_qty" >= "price_breaks"."min_qty"),
	CONSTRAINT "price_breaks_price_xor" CHECK (("price_breaks"."unit_amount_minor" is not null and "price_breaks"."percent_off_ppm" is null and "price_breaks"."unit_amount_minor" > 0)
        or ("price_breaks"."unit_amount_minor" is null and "price_breaks"."percent_off_ppm" between 1 and 1000000))
);
--> statement-breakpoint
CREATE TABLE "price_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"compare_at_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_entries_amount_positive" CHECK ("price_list_entries"."amount_minor" > 0),
	CONSTRAINT "price_list_entries_compare_valid" CHECK ("price_list_entries"."compare_at_minor" is null or "price_list_entries"."compare_at_minor" > "price_list_entries"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"kind" text DEFAULT 'retail' NOT NULL,
	"customer_group_id" uuid,
	"segment_id" uuid,
	"contact_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_name_valid" CHECK (char_length("price_lists"."name") between 1 and 120),
	CONSTRAINT "price_lists_currency_valid" CHECK ("price_lists"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_lists_kind_valid" CHECK ("price_lists"."kind" in ('retail','wholesale','member','sale','contract')),
	CONSTRAINT "price_lists_contract_contact" CHECK (("price_lists"."kind" = 'contract' and "price_lists"."contact_id" is not null) or ("price_lists"."kind" <> 'contract' and "price_lists"."contact_id" is null)),
	CONSTRAINT "price_lists_window_valid" CHECK ("price_lists"."starts_at" is null or "price_lists"."ends_at" is null or "price_lists"."ends_at" > "price_lists"."starts_at"),
	CONSTRAINT "price_lists_priority_valid" CHECK ("price_lists"."priority" between -100000 and 100000)
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"plan_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_rules_mode_valid" CHECK ("price_rules"."mode" in ('full','deposit_balance','payment_plan','hourly','retainer'))
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"text_value" text,
	"number_value" text,
	"bool_value" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_attributes_number_valid" CHECK ("product_attributes"."number_value" is null or "product_attributes"."number_value" ~ '^-?[0-9]+(\.[0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "product_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_visibility" text,
	"to_visibility" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_lifecycle_events_status_valid" CHECK ("product_lifecycle_events"."from_status" is null or "product_lifecycle_events"."from_status" in ('draft','active','archived')),
	CONSTRAINT "product_lifecycle_events_to_status_valid" CHECK ("product_lifecycle_events"."to_status" in ('draft','active','archived')),
	CONSTRAINT "product_lifecycle_events_visibility_valid" CHECK (("product_lifecycle_events"."from_visibility" is null or "product_lifecycle_events"."from_visibility" in ('public','unlisted','member_only'))
        and "product_lifecycle_events"."to_visibility" in ('public','unlisted','member_only')),
	CONSTRAINT "product_lifecycle_events_version_positive" CHECK ("product_lifecycle_events"."resulting_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'gallery' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_role_valid" CHECK ("product_media"."role" in ('hero','gallery','swatch','size_chart','lifestyle','360','model')),
	CONSTRAINT "product_media_position_valid" CHECK ("product_media"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_option_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"option_type_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_assignments_position_valid" CHECK ("product_option_assignments"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_option_value_assignments" (
	"assignment_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"related_product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_relations_kind_valid" CHECK ("product_relations"."kind" in ('upsell','cross_sell','accessory','replacement','variant_of')),
	CONSTRAINT "product_relations_not_self" CHECK ("product_relations"."product_id" <> "product_relations"."related_product_id"),
	CONSTRAINT "product_relations_position_valid" CHECK ("product_relations"."position" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "product_variant_options" (
	"variant_id" uuid NOT NULL,
	"option_type_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"combination_key" text NOT NULL,
	"sku" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"backorder_policy" text DEFAULT 'refuse' NOT NULL,
	"expected_restock_at" timestamp with time zone,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"weight_g" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_valid" CHECK (char_length("product_variants"."sku") between 1 and 180 and "product_variants"."sku" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "product_variants_status_valid" CHECK ("product_variants"."status" in ('active','archived')),
	CONSTRAINT "product_variants_combination_valid" CHECK (char_length("product_variants"."combination_key") > 0),
	CONSTRAINT "product_variants_backorder_valid" CHECK ("product_variants"."backorder_policy" in ('refuse','allow_date','allow_silent')),
	CONSTRAINT "product_variants_weight" CHECK ("product_variants"."weight_g" is null or "product_variants"."weight_g" >= 0),
	CONSTRAINT "product_variants_dims" CHECK (("product_variants"."length_mm" is null and "product_variants"."width_mm" is null and "product_variants"."height_mm" is null)
        or ("product_variants"."length_mm" > 0 and "product_variants"."width_mm" > 0 and "product_variants"."height_mm" > 0))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"subtitle" text,
	"description" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"tax_category_id" uuid,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"working_name" text,
	"working_subtitle" text,
	"working_description" jsonb,
	"working_seo" jsonb,
	"schema_type" text DEFAULT 'Product' NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_valid" CHECK (char_length("products"."slug") between 1 and 180 and "products"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "products_name_valid" CHECK (char_length("products"."name") between 1 and 240),
	CONSTRAINT "products_kind_valid" CHECK ("products"."kind" in ('physical','digital','service','rental','bundle','pass')),
	CONSTRAINT "products_status_valid" CHECK ("products"."status" in ('draft','active','archived')),
	CONSTRAINT "products_visibility_valid" CHECK ("products"."visibility" in ('public','unlisted','member_only')),
	CONSTRAINT "products_schema_type_valid" CHECK ("products"."schema_type" in ('Product','Service')),
	CONSTRAINT "products_version_positive" CHECK ("products"."version" > 0),
	CONSTRAINT "products_lifecycle_timestamps" CHECK (("products"."status" = 'active' and "products"."published_at" is not null and "products"."archived_at" is null)
        or ("products"."status" = 'draft' and "products"."archived_at" is null)
        or ("products"."status" = 'archived' and "products"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_qty" CHECK ("purchase_order_lines"."quantity" > 0),
	CONSTRAINT "purchase_order_lines_received" CHECK ("purchase_order_lines"."received_qty" >= 0 and "purchase_order_lines"."received_qty" <= "purchase_order_lines"."quantity"),
	CONSTRAINT "purchase_order_lines_cost" CHECK ("purchase_order_lines"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"expected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" in ('draft','ordered','partial','received','cancelled')),
	CONSTRAINT "purchase_orders_currency" CHECK ("purchase_orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"restocked_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_qty" CHECK ("return_items"."quantity" > 0),
	CONSTRAINT "return_items_restocked" CHECK ("return_items"."restocked_quantity" >= 0 and "return_items"."restocked_quantity" <= "return_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"label_url" text,
	"credit_note_id" uuid,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_requests_status_valid" CHECK ("return_requests"."status" in ('requested','approved','received','refunded','rejected')),
	CONSTRAINT "return_requests_reason" CHECK (char_length("return_requests"."reason") between 3 and 1000)
);
--> statement-breakpoint
CREATE TABLE "service_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"location_type" text NOT NULL,
	"deposit_type" text DEFAULT 'none' NOT NULL,
	"deposit_value" bigint DEFAULT 0 NOT NULL,
	"cancellation_policy_id" uuid,
	"intake_form_id" uuid,
	"waiver_template_id" uuid,
	"waiver_title" text,
	"waiver_body" text,
	"reminder_offsets_min" integer[] DEFAULT '{1440,120}' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"assignment" text DEFAULT 'specific' NOT NULL,
	"calendar_ids" uuid[] DEFAULT '{}' NOT NULL,
	"travel_time_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_offerings_duration" CHECK ("service_offerings"."duration_min" > 0),
	CONSTRAINT "service_offerings_buffer_before" CHECK ("service_offerings"."buffer_before_min" >= 0),
	CONSTRAINT "service_offerings_buffer_after" CHECK ("service_offerings"."buffer_after_min" >= 0),
	CONSTRAINT "service_offerings_capacity" CHECK ("service_offerings"."capacity" > 0),
	CONSTRAINT "service_offerings_travel" CHECK ("service_offerings"."travel_time_min" >= 0),
	CONSTRAINT "service_offerings_location" CHECK ("service_offerings"."location_type" in ('in_person','virtual','client_site')),
	CONSTRAINT "service_offerings_assignment" CHECK ("service_offerings"."assignment" in ('specific','pool','round_robin')),
	CONSTRAINT "service_offerings_deposit_type" CHECK ("service_offerings"."deposit_type" in ('none','fixed','percent')),
	CONSTRAINT "service_offerings_deposit_value" CHECK (("service_offerings"."deposit_type" = 'none' and "service_offerings"."deposit_value" = 0)
        or ("service_offerings"."deposit_type" = 'fixed' and "service_offerings"."deposit_value" > 0)
        or ("service_offerings"."deposit_type" = 'percent' and "service_offerings"."deposit_value" between 1 and 1000000))
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"handling_fee_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint,
	"threshold_minor" bigint,
	"min_days" integer,
	"max_days" integer,
	"taxable" boolean DEFAULT true NOT NULL,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_name_valid" CHECK (char_length("shipping_methods"."name") between 1 and 80),
	CONSTRAINT "shipping_methods_kind_valid" CHECK ("shipping_methods"."kind" in ('flat','weight','price','item','dimensional','free','pickup','local_delivery')),
	CONSTRAINT "shipping_methods_handling" CHECK ("shipping_methods"."handling_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_rate_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_id" uuid NOT NULL,
	"min_value" integer DEFAULT 0 NOT NULL,
	"max_value" integer,
	"amount_minor" bigint NOT NULL,
	"per_unit_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_rate_bands_min" CHECK ("shipping_rate_bands"."min_value" >= 0),
	CONSTRAINT "shipping_rate_bands_window" CHECK ("shipping_rate_bands"."max_value" is null or "shipping_rate_bands"."max_value" >= "shipping_rate_bands"."min_value"),
	CONSTRAINT "shipping_rate_bands_amount" CHECK ("shipping_rate_bands"."amount_minor" >= 0),
	CONSTRAINT "shipping_rate_bands_unit" CHECK ("shipping_rate_bands"."per_unit_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"postal_patterns" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_name_valid" CHECK (char_length("shipping_zones"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_nonzero" CHECK ("stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_reason_valid" CHECK ("stock_movements"."reason" in ('sale','return','adjustment','transfer','receipt','damage','count'))
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_qty_positive" CHECK ("stock_reservations"."quantity" > 0),
	CONSTRAINT "stock_reservations_holder_valid" CHECK ("stock_reservations"."holder_type" in ('cart','order','booking')),
	CONSTRAINT "stock_reservations_status_valid" CHECK ("stock_reservations"."status" in ('active','consumed','released','expired'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_id" uuid,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_valid" CHECK (char_length("suppliers"."name") between 1 and 120),
	CONSTRAINT "suppliers_lead_time" CHECK ("suppliers"."lead_time_days" >= 0),
	CONSTRAINT "suppliers_currency" CHECK ("suppliers"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text DEFAULT 'Wishlist' NOT NULL,
	"share_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_name_valid" CHECK (char_length("wishlists"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_id" uuid,
	"block_id" text,
	"parent_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text DEFAULT 'comment' NOT NULL,
	"reviewer" text,
	"review_state" text DEFAULT 'none' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"detached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"editing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_preview_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name" text,
	"kind" text DEFAULT 'autosave' NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"preset" text NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" text[] DEFAULT '{}' NOT NULL,
	"origin" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"working_title" text,
	"working_blocks" jsonb,
	"working_seo" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"scheduled_publish_at" timestamp with time zone,
	"scheduled_unpublish_at" timestamp with time zone,
	"approval_state" text DEFAULT 'none' NOT NULL,
	"approval_note" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"edit_lease_actor" text,
	"edit_lease_until" timestamp with time zone,
	"help_category_id" uuid,
	"helpful_yes" integer DEFAULT 0 NOT NULL,
	"helpful_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'reusable' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"template_id" uuid,
	"kind" text DEFAULT 'waiver' NOT NULL,
	"title" text NOT NULL,
	"body_snapshot" text NOT NULL,
	"body_hash" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"sign_token" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"signer_name" text,
	"signer_email" text,
	"signer_ip" text,
	"signer_user_agent" text,
	"signature_hash" text,
	"decline_reason" text,
	"countersigned_at" timestamp with time zone,
	"countersigner_user_id" uuid,
	"countersigner_name" text,
	"countersignature_hash" text,
	"requires_countersignature" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_documents_title_valid" CHECK (char_length("contract_documents"."title") between 1 and 200),
	CONSTRAINT "contract_documents_body_present" CHECK (char_length("contract_documents"."body_snapshot") > 0),
	CONSTRAINT "contract_documents_signed_complete" CHECK ("contract_documents"."status" <> 'signed'
        or ("contract_documents"."signed_at" is not null and "contract_documents"."signature_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'waiver' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_countersignature" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_templates_version" CHECK ("contract_templates"."version" > 0),
	CONSTRAINT "contract_templates_name" CHECK (char_length("contract_templates"."name") between 1 and 120),
	CONSTRAINT "contract_templates_body" CHECK (char_length("contract_templates"."body") > 0)
);
--> statement-breakpoint
CREATE TABLE "contact_stages" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"stage_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"probability" integer,
	"expected_close_on" date,
	"source" text,
	"owner_user_id" uuid,
	"quote_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"lost_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_title" CHECK (char_length("deals"."title") between 1 and 200),
	CONSTRAINT "deals_value" CHECK ("deals"."value_minor" >= 0),
	CONSTRAINT "deals_probability" CHECK ("deals"."probability" is null or "deals"."probability" between 0 and 100),
	CONSTRAINT "deals_closed_has_time" CHECK ("deals"."status" = 'open' or "deals"."closed_at" is not null),
	CONSTRAINT "deals_lost_has_reason" CHECK ("deals"."status" <> 'lost' or "deals"."lost_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"tone" text,
	"probability" integer,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"lifecycle_stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_name" CHECK (char_length("pipeline_stages"."name") between 1 and 60),
	CONSTRAINT "pipeline_stages_probability" CHECK ("pipeline_stages"."probability" is null or "pipeline_stages"."probability" between 0 and 100),
	CONSTRAINT "pipeline_stages_outcome" CHECK (not ("pipeline_stages"."is_won" and "pipeline_stages"."is_lost"))
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_name" CHECK (char_length("pipelines"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "document_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid,
	"share_id" uuid,
	"contact_id" uuid,
	"action" text NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"contact_id" uuid,
	"access" text NOT NULL,
	"secret_hash" text,
	"token_hash" text,
	"pinned_version_id" uuid,
	"download_policy" text DEFAULT 'download' NOT NULL,
	"download_limit" integer,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_secret" CHECK (("document_shares"."access" = 'password' and "document_shares"."secret_hash" is not null) or ("document_shares"."access" <> 'password' and "document_shares"."secret_hash" is null)),
	CONSTRAINT "document_shares_token" CHECK (("document_shares"."access" = 'login' and "document_shares"."token_hash" is null) or ("document_shares"."access" <> 'login' and "document_shares"."token_hash" is not null)),
	CONSTRAINT "document_shares_limit" CHECK ("document_shares"."download_limit" is null or "document_shares"."download_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"subject_type" text,
	"subject_id" uuid,
	"contact_id" uuid,
	"current_version_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"ticket_id" uuid,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"checked_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_quantity_positive" CHECK ("event_registrations"."quantity" > 0),
	CONSTRAINT "event_registrations_status_valid" CHECK ("event_registrations"."status" in ('reserved','confirmed','waitlisted','cancelled','checked_in'))
);
--> statement-breakpoint
CREATE TABLE "event_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sessions_capacity_nonneg" CHECK ("event_sessions"."capacity" >= 0),
	CONSTRAINT "event_sessions_ends_after_start" CHECK ("event_sessions"."ends_at" > "event_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "event_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_tickets_name_valid" CHECK (char_length("event_tickets"."name") between 1 and 120),
	CONSTRAINT "event_tickets_price_nonneg" CHECK ("event_tickets"."price_minor" >= 0),
	CONSTRAINT "event_tickets_currency_valid" CHECK (char_length("event_tickets"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"venue_name" text,
	"venue_address" text,
	"venue_location_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"working_name" text,
	"working_summary" text,
	"working_venue_name" text,
	"working_venue_address" text,
	"working_seo" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_valid" CHECK (char_length("events"."slug") between 1 and 180 and "events"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "events_name_valid" CHECK (char_length("events"."name") between 1 and 240),
	CONSTRAINT "events_status_valid" CHECK ("events"."status" in ('draft','published','cancelled')),
	CONSTRAINT "events_version_positive" CHECK ("events"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"contact_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'received' NOT NULL,
	"spam_reasons" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submit_label" text,
	"success_message" text,
	"destination" text DEFAULT 'contact' NOT NULL,
	"notify" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "galleries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'client_delivery' NOT NULL,
	"cover_asset_id" uuid,
	"access" text NOT NULL,
	"secret_hash" text,
	"expires_at" timestamp with time zone,
	"download_policy" text DEFAULT 'none' NOT NULL,
	"download_limit" integer,
	"watermark" boolean DEFAULT false NOT NULL,
	"client_can_invite_partner" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "galleries_title" CHECK (char_length("galleries"."title") between 1 and 160),
	CONSTRAINT "galleries_slug" CHECK ("galleries"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "galleries_kind" CHECK ("galleries"."kind" in ('portfolio', 'client_delivery')),
	CONSTRAINT "galleries_access" CHECK ("galleries"."access" in ('password', 'pin', 'login')),
	CONSTRAINT "galleries_download_policy" CHECK ("galleries"."download_policy" in ('none', 'web_res', 'full_res', 'limit_n')),
	CONSTRAINT "galleries_secret" CHECK (("galleries"."access" = 'login' and "galleries"."secret_hash" is null) or ("galleries"."access" in ('password', 'pin') and "galleries"."secret_hash" is not null)),
	CONSTRAINT "galleries_download_limit" CHECK (("galleries"."download_policy" = 'limit_n' and "galleries"."download_limit" is not null and "galleries"."download_limit" > 0) or ("galleries"."download_policy" <> 'limit_n' and "galleries"."download_limit" is null))
);
--> statement-breakpoint
CREATE TABLE "gallery_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid,
	"action" text NOT NULL,
	"asset_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_access_logs_action" CHECK ("gallery_access_logs"."action" in ('view', 'download', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "gallery_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"state" text DEFAULT 'building' NOT NULL,
	"storage_key" text,
	"bytes" integer,
	"file_count" integer,
	"error" text,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_archives_state" CHECK ("gallery_archives"."state" in ('building', 'ready', 'failed')),
	CONSTRAINT "gallery_archives_ready" CHECK (("gallery_archives"."state" = 'ready' and "gallery_archives"."storage_key" is not null and "gallery_archives"."built_at" is not null) or ("gallery_archives"."state" <> 'ready' and "gallery_archives"."storage_key" is null))
);
--> statement-breakpoint
CREATE TABLE "gallery_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"token_hash" text,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"invited_by_contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_guests_role" CHECK ("gallery_guests"."role" in ('client', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_price_sheet_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"submitted_by_contact_id" uuid,
	"note" text,
	"snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_rounds_sequence" CHECK ("gallery_rounds"."sequence" >= 1),
	CONSTRAINT "gallery_rounds_state" CHECK ("gallery_rounds"."state" in ('open', 'submitted', 'approved', 'reopened')),
	CONSTRAINT "gallery_rounds_decided" CHECK (("gallery_rounds"."state" in ('approved', 'reopened') and "gallery_rounds"."decided_at" is not null) or ("gallery_rounds"."state" in ('open', 'submitted') and "gallery_rounds"."decided_at" is null)),
	CONSTRAINT "gallery_rounds_submitted" CHECK (("gallery_rounds"."state" = 'open' and "gallery_rounds"."submitted_at" is null) or ("gallery_rounds"."state" <> 'open' and "gallery_rounds"."submitted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "gallery_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_selections_kind" CHECK ("gallery_selections"."kind" in ('favorite', 'select', 'reject')),
	CONSTRAINT "gallery_selections_comment" CHECK ("gallery_selections"."comment" is null or char_length("gallery_selections"."comment") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "gallery_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"contact_id" uuid,
	"guest_id" uuid,
	"downloads_used" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_micros" bigint NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_lines_position_valid" CHECK ("credit_note_lines"."position" >= 0),
	CONSTRAINT "credit_note_lines_quantity_positive" CHECK ("credit_note_lines"."quantity_micros" > 0),
	CONSTRAINT "credit_note_lines_amounts_nonnegative" CHECK ("credit_note_lines"."subtotal_minor" >= 0 and "credit_note_lines"."tax_minor" >= 0 and "credit_note_lines"."total_minor" >= 0),
	CONSTRAINT "credit_note_lines_total_consistent" CHECK ("credit_note_lines"."total_minor" = "credit_note_lines"."subtotal_minor" + "credit_note_lines"."tax_minor")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text,
	"sequence_key" text DEFAULT 'credit-note' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_currency_valid" CHECK ("credit_notes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "credit_notes_request_hash_valid" CHECK (length("credit_notes"."request_hash") = 64),
	CONSTRAINT "credit_notes_status_valid" CHECK ("credit_notes"."status" in ('draft','issued','void')),
	CONSTRAINT "credit_notes_amounts_nonnegative" CHECK ("credit_notes"."subtotal_minor" >= 0 and "credit_notes"."tax_minor" >= 0 and "credit_notes"."total_minor" >= 0),
	CONSTRAINT "credit_notes_total_consistent" CHECK ("credit_notes"."total_minor" = "credit_notes"."subtotal_minor" + "credit_notes"."tax_minor"),
	CONSTRAINT "credit_notes_issued_consistent" CHECK (("credit_notes"."status" = 'draft' and "credit_notes"."number" is null and "credit_notes"."issued_at" is null) or ("credit_notes"."status" <> 'draft' and "credit_notes"."number" is not null and "credit_notes"."issued_at" is not null)),
	CONSTRAINT "credit_notes_void_consistent" CHECK ("credit_notes"."status" <> 'void' or "credit_notes"."voided_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_balance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_balance_accounts_currency_valid" CHECK ("customer_balance_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_balance_accounts_nonnegative" CHECK ("customer_balance_accounts"."balance_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_balance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"delta_minor" bigint NOT NULL,
	"balance_after_minor" bigint DEFAULT 0 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_balance_entries_delta_nonzero" CHECK ("customer_balance_entries"."delta_minor" <> 0),
	CONSTRAINT "customer_balance_entries_request_hash_valid" CHECK (length("customer_balance_entries"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "flexible_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"attached_invoice_id" uuid,
	"kind" text NOT NULL,
	"context" text NOT NULL,
	"chosen_minor" bigint DEFAULT 0 NOT NULL,
	"minimum_minor" bigint DEFAULT 0 NOT NULL,
	"maximum_minor" bigint,
	"message" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flexible_payments_kind_valid" CHECK ("flexible_payments"."kind" in ('tip','pay_what_you_want')),
	CONSTRAINT "flexible_payments_context_valid" CHECK ("flexible_payments"."context" in ('checkout','invoice','gallery','booking','store','other')),
	CONSTRAINT "flexible_payments_chosen_positive" CHECK ("flexible_payments"."chosen_minor" > 0),
	CONSTRAINT "flexible_payments_minimum_valid" CHECK ("flexible_payments"."minimum_minor" >= 0 and "flexible_payments"."chosen_minor" >= "flexible_payments"."minimum_minor"),
	CONSTRAINT "flexible_payments_maximum_valid" CHECK ("flexible_payments"."maximum_minor" is null or ("flexible_payments"."maximum_minor" >= "flexible_payments"."minimum_minor" and "flexible_payments"."chosen_minor" <= "flexible_payments"."maximum_minor")),
	CONSTRAINT "flexible_payments_request_hash_valid" CHECK (length("flexible_payments"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_type" text,
	"source_id" text,
	"description" text NOT NULL,
	"quantity_micros" bigint NOT NULL,
	"unit_amount_minor" bigint DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"tax_category_code" text DEFAULT 'standard' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_position_valid" CHECK ("invoice_lines"."position" >= 0),
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity_micros" > 0),
	CONSTRAINT "invoice_lines_amounts_nonnegative" CHECK ("invoice_lines"."unit_amount_minor" >= 0 and "invoice_lines"."subtotal_minor" >= 0 and "invoice_lines"."discount_minor" >= 0 and "invoice_lines"."tax_minor" >= 0 and "invoice_lines"."total_minor" >= 0),
	CONSTRAINT "invoice_lines_discount_bounded" CHECK ("invoice_lines"."discount_minor" <= "invoice_lines"."subtotal_minor"),
	CONSTRAINT "invoice_lines_total_consistent" CHECK ("invoice_lines"."total_minor" = "invoice_lines"."subtotal_minor" - "invoice_lines"."discount_minor" + "invoice_lines"."tax_minor"),
	CONSTRAINT "invoice_lines_snapshot_object" CHECK (jsonb_typeof("invoice_lines"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT 'INV-' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_sequences_key_valid" CHECK (length(trim("invoice_sequences"."key")) between 1 and 80),
	CONSTRAINT "invoice_sequences_next_positive" CHECK ("invoice_sequences"."next_value" > 0),
	CONSTRAINT "invoice_sequences_padding_valid" CHECK ("invoice_sequences"."padding" between 1 and 18)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"number" text,
	"sequence_key" text DEFAULT 'invoice' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"tax_zone_id" uuid,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"billing_address" jsonb,
	"customer_tax_id" text,
	"required_tax_legend" text,
	"memo" text,
	"schedule" jsonb,
	"deposit_of_invoice_id" uuid,
	"due_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_currency_valid" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_request_hash_valid" CHECK (length("invoices"."request_hash") = 64),
	CONSTRAINT "invoices_status_valid" CHECK ("invoices"."status" in ('draft','sent','viewed','partially_paid','paid','overdue','void','refunded')),
	CONSTRAINT "invoices_amounts_nonnegative" CHECK ("invoices"."subtotal_minor" >= 0 and "invoices"."discount_minor" >= 0 and "invoices"."shipping_minor" >= 0 and "invoices"."tax_minor" >= 0 and "invoices"."total_minor" >= 0 and "invoices"."paid_minor" >= 0 and "invoices"."refunded_minor" >= 0),
	CONSTRAINT "invoices_total_consistent" CHECK ("invoices"."total_minor" = "invoices"."subtotal_minor" - "invoices"."discount_minor" + "invoices"."shipping_minor" + "invoices"."tax_minor"),
	CONSTRAINT "invoices_discount_bounded" CHECK ("invoices"."discount_minor" <= "invoices"."subtotal_minor"),
	CONSTRAINT "invoices_paid_bounded" CHECK ("invoices"."paid_minor" <= "invoices"."total_minor"),
	CONSTRAINT "invoices_refund_bounded" CHECK ("invoices"."refunded_minor" <= "invoices"."paid_minor"),
	CONSTRAINT "invoices_issued_consistent" CHECK (("invoices"."status" = 'draft' and "invoices"."number" is null and "invoices"."issued_at" is null) or ("invoices"."status" <> 'draft' and "invoices"."number" is not null and "invoices"."issued_at" is not null)),
	CONSTRAINT "invoices_paid_consistent" CHECK ("invoices"."status" <> 'paid' or ("invoices"."paid_minor" = "invoices"."total_minor" and "invoices"."paid_at" is not null)),
	CONSTRAINT "invoices_void_consistent" CHECK ("invoices"."status" <> 'void' or "invoices"."voided_at" is not null),
	CONSTRAINT "invoices_refunded_consistent" CHECK ("invoices"."status" <> 'refunded' or ("invoices"."refunded_minor" = "invoices"."paid_minor" and "invoices"."paid_minor" > 0)),
	CONSTRAINT "invoices_not_own_deposit" CHECK ("invoices"."deposit_of_invoice_id" is null or "invoices"."deposit_of_invoice_id" <> "invoices"."id")
);
--> statement-breakpoint
CREATE TABLE "late_fee_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_invoice_id" uuid NOT NULL,
	"fee_invoice_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"outstanding_minor" bigint DEFAULT 0 NOT NULL,
	"fixed_minor" bigint,
	"rate_ppm" integer,
	"cap_minor" bigint,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"assessed_minor" bigint DEFAULT 0 NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_assessments_basis_valid" CHECK ("late_fee_assessments"."basis" in ('fixed','percentage')),
	CONSTRAINT "late_fee_assessments_outstanding_positive" CHECK ("late_fee_assessments"."outstanding_minor" > 0),
	CONSTRAINT "late_fee_assessments_value_valid" CHECK (("late_fee_assessments"."basis" = 'fixed' and "late_fee_assessments"."fixed_minor" > 0 and "late_fee_assessments"."rate_ppm" is null) or ("late_fee_assessments"."basis" = 'percentage' and "late_fee_assessments"."fixed_minor" is null and "late_fee_assessments"."rate_ppm" between 1 and 10000000)),
	CONSTRAINT "late_fee_assessments_cap_valid" CHECK ("late_fee_assessments"."cap_minor" is null or "late_fee_assessments"."cap_minor" > 0),
	CONSTRAINT "late_fee_assessments_grace_valid" CHECK ("late_fee_assessments"."grace_days" between 0 and 3650),
	CONSTRAINT "late_fee_assessments_amount_positive" CHECK ("late_fee_assessments"."assessed_minor" > 0),
	CONSTRAINT "late_fee_assessments_request_hash_valid" CHECK (length("late_fee_assessments"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "money_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_state_events_subject_valid" CHECK ("money_state_events"."subject_type" in ('invoice','payment','refund','credit_note','dispute','payment_plan','payout')),
	CONSTRAINT "money_state_events_transition_valid" CHECK ("money_state_events"."from_state" is null or "money_state_events"."from_state" <> "money_state_events"."to_state"),
	CONSTRAINT "money_state_events_metadata_object" CHECK (jsonb_typeof("money_state_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"provider_payment_ref" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"evidence_due_at" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"provider_status_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_currency_valid" CHECK ("payment_disputes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_disputes_amount_positive" CHECK ("payment_disputes"."amount_minor" > 0),
	CONSTRAINT "payment_disputes_status_valid" CHECK ("payment_disputes"."status" in ('open','won','lost')),
	CONSTRAINT "payment_disputes_closed_consistent" CHECK (("payment_disputes"."status" = 'open' and "payment_disputes"."closed_at" is null) or ("payment_disputes"."status" <> 'open' and "payment_disputes"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_method_ref" text NOT NULL,
	"provider_customer_ref" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"brand" text,
	"last4" text,
	"expiry_month" integer,
	"expiry_year" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"consent_source" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"provider_status_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_provider_valid" CHECK (length(trim("payment_methods"."provider")) between 1 and 100),
	CONSTRAINT "payment_methods_ref_valid" CHECK (length(trim("payment_methods"."provider_method_ref")) between 1 and 500),
	CONSTRAINT "payment_methods_label_valid" CHECK (length(trim("payment_methods"."label")) between 1 and 200),
	CONSTRAINT "payment_methods_last4_valid" CHECK ("payment_methods"."last4" is null or "payment_methods"."last4" ~ '^[A-Za-z0-9]{2,4}$'),
	CONSTRAINT "payment_methods_expiry_pair" CHECK (("payment_methods"."expiry_month" is null and "payment_methods"."expiry_year" is null) or ("payment_methods"."expiry_month" between 1 and 12 and "payment_methods"."expiry_year" between 2000 and 9999)),
	CONSTRAINT "payment_methods_status_valid" CHECK ("payment_methods"."status" in ('active','revoked','expired')),
	CONSTRAINT "payment_methods_revocation_consistent" CHECK ("payment_methods"."status" <> 'revoked' or "payment_methods"."revoked_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_plan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plan_installments_position_valid" CHECK ("payment_plan_installments"."position" >= 0),
	CONSTRAINT "payment_plan_installments_amount_positive" CHECK ("payment_plan_installments"."amount_minor" > 0),
	CONSTRAINT "payment_plan_installments_paid_bounded" CHECK ("payment_plan_installments"."paid_minor" between 0 and "payment_plan_installments"."amount_minor"),
	CONSTRAINT "payment_plan_installments_status_valid" CHECK ("payment_plan_installments"."status" in ('scheduled','due','partially_paid','paid','waived','defaulted')),
	CONSTRAINT "payment_plan_installments_paid_consistent" CHECK ("payment_plan_installments"."status" <> 'paid' or "payment_plan_installments"."paid_minor" = "payment_plan_installments"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text NOT NULL,
	"principal_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plans_request_hash_valid" CHECK (length("payment_plans"."request_hash") = 64),
	CONSTRAINT "payment_plans_currency_valid" CHECK ("payment_plans"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_plans_principal_positive" CHECK ("payment_plans"."principal_minor" > 0),
	CONSTRAINT "payment_plans_paid_bounded" CHECK ("payment_plans"."paid_minor" between 0 and "payment_plans"."principal_minor"),
	CONSTRAINT "payment_plans_status_valid" CHECK ("payment_plans"."status" in ('active','completed','defaulted','cancelled')),
	CONSTRAINT "payment_plans_complete_consistent" CHECK ("payment_plans"."status" <> 'completed' or "payment_plans"."paid_minor" = "payment_plans"."principal_minor"),
	CONSTRAINT "payment_plans_cancelled_consistent" CHECK ("payment_plans"."status" <> 'cancelled' or "payment_plans"."cancelled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_provider_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_customers_provider_valid" CHECK (length(trim("payment_provider_customers"."provider")) between 1 and 100),
	CONSTRAINT "payment_provider_customers_ref_valid" CHECK (length(trim("payment_provider_customers"."provider_customer_ref")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider_object_ref" text,
	"body_sha256" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_events_hash_valid" CHECK (length("payment_provider_events"."body_sha256") = 64),
	CONSTRAINT "payment_provider_events_status_valid" CHECK ("payment_provider_events"."status" in ('processed','ignored'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_checkout_ref" text,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_currency_valid" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_request_hash_valid" CHECK (length("payments"."request_hash") = 64),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_refund_bounded" CHECK ("payments"."refunded_minor" between 0 and "payments"."amount_minor"),
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('created','processing','succeeded','failed','cancelled')),
	CONSTRAINT "payments_metadata_object" CHECK (jsonb_typeof("payments"."metadata") = 'object'),
	CONSTRAINT "payments_success_consistent" CHECK ("payments"."status" <> 'succeeded' or ("payments"."provider_ref" is not null and "payments"."processed_at" is not null)),
	CONSTRAINT "payments_failure_consistent" CHECK ("payments"."status" <> 'failed' or "payments"."failed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "provider_balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"currency" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"available_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_balance_transactions_kind_valid" CHECK ("provider_balance_transactions"."kind" in ('charge','refund','dispute','fee','adjustment','reserve','release')),
	CONSTRAINT "provider_balance_transactions_currency_valid" CHECK ("provider_balance_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_balance_transactions_net_consistent" CHECK ("provider_balance_transactions"."net_minor" = "provider_balance_transactions"."gross_minor" - "provider_balance_transactions"."fee_minor"),
	CONSTRAINT "provider_balance_transactions_nonzero" CHECK ("provider_balance_transactions"."gross_minor" <> 0 or "provider_balance_transactions"."fee_minor" <> 0),
	CONSTRAINT "provider_balance_transactions_metadata_object" CHECK (jsonb_typeof("provider_balance_transactions"."metadata") = 'object'),
	CONSTRAINT "provider_balance_transactions_request_hash_valid" CHECK (length("provider_balance_transactions"."request_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "provider_payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"balance_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"statement_ref" text,
	"failure_reason" text,
	"expected_at" timestamp with time zone,
	"provider_status_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_payouts_status_valid" CHECK ("provider_payouts"."status" in ('pending','in_transit','paid','failed','cancelled')),
	CONSTRAINT "provider_payouts_currency_valid" CHECK ("provider_payouts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_payouts_amount_positive" CHECK ("provider_payouts"."amount_minor" > 0),
	CONSTRAINT "provider_payouts_paid_consistent" CHECK ("provider_payouts"."status" <> 'paid' or "provider_payouts"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"failure_code" text,
	"failure_message" text,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_currency_valid" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_request_hash_valid" CHECK (length("refunds"."request_hash") = 64),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('created','processing','succeeded','failed','cancelled')),
	CONSTRAINT "refunds_success_consistent" CHECK ("refunds"."status" <> 'succeeded' or ("refunds"."provider_ref" is not null and "refunds"."processed_at" is not null)),
	CONSTRAINT "refunds_failure_consistent" CHECK ("refunds"."status" <> 'failed' or "refunds"."failed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "tax_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_rate_hint_ppm" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_categories_code_valid" CHECK ("tax_categories"."code" ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
	CONSTRAINT "tax_categories_hint_valid" CHECK ("tax_categories"."default_rate_hint_ppm" is null or "tax_categories"."default_rate_hint_ppm" between 0 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "tax_exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"certificate_ref" text,
	"validated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_exemptions_status_valid" CHECK ("tax_exemptions"."status" in ('pending','valid','expired','revoked')),
	CONSTRAINT "tax_exemptions_validation_evidence" CHECK ("tax_exemptions"."status" <> 'valid' or "tax_exemptions"."validated_at" is not null),
	CONSTRAINT "tax_exemptions_window_valid" CHECK ("tax_exemptions"."validated_at" is null or "tax_exemptions"."expires_at" is null or "tax_exemptions"."expires_at" > "tax_exemptions"."validated_at")
);
--> statement-breakpoint
CREATE TABLE "tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"kind" text NOT NULL,
	"rate_name" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"taxable_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"jurisdiction" text NOT NULL,
	"registration_number" text,
	"inclusive" boolean DEFAULT false NOT NULL,
	"compound" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"exemption_kind" text,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_lines_kind_valid" CHECK ("tax_lines"."kind" in ('item','shipping','exemption')),
	CONSTRAINT "tax_lines_rate_valid" CHECK ("tax_lines"."rate_ppm" between 0 and 10000000),
	CONSTRAINT "tax_lines_amounts_nonnegative" CHECK ("tax_lines"."taxable_minor" >= 0 and "tax_lines"."amount_minor" >= 0),
	CONSTRAINT "tax_lines_item_pointer" CHECK (("tax_lines"."kind" = 'item' and "tax_lines"."invoice_line_id" is not null) or ("tax_lines"."kind" = 'shipping' and "tax_lines"."invoice_line_id" is null) or "tax_lines"."kind" = 'exemption')
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"compound" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"applies_to_shipping" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_rate_valid" CHECK ("tax_rates"."rate_ppm" between 0 and 10000000),
	CONSTRAINT "tax_rates_priority_valid" CHECK ("tax_rates"."priority" between -100000 and 100000),
	CONSTRAINT "tax_rates_effective_window_valid" CHECK ("tax_rates"."effective_from" is null or "tax_rates"."effective_to" is null or "tax_rates"."effective_to" >= "tax_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"number" text,
	"scheme" text DEFAULT 'standard' NOT NULL,
	"collects_from" date,
	"threshold_minor" bigint DEFAULT 0 NOT NULL,
	"threshold_currency" text,
	"status" text DEFAULT 'monitoring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_registrations_threshold_valid" CHECK ("tax_registrations"."threshold_minor" >= 0),
	CONSTRAINT "tax_registrations_threshold_currency_valid" CHECK (("tax_registrations"."threshold_minor" = 0 and ("tax_registrations"."threshold_currency" is null or "tax_registrations"."threshold_currency" ~ '^[A-Z]{3}$')) or ("tax_registrations"."threshold_minor" > 0 and "tax_registrations"."threshold_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "tax_registrations_status_valid" CHECK ("tax_registrations"."status" in ('monitoring','active','paused','closed'))
);
--> statement-breakpoint
CREATE TABLE "tax_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_key" text,
	"template_version" integer,
	"country" text NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"postal_patterns" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"basis" text DEFAULT 'destination' NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"rounding_scope" text DEFAULT 'line' NOT NULL,
	"rounding_mode" text DEFAULT 'half_up' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_zones_country_valid" CHECK ("tax_zones"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "tax_zones_priority_valid" CHECK ("tax_zones"."priority" between -100000 and 100000),
	CONSTRAINT "tax_zones_basis_valid" CHECK ("tax_zones"."basis" in ('origin','destination')),
	CONSTRAINT "tax_zones_rounding_scope_valid" CHECK ("tax_zones"."rounding_scope" in ('line','invoice')),
	CONSTRAINT "tax_zones_rounding_mode_valid" CHECK ("tax_zones"."rounding_mode" in ('half_up','bankers')),
	CONSTRAINT "tax_zones_template_pair" CHECK (("tax_zones"."template_key" is null and "tax_zones"."template_version" is null) or ("tax_zones"."template_key" is not null and "tax_zones"."template_version" > 0))
);
--> statement-breakpoint
CREATE TABLE "earn_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"formula" text DEFAULT 'fixed' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"cap_per_period" integer,
	"cap_period_days" integer DEFAULT 30 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" text DEFAULT 'yes' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"points_balance_cached" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"tier_id" uuid,
	"tier_since" timestamp with time zone,
	"tier_expires_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"points_label" text DEFAULT 'points' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"earn_currency" text DEFAULT 'USD' NOT NULL,
	"redemption_value_cents" integer DEFAULT 1 NOT NULL,
	"expiry_policy" jsonb DEFAULT '{"kind":"never"}'::jsonb NOT NULL,
	"enrolment" text DEFAULT 'opt_in' NOT NULL,
	"terms_page_id" uuid,
	"min_account_age_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"threshold_basis" text DEFAULT 'points_earned' NOT NULL,
	"threshold" integer NOT NULL,
	"window_days" integer DEFAULT 365 NOT NULL,
	"benefits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"rule_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"reverses_id" uuid,
	"actor" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"points_spent" integer NOT NULL,
	"ledger_id" uuid,
	"issued_reference" text,
	"issued_by" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cost_points" integer NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stock" integer,
	"per_contact_limit" integer,
	"eligible_tier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"newsletter_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"working_title" text,
	"working_excerpt" text,
	"working_body" text,
	"working_seo" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_issues_slug_valid" CHECK (char_length("newsletter_issues"."slug") between 1 and 180 and "newsletter_issues"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "newsletter_issues_title_valid" CHECK (char_length("newsletter_issues"."title") between 1 and 240),
	CONSTRAINT "newsletter_issues_status_valid" CHECK ("newsletter_issues"."status" in ('draft','published')),
	CONSTRAINT "newsletter_issues_version_positive" CHECK ("newsletter_issues"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"newsletter_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirm_token" text NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"consent_terms_version" text,
	"consent_source_url" text,
	"consent_ip" text,
	"consent_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscriptions_status_valid" CHECK ("newsletter_subscriptions"."status" in ('pending','confirmed','unsubscribed')),
	CONSTRAINT "newsletter_subscriptions_consent_terms_bounded" CHECK ("newsletter_subscriptions"."consent_terms_version" is null or char_length("newsletter_subscriptions"."consent_terms_version") <= 100),
	CONSTRAINT "newsletter_subscriptions_consent_source_bounded" CHECK ("newsletter_subscriptions"."consent_source_url" is null or char_length("newsletter_subscriptions"."consent_source_url") <= 2048),
	CONSTRAINT "newsletter_subscriptions_consent_ip_bounded" CHECK ("newsletter_subscriptions"."consent_ip" is null or char_length("newsletter_subscriptions"."consent_ip") <= 64)
);
--> statement-breakpoint
CREATE TABLE "newsletters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletters_slug_valid" CHECK (char_length("newsletters"."slug") between 1 and 180 and "newsletters"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "newsletters_name_valid" CHECK (char_length("newsletters"."name") between 1 and 200),
	CONSTRAINT "newsletters_status_valid" CHECK ("newsletters"."status" in ('active','paused'))
);
--> statement-breakpoint
CREATE TABLE "popup_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"popup_id" uuid NOT NULL,
	"visitor_key" text,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"path" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popup_events_kind_allowed" CHECK ("popup_events"."kind" in ('shown', 'dismissed', 'captured')),
	CONSTRAINT "popup_events_visitor_bounded" CHECK ("popup_events"."visitor_key" is null or char_length("popup_events"."visitor_key") <= 64),
	CONSTRAINT "popup_events_path_bounded" CHECK ("popup_events"."path" is null or char_length("popup_events"."path") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"surface" text DEFAULT 'modal' NOT NULL,
	"trigger" text DEFAULT 'delay' NOT NULL,
	"trigger_value" integer DEFAULT 5 NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"segment_id" uuid,
	"path_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locales" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency_cap" integer,
	"frequency_period_hours" integer DEFAULT 168 NOT NULL,
	"dismiss_suppress_hours" integer DEFAULT 720 NOT NULL,
	"stop_after_capture" boolean DEFAULT true NOT NULL,
	"capture_mode" text DEFAULT 'none' NOT NULL,
	"newsletter_id" uuid,
	"consent_statement" text,
	"consent_version" text,
	"success_message" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popups_slug_shape" CHECK ("popups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "popups_slug_bounded" CHECK (char_length("popups"."slug") <= 180),
	CONSTRAINT "popups_name_bounded" CHECK (char_length("popups"."name") between 1 and 120),
	CONSTRAINT "popups_title" CHECK (char_length("popups"."title") between 1 and 160),
	CONSTRAINT "popups_surface_allowed" CHECK ("popups"."surface" in ('modal', 'banner', 'corner')),
	CONSTRAINT "popups_trigger_allowed" CHECK ("popups"."trigger" in ('immediate', 'delay', 'scroll', 'exitIntent')),
	CONSTRAINT "popups_trigger_value" CHECK ("popups"."trigger_value" between 0 and 600 and ("popups"."trigger" <> 'scroll' or "popups"."trigger_value" between 1 and 100)),
	CONSTRAINT "popups_audience_allowed" CHECK ("popups"."audience" in ('everyone', 'inSegment', 'notInSegment')),
	CONSTRAINT "popups_paths_array" CHECK (jsonb_typeof("popups"."path_patterns") = 'array'),
	CONSTRAINT "popups_locales_array" CHECK (jsonb_typeof("popups"."locales") = 'array'),
	CONSTRAINT "popups_audience_segment" CHECK ("popups"."audience" = 'everyone' or "popups"."segment_id" is not null),
	CONSTRAINT "popups_capture_consent" CHECK ("popups"."capture_mode" <> 'email' or ("popups"."consent_statement" is not null and "popups"."newsletter_id" is not null)),
	CONSTRAINT "popups_capture_allowed" CHECK ("popups"."capture_mode" in ('none', 'email')),
	CONSTRAINT "popups_consent_bounded" CHECK ("popups"."consent_statement" is null or char_length("popups"."consent_statement") <= 500),
	CONSTRAINT "popups_consent_version_bounded" CHECK ("popups"."consent_version" is null or char_length("popups"."consent_version") <= 60),
	CONSTRAINT "popups_success_message_bounded" CHECK ("popups"."success_message" is null or char_length("popups"."success_message") <= 400),
	CONSTRAINT "popups_frequency_cap_positive" CHECK ("popups"."frequency_cap" is null or "popups"."frequency_cap" > 0),
	CONSTRAINT "popups_frequency_cap_bounded" CHECK ("popups"."frequency_cap" is null or "popups"."frequency_cap" <= 100),
	CONSTRAINT "popups_frequency_period" CHECK ("popups"."frequency_period_hours" between 1 and 8760),
	CONSTRAINT "popups_dismiss_suppress" CHECK ("popups"."dismiss_suppress_hours" between 0 and 8760),
	CONSTRAINT "popups_priority_bounded" CHECK ("popups"."priority" between 0 and 1000),
	CONSTRAINT "popups_status_allowed" CHECK ("popups"."status" in ('draft', 'active', 'paused')),
	CONSTRAINT "popups_window" CHECK ("popups"."ends_at" is null or "popups"."starts_at" is null or "popups"."ends_at" > "popups"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "project_collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"cover_asset_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"publication_status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"public_page_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_collections_name" CHECK (char_length("project_collections"."name") between 1 and 160),
	CONSTRAINT "project_collections_slug" CHECK ("project_collections"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "project_collections_kind" CHECK ("project_collections"."kind" in ('portfolio','service','industry','season')),
	CONSTRAINT "project_collections_status" CHECK ("project_collections"."publication_status" in ('draft','published')),
	CONSTRAINT "project_collections_publication_time" CHECK (("project_collections"."publication_status" = 'published' and "project_collections"."published_at" is not null) or "project_collections"."publication_status" = 'draft')
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'gallery' NOT NULL,
	"pair_key" text,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_files_pairing" CHECK (("project_files"."role" in ('before','after')) = ("project_files"."pair_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"method" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_outcomes_label" CHECK (char_length("project_outcomes"."label") between 1 and 120),
	CONSTRAINT "project_outcomes_value" CHECK (char_length("project_outcomes"."value") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "project_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" text,
	"body" text NOT NULL,
	"rating" integer,
	"asset_id" uuid,
	"consent_given_at" timestamp with time zone NOT NULL,
	"consent_method" text NOT NULL,
	"consent_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"display_locations" text[] DEFAULT ARRAY['project']::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_testimonials_name" CHECK (char_length("project_testimonials"."display_name") between 1 and 200),
	CONSTRAINT "project_testimonials_body" CHECK (char_length("project_testimonials"."body") between 1 and 5000),
	CONSTRAINT "project_testimonials_rating" CHECK ("project_testimonials"."rating" is null or "project_testimonials"."rating" between 1 and 5),
	CONSTRAINT "project_testimonials_locations" CHECK ("project_testimonials"."display_locations" <@ ARRAY['project','service','portfolio']::text[]),
	CONSTRAINT "project_testimonials_status" CHECK ("project_testimonials"."status" in ('draft','published','withdrawn')),
	CONSTRAINT "project_testimonials_consent_method" CHECK ("project_testimonials"."consent_method" in ('contract','email','written','verbal','other'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_display_name" text,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'enquiry' NOT NULL,
	"owner_user_id" uuid,
	"location_id" uuid,
	"service_product_ids" uuid[] DEFAULT '{}' NOT NULL,
	"started_on" date,
	"occurred_on" date,
	"completed_at" timestamp with time zone,
	"notes" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_asset_id" uuid,
	"featured" boolean DEFAULT false NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"publication_status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"public_page_id" uuid,
	"client_consent_given_at" timestamp with time zone,
	"client_consent_method" text,
	"client_consent_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_title" CHECK (char_length("projects"."title") between 1 and 200),
	CONSTRAINT "projects_slug" CHECK ("projects"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "projects_complete_has_time" CHECK ("projects"."status" <> 'complete' or "projects"."completed_at" is not null),
	CONSTRAINT "projects_publication_time" CHECK (("projects"."publication_status" = 'published' and "projects"."published_at" is not null) or "projects"."publication_status" = 'draft'),
	CONSTRAINT "projects_publication_status" CHECK ("projects"."publication_status" in ('draft','published')),
	CONSTRAINT "projects_consent_complete" CHECK (("projects"."client_consent_given_at" is null and "projects"."client_consent_method" is null) or ("projects"."client_consent_given_at" is not null and "projects"."client_consent_method" is not null)),
	CONSTRAINT "projects_consent_method" CHECK ("projects"."client_consent_method" is null or "projects"."client_consent_method" in ('contract','email','written','verbal','other')),
	CONSTRAINT "projects_version_positive" CHECK ("projects"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "proof_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_micros" bigint DEFAULT 1000000 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_items_version" CHECK ("quote_items"."version" > 0),
	CONSTRAINT "quote_items_quantity" CHECK ("quote_items"."quantity_micros" > 0),
	CONSTRAINT "quote_items_price" CHECK ("quote_items"."unit_price_minor" >= 0),
	CONSTRAINT "quote_items_description" CHECK (char_length("quote_items"."description") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "quote_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"author" text NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"proposed_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_messages_body" CHECK (char_length("quote_messages"."body") between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "quote_partner_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"invited_by_contact_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"currency" text NOT NULL,
	"valid_until" timestamp with time zone,
	"deposit_minor" bigint,
	"terms" text,
	"notes" text,
	"view_token" text,
	"sent_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"accepted_snapshot" jsonb,
	"conversion_plan" jsonb,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_version" CHECK ("quotes"."version" > 0),
	CONSTRAINT "quotes_deposit" CHECK ("quotes"."deposit_minor" is null or "quotes"."deposit_minor" >= 0),
	CONSTRAINT "quotes_title" CHECK (char_length("quotes"."title") between 1 and 200),
	CONSTRAINT "quotes_accepted_complete" CHECK ("quotes"."status" <> 'accepted'
        or ("quotes"."accepted_at" is not null and "quotes"."accepted_snapshot" is not null))
);
--> statement-breakpoint
CREATE TABLE "affiliate_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"code" text NOT NULL,
	"landing_path" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"conversion_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_discount" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commission" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cookie_window_days" integer DEFAULT 30 NOT NULL,
	"holdback_days" integer DEFAULT 30 NOT NULL,
	"attribution_model" text DEFAULT 'last_touch' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"form_kind" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'not_required' NOT NULL,
	"threshold_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"requested_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_id" text,
	"contact_id" uuid,
	"code_id" uuid NOT NULL,
	"kind" text DEFAULT 'click' NOT NULL,
	"landing_path" text,
	"referrer_url" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"affiliate_contact_id" uuid NOT NULL,
	"referred_contact_id" uuid NOT NULL,
	"conversion_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"invoice_id" uuid,
	"share_ppm" integer DEFAULT 1000000 NOT NULL,
	"basis_minor" integer DEFAULT 0 NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payable_at" timestamp with time zone NOT NULL,
	"reverses_id" uuid,
	"payout_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"affiliate_contact_id" uuid NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"tax_form_state" text DEFAULT 'not_required' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_contact_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"channel" text DEFAULT 'link' NOT NULL,
	"invitee_email" text,
	"invitee_phone" text,
	"token_hash" text NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"reward_state" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"booking_id" uuid,
	"calendar_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"unit" text NOT NULL,
	"units" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"quoted_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"invoice_id" uuid,
	"picked_up_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"condition_out" text,
	"condition_in" text,
	"return_condition" text,
	"late_fee_minor" bigint DEFAULT 0 NOT NULL,
	"damage_fee_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_refund_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_order" CHECK ("rental_agreements"."ends_at" > "rental_agreements"."starts_at"),
	CONSTRAINT "rental_agreements_units" CHECK ("rental_agreements"."units" > 0),
	CONSTRAINT "rental_agreements_money" CHECK ("rental_agreements"."quoted_minor" >= 0 and "rental_agreements"."deposit_minor" >= 0
        and "rental_agreements"."late_fee_minor" >= 0 and "rental_agreements"."damage_fee_minor" >= 0
        and "rental_agreements"."deposit_refund_minor" >= 0),
	CONSTRAINT "rental_agreements_out_complete" CHECK ("rental_agreements"."status" not in ('out','overdue','returned','closed')
        or "rental_agreements"."picked_up_at" is not null),
	CONSTRAINT "rental_agreements_return_complete" CHECK ("rental_agreements"."status" not in ('returned','closed')
        or ("rental_agreements"."returned_at" is not null and "rental_agreements"."return_condition" is not null))
);
--> statement-breakpoint
CREATE TABLE "rental_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"unit" text DEFAULT 'day' NOT NULL,
	"min_units" integer DEFAULT 1 NOT NULL,
	"max_units" integer,
	"buffer_before_hours" integer DEFAULT 0 NOT NULL,
	"buffer_after_hours" integer DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"damage_policy" text DEFAULT 'deposit_only' NOT NULL,
	"replacement_value_minor" bigint DEFAULT 0 NOT NULL,
	"late_fee_per_unit_minor" bigint DEFAULT 0 NOT NULL,
	"conditions_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_terms_min_units" CHECK ("rental_terms"."min_units" > 0),
	CONSTRAINT "rental_terms_max_units" CHECK ("rental_terms"."max_units" is null or "rental_terms"."max_units" >= "rental_terms"."min_units"),
	CONSTRAINT "rental_terms_buffers" CHECK ("rental_terms"."buffer_before_hours" >= 0 and "rental_terms"."buffer_after_hours" >= 0),
	CONSTRAINT "rental_terms_money" CHECK ("rental_terms"."deposit_minor" >= 0
      and "rental_terms"."replacement_value_minor" >= 0
      and "rental_terms"."late_fee_per_unit_minor" >= 0),
	CONSTRAINT "rental_terms_replacement_known" CHECK ("rental_terms"."damage_policy" <> 'replacement' or "rental_terms"."replacement_value_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text NOT NULL,
	"subject_type" text DEFAULT 'business' NOT NULL,
	"subject_id" uuid,
	"token_hash" text NOT NULL,
	"incentive_coupon_id" uuid,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"review_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"display_name" text,
	"source" text NOT NULL,
	"subject_type" text DEFAULT 'business' NOT NULL,
	"subject_id" uuid,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"display_locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_body" text,
	"reply_at" timestamp with time zone,
	"reply_by_user_id" uuid,
	"incentive_coupon_id" uuid,
	"incentive_disclosed" boolean DEFAULT false NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body" CHECK (char_length("reviews"."body") between 0 and 5000),
	CONSTRAINT "reviews_reply" CHECK (("reviews"."reply_body" is null and "reviews"."reply_at" is null) or ("reviews"."reply_body" is not null and "reviews"."reply_at" is not null)),
	CONSTRAINT "reviews_moderated" CHECK (("reviews"."status" = 'pending' and "reviews"."moderated_at" is null) or ("reviews"."status" <> 'pending' and "reviews"."moderated_at" is not null)),
	CONSTRAINT "reviews_incentive" CHECK ("reviews"."incentive_coupon_id" is null or "reviews"."incentive_disclosed" = true)
);
--> statement-breakpoint
CREATE TABLE "share_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text DEFAULT 'page' NOT NULL,
	"path" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"shareable" boolean DEFAULT true NOT NULL,
	"channels" text[],
	"social_title" text,
	"social_description" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"channel" text NOT NULL,
	"sharer_contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_gbp_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"profile_id" uuid,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_handle" text NOT NULL,
	"author_email" text,
	"contact_id" uuid,
	"conversation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"return_to" text DEFAULT '/admin/social' NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_package_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" text NOT NULL,
	"source_profile_id" uuid,
	"source_provider" text,
	"source_ref" text,
	"content_digest" text NOT NULL,
	"parent_package_id" uuid,
	"author_user_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"canonical_url" text,
	"rights" text DEFAULT 'owned' NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profile_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"credentials" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"assigned_to" text DEFAULT 'business' NOT NULL,
	"assignee_user_id" uuid,
	"allow_read" boolean DEFAULT true NOT NULL,
	"allow_respond" boolean DEFAULT false NOT NULL,
	"allow_publish" boolean DEFAULT false NOT NULL,
	"approval_policy" text DEFAULT 'required' NOT NULL,
	"capabilities" jsonb DEFAULT '{"read":true,"respond":false,"publish":false,"extras":[]}'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_health_at" timestamp with time zone,
	"last_health_status" text,
	"last_error" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"variant_id" uuid,
	"profile_id" uuid,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text,
	"canonical_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"asset_ids" text[] DEFAULT '{}' NOT NULL,
	"aspect_ratio" text NOT NULL,
	"safe_area" jsonb NOT NULL,
	"duration_seconds" integer,
	"generated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dunning_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"retries" jsonb DEFAULT '[3,7,14]'::jsonb NOT NULL,
	"grace_days" integer DEFAULT 14 NOT NULL,
	"notify_channels" jsonb DEFAULT '["email"]'::jsonb NOT NULL,
	"final_action" text DEFAULT 'pause' NOT NULL,
	"downgrade_to_plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_policies_grace_nonnegative" CHECK ("dunning_policies"."grace_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"trial_requires_card" boolean DEFAULT false NOT NULL,
	"setup_fee_minor" bigint DEFAULT 0 NOT NULL,
	"billing_mode" text DEFAULT 'manual' NOT NULL,
	"cancel_behaviour" text DEFAULT 'period_end' NOT NULL,
	"proration" text DEFAULT 'create_prorations' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_interval_count_positive" CHECK ("plans"."interval_count" >= 1),
	CONSTRAINT "plans_trial_days_nonnegative" CHECK ("plans"."trial_days" >= 0),
	CONSTRAINT "plans_setup_fee_nonnegative" CHECK ("plans"."setup_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid,
	"invoice_id" uuid,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"billing_mode" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"payment_method_id" uuid,
	"pending_plan_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"grants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dunning_started_at" timestamp with time zone,
	"dunning_attempt" integer DEFAULT 0 NOT NULL,
	"dunning_next_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"dunning_invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_currency_valid" CHECK ("subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscriptions_period_order" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_ended_consistent" CHECK (("subscriptions"."status" in ('expired', 'cancelled')) or "subscriptions"."ended_at" is null)
);
--> statement-breakpoint
CREATE TABLE "invoice_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reminders_offset" CHECK ("invoice_reminders"."offset_days" between -60 and 180)
);
--> statement-breakpoint
CREATE TABLE "invoice_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"lines" jsonb NOT NULL,
	"memo" text,
	"due_in_days" integer DEFAULT 14 NOT NULL,
	"auto_issue" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"ends_on" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_invoice_id" uuid,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_schedules_interval" CHECK ("invoice_schedules"."interval_count" between 1 and 24),
	CONSTRAINT "invoice_schedules_due_days" CHECK ("invoice_schedules"."due_in_days" between 0 and 365),
	CONSTRAINT "invoice_schedules_name" CHECK (char_length("invoice_schedules"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"detail" text,
	"sent_at" timestamp with time zone,
	"delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"subject" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"subject" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_blocks" jsonb,
	"default_subject" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"project_id" uuid,
	"booking_id" uuid,
	"description" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"rate_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"invoice_id" uuid,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_minutes" CHECK ("time_entries"."minutes" >= 0),
	CONSTRAINT "time_entries_rate" CHECK ("time_entries"."rate_minor" >= 0),
	CONSTRAINT "time_entries_order" CHECK ("time_entries"."ended_at" is null or "time_entries"."ended_at" >= "time_entries"."started_at"),
	CONSTRAINT "time_entries_description" CHECK (char_length("time_entries"."description") between 1 and 500),
	CONSTRAINT "time_entries_invoiced_is_finished" CHECK ("time_entries"."invoice_id" is null or "time_entries"."ended_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "time_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"rate_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_rates_amount" CHECK ("time_rates"."rate_minor" >= 0),
	CONSTRAINT "time_rates_scope_id" CHECK (("time_rates"."scope" = 'business') = ("time_rates"."scope_id" is null))
);
--> statement-breakpoint
CREATE TABLE "export_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"shape" text NOT NULL,
	"basis" text DEFAULT 'paid' NOT NULL,
	"currency" text NOT NULL,
	"period" text DEFAULT 'previous_month' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"scheduled" boolean DEFAULT false NOT NULL,
	"recipients" text[] DEFAULT '{}' NOT NULL,
	"date_format" text DEFAULT 'iso' NOT NULL,
	"item_code" text,
	"account_code" text,
	"tax_code" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_definitions_currency_valid" CHECK ("export_definitions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "export_definitions_name_present" CHECK (length(btrim("export_definitions"."name")) > 0),
	CONSTRAINT "export_definitions_name_single_line" CHECK (position(chr(10) in "export_definitions"."name") = 0 and position(chr(13) in "export_definitions"."name") = 0),
	CONSTRAINT "export_definitions_scheduled_has_recipient" CHECK ("export_definitions"."scheduled" = false or cardinality("export_definitions"."recipients") >= 1)
);
--> statement-breakpoint
CREATE TABLE "export_run_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"recipient" text NOT NULL,
	"state" text NOT NULL,
	"mail_delivery_id" uuid,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"detail" text,
	"downloaded_at" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_run_deliveries_attempt_positive" CHECK ("export_run_deliveries"."attempt" > 0),
	CONSTRAINT "export_run_deliveries_recipient_lower" CHECK ("export_run_deliveries"."recipient" = lower("export_run_deliveries"."recipient")),
	CONSTRAINT "export_run_deliveries_recipient_bounded" CHECK (length("export_run_deliveries"."recipient") <= 320),
	CONSTRAINT "export_run_deliveries_state_valid" CHECK ("export_run_deliveries"."state" in ('queued', 'failed')),
	CONSTRAINT "export_run_deliveries_token_format" CHECK ("export_run_deliveries"."token_hash" is null or "export_run_deliveries"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "export_run_deliveries_downloads_nonnegative" CHECK ("export_run_deliveries"."download_count" >= 0),
	CONSTRAINT "export_run_deliveries_staging_consistent" CHECK (("export_run_deliveries"."state" = 'queued' and "export_run_deliveries"."mail_delivery_id" is not null and "export_run_deliveries"."token_hash" is not null and "export_run_deliveries"."expires_at" is not null and "export_run_deliveries"."detail" is null) or ("export_run_deliveries"."state" = 'failed' and "export_run_deliveries"."mail_delivery_id" is null and "export_run_deliveries"."token_hash" is null and "export_run_deliveries"."expires_at" is null and "export_run_deliveries"."detail" is not null)),
	CONSTRAINT "export_run_deliveries_expiry_ordered" CHECK ("export_run_deliveries"."expires_at" is null or "export_run_deliveries"."expires_at" > "export_run_deliveries"."created_at"),
	CONSTRAINT "export_run_deliveries_revocation_ordered" CHECK ("export_run_deliveries"."revoked_at" is null or "export_run_deliveries"."revoked_at" >= "export_run_deliveries"."created_at")
);
--> statement-breakpoint
CREATE TABLE "export_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"definition_name" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"shape" text NOT NULL,
	"basis" text NOT NULL,
	"currency" text NOT NULL,
	"timezone" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"excluded_currencies" text[] DEFAULT '{}' NOT NULL,
	"excluded_invoice_count" integer DEFAULT 0 NOT NULL,
	"filename" text,
	"content" text,
	"bytes" integer,
	"sha256" text,
	"recipients" text[] DEFAULT '{}' NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_runs_currency_valid" CHECK ("export_runs"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "export_runs_definition_name_present" CHECK (length(btrim("export_runs"."definition_name")) > 0),
	CONSTRAINT "export_runs_timezone_present" CHECK (length(btrim("export_runs"."timezone")) > 0),
	CONSTRAINT "export_runs_period_ordered" CHECK ("export_runs"."period_from" < "export_runs"."period_to"),
	CONSTRAINT "export_runs_counts_nonnegative" CHECK ("export_runs"."row_count" >= 0 and "export_runs"."invoice_count" >= 0 and "export_runs"."delivered_count" >= 0 and "export_runs"."attempts" >= 0 and "export_runs"."excluded_invoice_count" >= 0),
	CONSTRAINT "export_runs_delivered_consistent" CHECK ("export_runs"."status" <> 'delivered' or ("export_runs"."delivered_at" is not null and "export_runs"."failed_at" is null and "export_runs"."error" is null and "export_runs"."attempts" > 0 and "export_runs"."delivered_count" = cardinality("export_runs"."recipients"))),
	CONSTRAINT "export_runs_delivered_count_bounded" CHECK ("export_runs"."delivered_count" <= cardinality("export_runs"."recipients")),
	CONSTRAINT "export_runs_failed_consistent" CHECK ("export_runs"."status" <> 'failed' or ("export_runs"."failed_at" is not null and "export_runs"."delivered_at" is null and "export_runs"."error" is not null)),
	CONSTRAINT "export_runs_unsettled_consistent" CHECK ("export_runs"."status" not in ('pending', 'built') or ("export_runs"."delivered_at" is null and "export_runs"."failed_at" is null and "export_runs"."error" is null and "export_runs"."delivered_count" = 0))
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"access" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_registry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"invoice_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_ref" text,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pod_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_video_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"external_ref" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"conversation_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_playbook_versions" ADD CONSTRAINT "agent_playbook_versions_playbook_id_agent_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."agent_playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_playbook_versions" ADD CONSTRAINT "agent_playbook_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD CONSTRAINT "agent_playbooks_default_agent_id_agents_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_connection_id_agent_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_security_events" ADD CONSTRAINT "login_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_factors" ADD CONSTRAINT "totp_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_contributions" ADD CONSTRAINT "briefing_contributions_briefing_id_briefings_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_preferences" ADD CONSTRAINT "briefing_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_entries" ADD CONSTRAINT "catalogue_entries_source_id_catalogue_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."catalogue_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_installs" ADD CONSTRAINT "catalogue_installs_entry_id_catalogue_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."catalogue_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_installs" ADD CONSTRAINT "catalogue_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_sources" ADD CONSTRAINT "catalogue_sources_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connection_grants" ADD CONSTRAINT "agent_connection_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_capabilities" ADD CONSTRAINT "connection_capabilities_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_calendars" ADD CONSTRAINT "external_calendars_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_external_calendar_id_external_calendars_id_fk" FOREIGN KEY ("external_calendar_id") REFERENCES "public"."external_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_operations" ADD CONSTRAINT "contact_merge_operations_candidate_id_merge_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."merge_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_from_contact_id_contacts_id_fk" FOREIGN KEY ("from_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_to_contact_id_contacts_id_fk" FOREIGN KEY ("to_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_magic_links" ADD CONSTRAINT "customer_magic_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_contact_a_id_contacts_id_fk" FOREIGN KEY ("contact_a_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_contact_b_id_contacts_id_fk" FOREIGN KEY ("contact_b_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_assets" ADD CONSTRAINT "contribution_assets_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_assets" ADD CONSTRAINT "contribution_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_run_id_demo_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."demo_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_scenario_runs" ADD CONSTRAINT "demo_scenario_runs_definition_fk" FOREIGN KEY ("scenario_key","scenario_version") REFERENCES "public"."demo_scenarios"("key","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_settings" ADD CONSTRAINT "design_settings_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_unlocks" ADD CONSTRAINT "content_unlocks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_unlocks" ADD CONSTRAINT "content_unlocks_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_balances" ADD CONSTRAINT "pass_balances_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_balances" ADD CONSTRAINT "pass_balances_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event_deliveries" ADD CONSTRAINT "outbox_event_deliveries_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_progress" ADD CONSTRAINT "guidance_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_sender_id_mail_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."mail_senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_oauth_states" ADD CONSTRAINT "mail_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_provider_events" ADD CONSTRAINT "mail_provider_events_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_senders" ADD CONSTRAINT "mail_senders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_suppressions" ADD CONSTRAINT "mail_suppressions_source_event_id_mail_provider_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."mail_provider_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_suppressions" ADD CONSTRAINT "mail_suppressions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_alt_text_suggestions" ADD CONSTRAINT "media_alt_text_suggestions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_chunks" ADD CONSTRAINT "media_capture_chunks_session_id_media_capture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."media_capture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_session_id_media_capture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."media_capture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rule_events" ADD CONSTRAINT "keyword_rule_events_rule_id_keyword_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."keyword_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rule_events" ADD CONSTRAINT "keyword_rule_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rule_events" ADD CONSTRAINT "keyword_rule_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rules" ADD CONSTRAINT "keyword_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_session_id_site_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."site_chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_chat_sessions" ADD CONSTRAINT "site_chat_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_chat_sessions" ADD CONSTRAINT "site_chat_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_compliance_events" ADD CONSTRAINT "sms_compliance_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_digest_id_notification_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."notification_digests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_recipient_contact_id_contacts_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_contact_id_contacts_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paywall_meter_counters" ADD CONSTRAINT "paywall_meter_counters_paywall_id_paywalls_id_fk" FOREIGN KEY ("paywall_id") REFERENCES "public"."paywalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paywall_meter_counters" ADD CONSTRAINT "paywall_meter_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request_artifacts" ADD CONSTRAINT "data_request_artifacts_data_request_id_data_requests_id_fk" FOREIGN KEY ("data_request_id") REFERENCES "public"."data_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_retention_exceptions" ADD CONSTRAINT "privacy_retention_exceptions_data_request_id_data_requests_id_fk" FOREIGN KEY ("data_request_id") REFERENCES "public"."data_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approvals" ADD CONSTRAINT "run_approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approvals" ADD CONSTRAINT "run_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_spend" ADD CONSTRAINT "run_spend_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_memberships" ADD CONSTRAINT "calendar_memberships_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_external_calendar_id_external_calendars_id_fk" FOREIGN KEY ("external_calendar_id") REFERENCES "public"."external_calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_busy_blocks" ADD CONSTRAINT "external_busy_blocks_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_busy_blocks" ADD CONSTRAINT "external_busy_blocks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_score_awards" ADD CONSTRAINT "contact_score_awards_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_score_awards" ADD CONSTRAINT "contact_score_awards_rule_id_scoring_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."scoring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_runs" ADD CONSTRAINT "update_runs_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."update_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_import_id_contact_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."contact_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_relationship_id_contact_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."contact_relationships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_subject_contact_id_contacts_id_fk" FOREIGN KEY ("subject_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_choices" ADD CONSTRAINT "signup_contact_import_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_choices" ADD CONSTRAINT "signup_contact_import_choices_import_id_contact_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."contact_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_contact_import_policies" ADD CONSTRAINT "signup_contact_import_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_windows" ADD CONSTRAINT "messaging_windows_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_windows" ADD CONSTRAINT "messaging_windows_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_audience_calendars" ADD CONSTRAINT "booking_audience_calendars_audience_id_booking_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."booking_audiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_audience_calendars" ADD CONSTRAINT "booking_audience_calendars_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_audience_hours" ADD CONSTRAINT "booking_audience_hours_audience_id_booking_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."booking_audiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_audience_services" ADD CONSTRAINT "booking_audience_services_audience_id_booking_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."booking_audiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_contact_id_contacts_id_fk" FOREIGN KEY ("advertiser_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_line_item_id_ad_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."ad_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_line_items" ADD CONSTRAINT "ad_line_items_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_line_item_id_ad_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."ad_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_chat_session_id_site_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."site_chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_knowledge_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_contact_state" ADD CONSTRAINT "automation_contact_state_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_contact_state" ADD CONSTRAINT "automation_contact_state_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_entry_segment_id_segments_id_fk" FOREIGN KEY ("entry_segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_entry_segment_id_segments_id_fk" FOREIGN KEY ("entry_segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_bundle_product_id_products_id_fk" FOREIGN KEY ("bundle_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_component_variant_id_product_variants_id_fk" FOREIGN KEY ("component_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_coupons" ADD CONSTRAINT "cart_coupons_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_coupons" ADD CONSTRAINT "cart_coupons_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recoveries" ADD CONSTRAINT "cart_recoveries_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recoveries" ADD CONSTRAINT "cart_recoveries_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_windows" ADD CONSTRAINT "delivery_windows_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_deliveries" ADD CONSTRAINT "digital_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_deliveries" ADD CONSTRAINT "digital_deliveries_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_box_id_packaging_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."packaging_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_rules" ADD CONSTRAINT "offer_rules_trigger_variant_id_product_variants_id_fk" FOREIGN KEY ("trigger_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_rules" ADD CONSTRAINT "offer_rules_offer_variant_id_product_variants_id_fk" FOREIGN KEY ("offer_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_breaks" ADD CONSTRAINT "price_breaks_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_breaks" ADD CONSTRAINT "price_breaks_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_group_id_customer_groups_id_fk" FOREIGN KEY ("customer_group_id") REFERENCES "public"."customer_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lifecycle_events" ADD CONSTRAINT "product_lifecycle_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_assignments" ADD CONSTRAINT "product_option_assignments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_assignments" ADD CONSTRAINT "product_option_assignments_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_assignments" ADD CONSTRAINT "product_option_value_assignments_assignment_id_product_option_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."product_option_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_assignments" ADD CONSTRAINT "product_option_value_assignments_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_option_type_id_option_types_id_fk" FOREIGN KEY ("option_type_id") REFERENCES "public"."option_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_category_id_tax_categories_id_fk" FOREIGN KEY ("tax_category_id") REFERENCES "public"."tax_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_return_requests_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_intake_form_id_forms_id_fk" FOREIGN KEY ("intake_form_id") REFERENCES "public"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rate_bands" ADD CONSTRAINT "shipping_rate_bands_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_help_category_id_help_categories_id_fk" FOREIGN KEY ("help_category_id") REFERENCES "public"."help_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_countersigner_user_id_users_id_fk" FOREIGN KEY ("countersigner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stages" ADD CONSTRAINT "contact_stages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stages" ADD CONSTRAINT "contact_stages_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_share_id_document_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."document_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_pinned_version_id_document_versions_id_fk" FOREIGN KEY ("pinned_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_session_id_event_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_ticket_id_event_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."event_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_location_id_business_locations_id_fk" FOREIGN KEY ("venue_location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_archives" ADD CONSTRAINT "gallery_archives_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_invited_by_contact_id_contacts_id_fk" FOREIGN KEY ("invited_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_price_sheet_items" ADD CONSTRAINT "gallery_price_sheet_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_rounds" ADD CONSTRAINT "gallery_rounds_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_rounds" ADD CONSTRAINT "gallery_rounds_submitted_by_contact_id_contacts_id_fk" FOREIGN KEY ("submitted_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_guest_id_gallery_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."gallery_guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_accounts" ADD CONSTRAINT "customer_balance_accounts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_entries" ADD CONSTRAINT "customer_balance_entries_account_id_customer_balance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_balance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexible_payments" ADD CONSTRAINT "flexible_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexible_payments" ADD CONSTRAINT "flexible_payments_attached_invoice_id_invoices_id_fk" FOREIGN KEY ("attached_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_zone_id_tax_zones_id_fk" FOREIGN KEY ("tax_zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deposit_of_fk" FOREIGN KEY ("deposit_of_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_assessments" ADD CONSTRAINT "late_fee_assessments_source_invoice_id_invoices_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_assessments" ADD CONSTRAINT "late_fee_assessments_fee_invoice_id_invoices_id_fk" FOREIGN KEY ("fee_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_payment_plan_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_plan_installments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_plan_id_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_customers" ADD CONSTRAINT "payment_provider_customers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payout_items" ADD CONSTRAINT "provider_payout_items_payout_id_provider_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."provider_payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payout_items" ADD CONSTRAINT "provider_payout_items_balance_transaction_id_provider_balance_transactions_id_fk" FOREIGN KEY ("balance_transaction_id") REFERENCES "public"."provider_balance_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_category_id_tax_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tax_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_zone_id_tax_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."tax_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earn_rules" ADD CONSTRAINT "earn_rules_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ADD CONSTRAINT "loyalty_tiers_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_rule_id_earn_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."earn_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_popup_id_popups_id_fk" FOREIGN KEY ("popup_id") REFERENCES "public"."popups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popup_events" ADD CONSTRAINT "popup_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popups" ADD CONSTRAINT "popups_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_items" ADD CONSTRAINT "project_collection_items_collection_id_project_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."project_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_items" ADD CONSTRAINT "project_collection_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collections" ADD CONSTRAINT "project_collections_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_outcomes" ADD CONSTRAINT "project_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_testimonials" ADD CONSTRAINT "project_testimonials_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_partner_links" ADD CONSTRAINT "quote_partner_links_invited_by_contact_id_contacts_id_fk" FOREIGN KEY ("invited_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_codes" ADD CONSTRAINT "affiliate_codes_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_codes" ADD CONSTRAINT "affiliate_codes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_tax_profiles" ADD CONSTRAINT "affiliate_tax_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_affiliate_contact_id_contacts_id_fk" FOREIGN KEY ("affiliate_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_referred_contact_id_contacts_id_fk" FOREIGN KEY ("referred_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_affiliate_contact_id_contacts_id_fk" FOREIGN KEY ("affiliate_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_referrer_contact_id_contacts_id_fk" FOREIGN KEY ("referrer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_terms" ADD CONSTRAINT "rental_terms_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_terms" ADD CONSTRAINT "rental_terms_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_views" ADD CONSTRAINT "report_views_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reply_by_user_id_users_id_fk" FOREIGN KEY ("reply_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_target_id_share_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."share_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_sharer_contact_id_contacts_id_fk" FOREIGN KEY ("sharer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_gbp_reviews" ADD CONSTRAINT "social_gbp_reviews_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_gbp_reviews" ADD CONSTRAINT "social_gbp_reviews_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_interactions" ADD CONSTRAINT "social_interactions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_oauth_states" ADD CONSTRAINT "social_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_package_assets" ADD CONSTRAINT "social_package_assets_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_package_assets" ADD CONSTRAINT "social_package_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_source_profile_id_social_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_parent_package_id_social_packages_id_fk" FOREIGN KEY ("parent_package_id") REFERENCES "public"."social_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packages" ADD CONSTRAINT "social_packages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profile_locations" ADD CONSTRAINT "social_profile_locations_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profile_locations" ADD CONSTRAINT "social_profile_locations_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_variant_id_social_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."social_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_variants" ADD CONSTRAINT "social_variants_package_id_social_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."social_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_variants" ADD CONSTRAINT "social_variants_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_policies" ADD CONSTRAINT "dunning_policies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_policies" ADD CONSTRAINT "dunning_policies_downgrade_to_plan_id_plans_id_fk" FOREIGN KEY ("downgrade_to_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_dunning_invoice_id_invoices_id_fk" FOREIGN KEY ("dunning_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_schedules" ADD CONSTRAINT "invoice_schedules_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_run_deliveries" ADD CONSTRAINT "export_run_deliveries_run_id_export_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."export_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_run_deliveries" ADD CONSTRAINT "export_run_deliveries_mail_delivery_id_mail_deliveries_id_fk" FOREIGN KEY ("mail_delivery_id") REFERENCES "public"."mail_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_definition_id_export_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."export_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_space_id_community_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."community_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_registries" ADD CONSTRAINT "gift_registries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_registry_items" ADD CONSTRAINT "gift_registry_items_registry_id_gift_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."gift_registries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_video_artifacts" ADD CONSTRAINT "voice_video_artifacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connections_name_idx" ON "agent_connections" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_playbook_versions_idx" ON "agent_playbook_versions" USING btree ("playbook_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_playbooks_name_idx" ON "agent_playbooks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agent_tasks_root_idx" ON "agent_tasks" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_parent_idx" ON "agent_tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_idx" ON "agent_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_due_idx" ON "agent_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_tasks_runnable_idx" ON "agent_tasks" USING btree ("priority","created_at") WHERE "agent_tasks"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agents_connection_idx" ON "agents" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_idx" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_live_name_idx" ON "api_keys" USING btree ("name") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "login_security_events_user_created_idx" ON "login_security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_security_events_notice_idx" ON "login_security_events" USING btree ("notice_status","created_at");--> statement-breakpoint
CREATE INDEX "login_security_events_expiry_idx" ON "login_security_events" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_idx" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_grants_module_idx" ON "role_grants" USING btree ("module");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_token_idx" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_pending_email_idx" ON "staff_invitations" USING btree ("email") WHERE "staff_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "staff_invitations_status_expiry_idx" ON "staff_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "staff_invitations_created_idx" ON "staff_invitations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_challenges_token_idx" ON "two_factor_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "two_factor_challenges_user_expiry_idx" ON "two_factor_challenges" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_recovery_codes_hash_idx" ON "two_factor_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "two_factor_recovery_codes_user_idx" ON "two_factor_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_idx" ON "users" USING btree ("role") WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_idx" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_idx" ON "webauthn_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefing_contributions_key_idx" ON "briefing_contributions" USING btree ("briefing_id","key");--> statement-breakpoint
CREATE INDEX "briefing_contributions_briefing_idx" ON "briefing_contributions" USING btree ("briefing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefing_preferences_idx" ON "briefing_preferences" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_person_day_idx" ON "briefings" USING btree ("user_id","on_date");--> statement-breakpoint
CREATE INDEX "briefings_unread_idx" ON "briefings" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_entries_unique_idx" ON "catalogue_entries" USING btree ("source_id","slug");--> statement-breakpoint
CREATE INDEX "catalogue_entries_kind_idx" ON "catalogue_entries" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX "catalogue_installs_slug_idx" ON "catalogue_installs" USING btree ("slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_sources_url_idx" ON "catalogue_sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "catalogue_sources_enabled_idx" ON "catalogue_sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connection_grants_idx" ON "agent_connection_grants" USING btree ("agent_id","connected_account_id");--> statement-breakpoint
CREATE INDEX "agent_connection_grants_account_idx" ON "agent_connection_grants" USING btree ("connected_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_provider_idx" ON "connected_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_user_idx" ON "connected_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_capabilities_unique_idx" ON "connection_capabilities" USING btree ("connected_account_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "external_calendars_unique_idx" ON "external_calendars" USING btree ("connected_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_events_unique_idx" ON "external_events" USING btree ("external_calendar_id","external_id");--> statement-breakpoint
CREATE INDEX "external_events_window_idx" ON "external_events" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "contact_merge_operations_candidate_idx" ON "contact_merge_operations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "contact_merge_operations_survivor_idx" ON "contact_merge_operations" USING btree ("surviving_contact_id","merged_at");--> statement-breakpoint
CREATE INDEX "contact_merge_operations_merged_at_idx" ON "contact_merge_operations" USING btree ("merged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_edge_idx" ON "contact_relationships" USING btree ("from_contact_id","to_contact_id","kind");--> statement-breakpoint
CREATE INDEX "contact_relationships_to_idx" ON "contact_relationships" USING btree ("to_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_id_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_org_id_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_lifecycle_stage_idx" ON "contacts" USING btree ("lifecycle_stage");--> statement-breakpoint
CREATE INDEX "contacts_tags_idx" ON "contacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "contacts_name_search_idx" ON "contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_email_search_idx" ON "contacts" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_normalized_name_idx" ON "contacts" USING btree (regexp_replace(lower(trim("name")), '[[:space:]]+', ' ', 'g'));--> statement-breakpoint
CREATE INDEX "contacts_normalized_phone_idx" ON "contacts" USING btree ((case
        when regexp_replace("phone", '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
          then substring(regexp_replace("phone", '[^0-9]', '', 'g') from 2)
        else regexp_replace("phone", '[^0-9]', '', 'g')
      end));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_entity_key_idx" ON "custom_field_definitions" USING btree ("entity","key");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_order_idx" ON "custom_field_definitions" USING btree ("entity","active","position");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_magic_links_token_idx" ON "customer_magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_magic_links_contact_expiry_idx" ON "customer_magic_links" USING btree ("contact_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_candidates_pair_idx" ON "merge_candidates" USING btree ("contact_a_id","contact_b_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_a_idx" ON "merge_candidates" USING btree ("contact_a_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_b_idx" ON "merge_candidates" USING btree ("contact_b_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_status_score_idx" ON "merge_candidates" USING btree ("status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_domain_idx" ON "organizations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organizations_name_search_idx" ON "organizations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "organizations_domain_search_idx" ON "organizations" USING gin ("domain" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "timeline_events_contact_id_idx" ON "timeline_events" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_subject_idx" ON "timeline_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_assets_unique_idx" ON "contribution_assets" USING btree ("contribution_id","asset_id");--> statement-breakpoint
CREATE INDEX "contribution_assets_contribution_idx" ON "contribution_assets" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_events_contribution_idx" ON "contribution_events" USING btree ("contribution_id","created_at");--> statement-breakpoint
CREATE INDEX "contributions_contact_idx" ON "contributions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contributions_status_idx" ON "contributions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contributions_kind_idx" ON "contributions" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "contributions_hash_idx" ON "contributions" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_records_fixture_idx" ON "demo_records" USING btree ("run_id","generation","contribution_key","fixture_key");--> statement-breakpoint
CREATE INDEX "demo_records_subject_idx" ON "demo_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "demo_scenario_runs_scenario_idx" ON "demo_scenario_runs" USING btree ("scenario_key","scenario_version","loaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_scenario_runs_one_active_idx" ON "demo_scenario_runs" USING btree ("status") WHERE "demo_scenario_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "demo_scenarios_status_idx" ON "demo_scenarios" USING btree ("status","key","version");--> statement-breakpoint
CREATE INDEX "content_unlocks_contact_idx" ON "content_unlocks" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_unlocks_invoice_idx" ON "content_unlocks" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "entitlement_grants_contact_idx" ON "entitlement_grants" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "entitlement_grants_entitlement_idx" ON "entitlement_grants" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "entitlement_grants_subscription_idx" ON "entitlement_grants" USING btree ("source_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_subscription_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_subscription_id") WHERE "entitlement_grants"."source_subscription_id" is not null and "entitlement_grants"."status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_pass_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_pass_balance_id") WHERE "entitlement_grants"."source_pass_balance_id" is not null and "entitlement_grants"."status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_unlock_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id","source_unlock_id") WHERE "entitlement_grants"."source_unlock_id" is not null and "entitlement_grants"."status" in ('active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_manual_live_idx" ON "entitlement_grants" USING btree ("entitlement_id","contact_id") WHERE "entitlement_grants"."source_subscription_id" is null and "entitlement_grants"."source_pass_balance_id" is null
          and "entitlement_grants"."source_unlock_id" is null and "entitlement_grants"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "entitlements_grantor_idx" ON "entitlements" USING btree ("grantor_type","grantor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_grantor_resource_idx" ON "entitlements" USING btree ("grantor_type","grantor_id",("resource"->>'kind'),coalesce("resource"->>'selector', ''));--> statement-breakpoint
CREATE INDEX "pass_balances_contact_idx" ON "pass_balances" USING btree ("contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pass_balances_order_idx" ON "pass_balances" USING btree ("source_order_id","product_id") WHERE "pass_balances"."source_order_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "outbox_delivery_pending_idx" ON "outbox_event_deliveries" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_dead_letter_idx" ON "outbox_events" USING btree ("status","dead_lettered_at");--> statement-breakpoint
CREATE INDEX "guidance_flows_status_idx" ON "guidance_flows" USING btree ("status","key","version");--> statement-breakpoint
CREATE INDEX "guidance_progress_user_state_idx" ON "guidance_progress" USING btree ("user_id","state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_translations_key_idx" ON "entity_translations" USING btree ("entity_type","entity_id","locale");--> statement-breakpoint
CREATE INDEX "entity_translations_locale_idx" ON "entity_translations" USING btree ("locale","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_keys_name_key_idx" ON "job_idempotency_keys" USING btree ("job_name","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_keys_job_id_idx" ON "job_idempotency_keys" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_idempotency_keys_expiry_idx" ON "job_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_runtime_heartbeats_freshness_idx" ON "job_runtime_heartbeats" USING btree ("heartbeat_at");--> statement-breakpoint
CREATE INDEX "job_runtime_heartbeats_role_state_idx" ON "job_runtime_heartbeats" USING btree ("role","state");--> statement-breakpoint
CREATE UNIQUE INDEX "business_locations_slug" ON "business_locations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "business_locations_one_primary" ON "business_locations" USING btree ("is_primary") WHERE "business_locations"."is_primary";--> statement-breakpoint
CREATE INDEX "opening_hours_location" ON "opening_hours" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_location" ON "service_areas" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_deliveries_idempotency_idx" ON "mail_deliveries" USING btree ("idempotency_key") WHERE "mail_deliveries"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "mail_deliveries_provider_ref_idx" ON "mail_deliveries" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "mail_deliveries_recipient_idx" ON "mail_deliveries" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "mail_deliveries_status_idx" ON "mail_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "mail_oauth_states_expiry_idx" ON "mail_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_created_idx" ON "mail_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_provider_events_external_idx" ON "mail_provider_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "mail_provider_events_delivery_idx" ON "mail_provider_events" USING btree ("delivery_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mail_provider_events_recipient_idx" ON "mail_provider_events" USING btree ("recipient","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_senders_identity_idx" ON "mail_senders" USING btree ("purpose","provider","email");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_senders_default_idx" ON "mail_senders" USING btree ("purpose") WHERE "mail_senders"."is_default" = true;--> statement-breakpoint
CREATE INDEX "mail_senders_connection_idx" ON "mail_senders" USING btree ("connected_account_id");--> statement-breakpoint
CREATE INDEX "mail_senders_status_idx" ON "mail_senders" USING btree ("purpose","status");--> statement-breakpoint
CREATE INDEX "mail_suppressions_active_idx" ON "mail_suppressions" USING btree ("created_at") WHERE "mail_suppressions"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_key_unique" ON "assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "assets_status_created_at_idx" ON "assets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assets_purge_after_idx" ON "assets" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "assets_created_at_idx" ON "assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "media_alt_text_asset_created_idx" ON "media_alt_text_suggestions" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_alt_text_one_ready_per_asset" ON "media_alt_text_suggestions" USING btree ("asset_id") WHERE "media_alt_text_suggestions"."status" = 'ready';--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_chunks_session_seq_idx" ON "media_capture_chunks" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "media_capture_chunks_session_idx" ON "media_capture_chunks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "media_capture_items_session_idx" ON "media_capture_items" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_items_staged_key_idx" ON "media_capture_items" USING btree ("staged_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_sessions_token_idx" ON "media_capture_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "media_capture_sessions_status_expiry_idx" ON "media_capture_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "media_capture_sessions_created_by_idx" ON "media_capture_sessions" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "media_objects_asset_idx" ON "media_objects" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "media_objects_pending_idx" ON "media_objects" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "media_objects_upload_idx" ON "media_objects" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_uploads_storage_key_unique" ON "media_uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_uploads_state_expiry_idx" ON "media_uploads" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "media_uploads_asset_idx" ON "media_uploads" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_assignee_idx" ON "conversations" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_thread_key_idx" ON "conversations" USING btree ("thread_key") WHERE thread_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_rule_events_provider_idx" ON "keyword_rule_events" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "keyword_rule_events_contact_idx" ON "keyword_rule_events" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "keyword_rule_events_rule_idx" ON "keyword_rule_events" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_rules_match_idx" ON "keyword_rules" USING btree ("normalized_keyword","match","locale");--> statement-breakpoint
CREATE INDEX "keyword_rules_active_idx" ON "keyword_rules" USING btree ("active","locale");--> statement-breakpoint
CREATE INDEX "message_deliveries_message_idx" ON "message_deliveries" USING btree ("message_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_deliveries_once_idx" ON "message_deliveries" USING btree ("message_id","status");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_contact_idx" ON "messages" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_chat_session_idx" ON "messages" USING btree ("chat_session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_ref_idx" ON "messages" USING btree ("provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "site_chat_sessions_token_idx" ON "site_chat_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "site_chat_sessions_contact_idx" ON "site_chat_sessions" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "site_chat_sessions_conversation_idx" ON "site_chat_sessions" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_chat_sessions_one_open_idx" ON "site_chat_sessions" USING btree ("conversation_id") WHERE closed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_compliance_events_provider_ref_idx" ON "sms_compliance_events" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "sms_compliance_events_contact_idx" ON "sms_compliance_events" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "note_revisions_note_idx" ON "note_revisions" USING btree ("note_id","edited_at");--> statement-breakpoint
CREATE INDEX "notes_subject_idx" ON "notes" USING btree ("subject_type","subject_id","pinned","created_at");--> statement-breakpoint
CREATE INDEX "notes_contact_idx" ON "notes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_author_idx" ON "notes" USING btree ("author_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_contact_idx" ON "device_tokens" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_idx" ON "notification_deliveries" USING btree ("notification_id","channel","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_digest_idx" ON "notification_deliveries" USING btree ("digest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digests_idempotency_idx" ON "notification_digests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_digests_recipient_idx" ON "notification_digests" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_idx" ON "notification_preferences" USING btree ("user_id","topic","channel") WHERE "notification_preferences"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_contact_idx" ON "notification_preferences" USING btree ("contact_id","topic","channel") WHERE "notification_preferences"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_receipts_notification_idx" ON "notification_receipts" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_user_idx" ON "notification_settings" USING btree ("user_id") WHERE "notification_settings"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_contact_idx" ON "notification_settings" USING btree ("contact_id") WHERE "notification_settings"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_idx" ON "notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_user_inbox_idx" ON "notifications" USING btree ("recipient_user_id","archived_at","read_at","last_occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_contact_inbox_idx" ON "notifications" USING btree ("recipient_contact_id","archived_at","read_at","last_occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_escalation_idx" ON "notifications" USING btree ("escalate_at","escalated_at");--> statement-breakpoint
CREATE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("recipient_user_id","dedupe_key","archived_at");--> statement-breakpoint
CREATE INDEX "notifications_contact_dedupe_idx" ON "notifications" USING btree ("recipient_contact_id","dedupe_key","archived_at");--> statement-breakpoint
CREATE INDEX "notifications_external_dedupe_idx" ON "notifications" USING btree ("external_recipient","dedupe_key","archived_at");--> statement-breakpoint
CREATE INDEX "paywall_meters_paywall_idx" ON "paywall_meter_counters" USING btree ("paywall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paywall_meters_contact_idx" ON "paywall_meter_counters" USING btree ("paywall_id","contact_id") WHERE "paywall_meter_counters"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "paywall_meters_anon_idx" ON "paywall_meter_counters" USING btree ("paywall_id","anon_id") WHERE "paywall_meter_counters"."anon_id" is not null;--> statement-breakpoint
CREATE INDEX "paywalls_status_idx" ON "paywalls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "installed_plugins_name_idx" ON "installed_plugins" USING btree ("name");--> statement-breakpoint
CREATE INDEX "installed_plugins_status_idx" ON "installed_plugins" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_registries_url_idx" ON "plugin_registries" USING btree ("url");--> statement-breakpoint
CREATE INDEX "consent_records_contact_idx" ON "consent_records" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_records_effective_idx" ON "consent_records" USING btree ("contact_id","purpose","channel","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_request_artifacts_request_idx" ON "data_request_artifacts" USING btree ("data_request_id");--> statement-breakpoint
CREATE INDEX "data_request_artifacts_expiry_idx" ON "data_request_artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "data_requests_contact_idx" ON "data_requests" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "data_requests_status_due_idx" ON "data_requests" USING btree ("status","response_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_retention_exceptions_scope_idx" ON "privacy_retention_exceptions" USING btree ("data_request_id","scope");--> statement-breakpoint
CREATE INDEX "privacy_retention_exceptions_expiry_idx" ON "privacy_retention_exceptions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "run_approvals_subject_idx" ON "run_approvals" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "run_approvals_pending_idx" ON "run_approvals" USING btree ("created_at") WHERE "run_approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "run_spend_agent_period_idx" ON "run_spend" USING btree ("agent_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_run_seq_idx" ON "run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_subject_idx" ON "runs" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "runs_agent_idx" ON "runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "runs_lease_idx" ON "runs" USING btree ("lease_expires_at") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "runs_contact_idx" ON "runs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "runs_wake_idx" ON "runs" USING btree ("wake_at") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "runs_idempotency_idx" ON "runs" USING btree ("subject_kind","subject_id","idempotency_key") WHERE "runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "availability_exceptions_calendar_idx" ON "availability_exceptions" USING btree ("calendar_id","starts_on");--> statement-breakpoint
CREATE INDEX "availability_rules_calendar_idx" ON "availability_rules" USING btree ("calendar_id","weekday");--> statement-breakpoint
CREATE INDEX "booking_participants_booking_idx" ON "booking_participants" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_participants_contact_idx" ON "booking_participants" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "booking_reminders_due_idx" ON "booking_reminders" USING btree ("status","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reminders_unique_idx" ON "booking_reminders" USING btree ("booking_id","channel","offset_min");--> statement-breakpoint
CREATE INDEX "booking_waitlist_queue_idx" ON "booking_waitlist" USING btree ("calendar_id","status","position","created_at");--> statement-breakpoint
CREATE INDEX "booking_waitlist_contact_idx" ON "booking_waitlist" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "booking_waitlist_window_idx" ON "booking_waitlist" USING btree ("window_start","window_end");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_waitlist_offer_token_idx" ON "booking_waitlist" USING btree ("offer_token") WHERE "booking_waitlist"."offer_token" is not null;--> statement-breakpoint
CREATE INDEX "bookings_calendar_idx" ON "bookings" USING btree ("calendar_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_contact_idx" ON "bookings" USING btree ("contact_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reschedule_token_idx" ON "bookings" USING btree ("reschedule_token") WHERE "bookings"."reschedule_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_memberships_unique_idx" ON "calendar_memberships" USING btree ("service_offering_id","calendar_id","role");--> statement-breakpoint
CREATE INDEX "calendar_memberships_service_idx" ON "calendar_memberships" USING btree ("service_offering_id","priority");--> statement-breakpoint
CREATE INDEX "calendar_memberships_calendar_idx" ON "calendar_memberships" USING btree ("calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_slug_idx" ON "calendars" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "calendars_kind_idx" ON "calendars" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "calendars_user_idx" ON "calendars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_one_business_idx" ON "calendars" USING btree ("kind") WHERE "calendars"."kind" = 'business';--> statement-breakpoint
CREATE UNIQUE INDEX "external_busy_blocks_ref_idx" ON "external_busy_blocks" USING btree ("calendar_id","source_ref");--> statement-breakpoint
CREATE INDEX "external_busy_blocks_window_idx" ON "external_busy_blocks" USING btree ("calendar_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "contact_score_awards_contact_idx" ON "contact_score_awards" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_score_awards_rule_idx" ON "contact_score_awards" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_score_awards_once_idx" ON "contact_score_awards" USING btree ("rule_id","contact_id","source_event_id") WHERE source_event_id is not null;--> statement-breakpoint
CREATE INDEX "scoring_rules_event_idx" ON "scoring_rules" USING btree ("event_name","active");--> statement-breakpoint
CREATE INDEX "scoring_rules_kind_idx" ON "scoring_rules" USING btree ("kind","active");--> statement-breakpoint
CREATE INDEX "csp_violations_last_at_idx" ON "csp_violations" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "csp_violations_expires_at_idx" ON "csp_violations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "csp_violations_directive_idx" ON "csp_violations" USING btree ("effective_directive","last_at");--> statement-breakpoint
CREATE INDEX "segment_members_contact_idx" ON "segment_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_slug_idx" ON "segments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "segments_kind_idx" ON "segments" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_from_locale_idx" ON "redirects" USING btree ("from_path","locale");--> statement-breakpoint
CREATE INDEX "redirects_to_idx" ON "redirects" USING btree ("to_path");--> statement-breakpoint
CREATE INDEX "tasks_open_idx" ON "tasks" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_subject_idx" ON "tasks" USING btree ("subject_type","subject_id","position");--> statement-breakpoint
CREATE INDEX "tasks_contact_idx" ON "tasks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "tasks_reminder_idx" ON "tasks" USING btree ("remind_at") WHERE status = 'open' and remind_at is not null and reminded_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "available_releases_version_key" ON "available_releases" USING btree ("version");--> statement-breakpoint
CREATE INDEX "available_releases_published_idx" ON "available_releases" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "saved_views_entity_idx" ON "saved_views" USING btree ("entity","owner_user_id");--> statement-breakpoint
CREATE INDEX "saved_views_shared_idx" ON "saved_views" USING btree ("entity","shared");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_default_idx" ON "saved_views" USING btree ("entity","owner_user_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_subscription_idx" ON "webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_outbox_event_idx" ON "webhook_deliveries" USING btree ("subscription_id","outbox_event_id") WHERE "webhook_deliveries"."outbox_event_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" in ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_subscriptions_name_idx" ON "webhook_subscriptions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_status_idx" ON "webhook_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_import_rows_import_idx" ON "contact_import_rows" USING btree ("import_id","line_number");--> statement-breakpoint
CREATE INDEX "contact_import_rows_outcome_idx" ON "contact_import_rows" USING btree ("import_id","outcome");--> statement-breakpoint
CREATE INDEX "contact_import_rows_contact_idx" ON "contact_import_rows" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_import_rows_relationship_idx" ON "contact_import_rows" USING btree ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_import_rows_line_idx" ON "contact_import_rows" USING btree ("import_id","line_number");--> statement-breakpoint
CREATE INDEX "contact_imports_status_idx" ON "contact_imports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_contact_import_choice_user_flow_idx" ON "signup_contact_import_choices" USING btree ("user_id","flow");--> statement-breakpoint
CREATE INDEX "signup_contact_import_choice_import_idx" ON "signup_contact_import_choices" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_numbers_ref_idx" ON "messaging_numbers" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "messaging_numbers_e164_idx" ON "messaging_numbers" USING btree ("e164");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_numbers_default_idx" ON "messaging_numbers" USING btree ("purpose") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_windows_code_idx" ON "messaging_windows" USING btree ("code");--> statement-breakpoint
CREATE INDEX "messaging_windows_scope_idx" ON "messaging_windows" USING btree ("scope","active");--> statement-breakpoint
CREATE INDEX "messaging_windows_contact_idx" ON "messaging_windows" USING btree ("contact_id","active");--> statement-breakpoint
CREATE INDEX "messaging_windows_segment_idx" ON "messaging_windows" USING btree ("segment_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_audience_calendars_idx" ON "booking_audience_calendars" USING btree ("audience_id","calendar_id");--> statement-breakpoint
CREATE INDEX "booking_audience_hours_idx" ON "booking_audience_hours" USING btree ("audience_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_audience_services_idx" ON "booking_audience_services" USING btree ("audience_id","service_offering_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_audiences_slug_idx" ON "booking_audiences" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_audiences_token_idx" ON "booking_audiences" USING btree ("token") WHERE "booking_audiences"."token" is not null;--> statement-breakpoint
CREATE INDEX "booking_audiences_enabled_idx" ON "booking_audiences" USING btree ("enabled","position");--> statement-breakpoint
CREATE INDEX "ad_campaigns_advertiser_idx" ON "ad_campaigns" USING btree ("advertiser_contact_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_status_idx" ON "ad_campaigns" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "ad_creatives_line_item_idx" ON "ad_creatives" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "ad_creatives_servable_idx" ON "ad_creatives" USING btree ("status","review_state");--> statement-breakpoint
CREATE INDEX "ad_line_items_campaign_idx" ON "ad_line_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ad_line_items_status_idx" ON "ad_line_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_sizes_shape_idx" ON "ad_sizes" USING btree ("breakpoint","width","height");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_slots_code_idx" ON "ad_slots" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ad_slots_status_idx" ON "ad_slots" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_stats_grain_idx" ON "ad_stats" USING btree ("line_item_id","creative_id","slot_id","day");--> statement-breakpoint
CREATE INDEX "ad_stats_day_idx" ON "ad_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ad_stats_line_item_idx" ON "ad_stats" USING btree ("line_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_txt_entries_line_idx" ON "ad_txt_entries" USING btree ("domain","account_id","relationship","surface");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_contact_idx" ON "advertisers" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "analytics_attribution_last_at_idx" ON "analytics_attributions" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "analytics_attribution_first_campaign_idx" ON "analytics_attributions" USING btree ("first_source","first_medium","first_campaign");--> statement-breakpoint
CREATE INDEX "analytics_attribution_last_campaign_idx" ON "analytics_attributions" USING btree ("last_source","last_medium","last_campaign");--> statement-breakpoint
CREATE INDEX "analytics_at_idx" ON "analytics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "analytics_name_at_idx" ON "analytics_events" USING btree ("name","at");--> statement-breakpoint
CREATE INDEX "analytics_anon_idx" ON "analytics_events" USING btree ("anon_id");--> statement-breakpoint
CREATE INDEX "analytics_contact_idx" ON "analytics_events" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_key_idx" ON "analytics_events" USING btree ("event_key") WHERE "analytics_events"."event_key" is not null;--> statement-breakpoint
CREATE INDEX "analytics_kind_at_idx" ON "analytics_events" USING btree ("visitor_kind","name","at");--> statement-breakpoint
CREATE INDEX "analytics_effective_kind_at_idx" ON "analytics_events" USING btree (coalesce("classification_override", "visitor_kind"),"name","at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_chunks_source_idx" ON "assistant_chunks" USING btree ("source_type","source_id","locale");--> statement-breakpoint
CREATE INDEX "assistant_chunks_locale_idx" ON "assistant_chunks" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_scope_grants_action_idx" ON "assistant_scope_grants" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_turns_message_idx" ON "assistant_turns" USING btree ("message_id") WHERE message_id is not null;--> statement-breakpoint
CREATE INDEX "assistant_turns_conversation_idx" ON "assistant_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_turns_created_idx" ON "assistant_turns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "knowledge_entries_locale_idx" ON "knowledge_entries" USING btree ("locale","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_gaps_message_idx" ON "knowledge_gaps" USING btree ("message_id") WHERE message_id is not null;--> statement-breakpoint
CREATE INDEX "knowledge_gaps_contact_idx" ON "knowledge_gaps" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "knowledge_gaps_status_idx" ON "knowledge_gaps" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_contact_state_once_idx" ON "automation_contact_state" USING btree ("automation_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_versions_number_idx" ON "automation_versions" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "automation_versions_automation_idx" ON "automation_versions" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automations_name_idx" ON "automations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "automations_event_idx" ON "automations" USING btree ("event_pattern","status");--> statement-breakpoint
CREATE INDEX "automations_due_idx" ON "automations" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "builder_code_proposals_status_idx" ON "builder_code_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "builder_proposals_status_idx" ON "builder_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "builder_proposals_created_idx" ON "builder_proposals" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_key_idx" ON "attribute_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "attribute_definitions_filter_idx" ON "attribute_definitions" USING btree ("is_filterable","key");--> statement-breakpoint
CREATE UNIQUE INDEX "back_in_stock_unique_idx" ON "back_in_stock_subscriptions" USING btree ("variant_id","contact_id","location_id");--> statement-breakpoint
CREATE INDEX "back_in_stock_contact_idx" ON "back_in_stock_subscriptions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "back_in_stock_variant_idx" ON "back_in_stock_subscriptions" USING btree ("variant_id","notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_components_unique_idx" ON "bundle_components" USING btree ("bundle_product_id","component_variant_id");--> statement-breakpoint
CREATE INDEX "bundle_components_variant_idx" ON "bundle_components" USING btree ("component_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_policies_name_idx" ON "cancellation_policies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_coupons_pk" ON "cart_coupons" USING btree ("cart_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_unique_idx" ON "cart_items" USING btree ("cart_id","variant_id") WHERE "cart_items"."asset_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_gallery_unique_idx" ON "cart_items" USING btree ("cart_id","variant_id","asset_id") WHERE "cart_items"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "cart_items_variant_idx" ON "cart_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_gallery_idx" ON "cart_items" USING btree ("gallery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_recoveries_cart_idx" ON "cart_recoveries" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_token_idx" ON "carts" USING btree ("token");--> statement-breakpoint
CREATE INDEX "carts_contact_status_idx" ON "carts" USING btree ("contact_id","status","kind");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id","created_at");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_contact_idx" ON "coupon_redemptions" USING btree ("contact_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_name_idx" ON "customer_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "delivery_windows_location_idx" ON "delivery_windows" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digital_deliveries_token_idx" ON "digital_deliveries" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "digital_deliveries_line_idx" ON "digital_deliveries" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "digital_deliveries_order_idx" ON "digital_deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_items_unique_idx" ON "fulfillment_items" USING btree ("fulfillment_id","order_item_id");--> statement-breakpoint
CREATE INDEX "fulfillment_items_order_item_idx" ON "fulfillment_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "fulfillments_location_idx" ON "fulfillments" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "gift_card_redemptions_card_idx" ON "gift_card_redemptions" USING btree ("gift_card_id");--> statement-breakpoint
CREATE INDEX "gift_card_redemptions_contact_idx" ON "gift_card_redemptions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_code_idx" ON "gift_cards" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_share_token_idx" ON "gift_cards" USING btree ("share_token_hash") WHERE "gift_cards"."share_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "gift_cards_contact_idx" ON "gift_cards" USING btree ("contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_variant_location_idx" ON "inventory_items" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_items_location_idx" ON "inventory_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "offer_rules_kind_idx" ON "offer_rules" USING btree ("kind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "option_types_code_idx" ON "option_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "option_values_type_fragment_idx" ON "option_values" USING btree ("option_type_id","sku_fragment");--> statement-breakpoint
CREATE INDEX "option_values_type_position_idx" ON "option_values" USING btree ("option_type_id","position");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_gallery_idx" ON "order_items" USING btree ("gallery_id");--> statement-breakpoint
CREATE INDEX "orders_contact_idx" ON "orders" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "orders_invoice_idx" ON "orders" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "price_breaks_list_idx" ON "price_breaks" USING btree ("price_list_id","variant_id","mode","min_qty");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_entries_unique_idx" ON "price_list_entries" USING btree ("price_list_id","variant_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_variant_idx" ON "price_list_entries" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "price_lists_resolve_idx" ON "price_lists" USING btree ("currency","active","kind","priority");--> statement-breakpoint
CREATE INDEX "price_lists_group_idx" ON "price_lists" USING btree ("customer_group_id");--> statement-breakpoint
CREATE INDEX "price_lists_segment_idx" ON "price_lists" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "price_lists_contact_idx" ON "price_lists" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rules_product_mode_idx" ON "price_rules" USING btree ("product_id","mode");--> statement-breakpoint
CREATE INDEX "price_rules_product_idx" ON "price_rules" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_pk" ON "product_attributes" USING btree ("product_id","attribute_id");--> statement-breakpoint
CREATE INDEX "product_attributes_attribute_idx" ON "product_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "product_lifecycle_events_product_idx" ON "product_lifecycle_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id","role","position");--> statement-breakpoint
CREATE INDEX "product_media_variant_idx" ON "product_media" USING btree ("variant_id","role","position");--> statement-breakpoint
CREATE INDEX "product_media_asset_idx" ON "product_media" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_assignments_unique_idx" ON "product_option_assignments" USING btree ("product_id","option_type_id");--> statement-breakpoint
CREATE INDEX "product_option_assignments_product_idx" ON "product_option_assignments" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_value_assignments_pk" ON "product_option_value_assignments" USING btree ("assignment_id","option_value_id");--> statement-breakpoint
CREATE INDEX "product_option_value_assignments_value_idx" ON "product_option_value_assignments" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_relations_unique_idx" ON "product_relations" USING btree ("product_id","related_product_id","kind");--> statement-breakpoint
CREATE INDEX "product_relations_related_idx" ON "product_relations" USING btree ("related_product_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_options_pk" ON "product_variant_options" USING btree ("variant_id","option_type_id");--> statement-breakpoint
CREATE INDEX "product_variant_options_value_idx" ON "product_variant_options" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_combination_idx" ON "product_variants" USING btree ("product_id","combination_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_default_idx" ON "product_variants" USING btree ("product_id") WHERE "product_variants"."is_default" and "product_variants"."status" = 'active';--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_status_updated_idx" ON "products" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "products_visibility_updated_idx" ON "products" USING btree ("visibility","updated_at");--> statement-breakpoint
CREATE INDEX "products_kind_updated_idx" ON "products" USING btree ("kind","updated_at");--> statement-breakpoint
CREATE INDEX "products_tax_category_idx" ON "products" USING btree ("tax_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_unique_idx" ON "purchase_order_lines" USING btree ("purchase_order_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "purchase_order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_location_idx" ON "purchase_orders" USING btree ("location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_unique_idx" ON "return_items" USING btree ("return_id","order_item_id");--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "return_requests_contact_idx" ON "return_requests" USING btree ("contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_offerings_product_idx" ON "service_offerings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "service_offerings_policy_idx" ON "service_offerings" USING btree ("cancellation_policy_id");--> statement-breakpoint
CREATE INDEX "service_offerings_form_idx" ON "service_offerings" USING btree ("intake_form_id");--> statement-breakpoint
CREATE INDEX "shipping_methods_zone_idx" ON "shipping_methods" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "shipping_rate_bands_method_idx" ON "shipping_rate_bands" USING btree ("method_id","min_value");--> statement-breakpoint
CREATE INDEX "shipping_zones_priority_idx" ON "shipping_zones" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_item_status_idx" ON "stock_reservations" USING btree ("inventory_item_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_active_holder_idx" ON "stock_reservations" USING btree ("inventory_item_id","holder_type","holder_id") WHERE "stock_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "suppliers_contact_idx" ON "suppliers" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_unique_idx" ON "wishlist_items" USING btree ("wishlist_id","variant_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_variant_idx" ON "wishlist_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_contact_idx" ON "wishlists" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_share_token_idx" ON "wishlists" USING btree ("share_token_hash") WHERE "wishlists"."share_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "content_comments_page_idx" ON "content_comments" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "content_comments_parent_idx" ON "content_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "content_comments_review_idx" ON "content_comments" USING btree ("page_id","review_state");--> statement-breakpoint
CREATE UNIQUE INDEX "content_layouts_page_idx" ON "content_layouts" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_layouts_entity_locale_idx" ON "content_layouts" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "content_layouts_template_idx" ON "content_layouts" USING btree ("template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_presence_page_actor_idx" ON "content_presence" USING btree ("page_id","actor");--> statement-breakpoint
CREATE INDEX "content_presence_page_seen_idx" ON "content_presence" USING btree ("page_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_preview_links_token_idx" ON "content_preview_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "content_preview_links_page_idx" ON "content_preview_links" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "content_revisions_subject_idx" ON "content_revisions" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_key_preset_locale_idx" ON "content_templates" USING btree ("key","preset","locale");--> statement-breakpoint
CREATE INDEX "content_templates_kind_preset_idx" ON "content_templates" USING btree ("kind","preset");--> statement-breakpoint
CREATE UNIQUE INDEX "help_categories_slug_locale_idx" ON "help_categories" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "help_categories_position_idx" ON "help_categories" USING btree ("locale","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_locale_idx" ON "pages" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pages_help_category_idx" ON "pages" USING btree ("help_category_id");--> statement-breakpoint
CREATE INDEX "pages_title_search_idx" ON "pages" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "sections_key_locale_idx" ON "sections" USING btree ("key","locale");--> statement-breakpoint
CREATE INDEX "contract_documents_contact_idx" ON "contract_documents" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contract_documents_subject_idx" ON "contract_documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "contract_documents_status_idx" ON "contract_documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_documents_sign_token_idx" ON "contract_documents" USING btree ("sign_token") WHERE "contract_documents"."sign_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_templates_name_version_idx" ON "contract_templates" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "contract_templates_kind_idx" ON "contract_templates" USING btree ("kind","archived_at");--> statement-breakpoint
CREATE INDEX "contact_stages_stage_idx" ON "contact_stages" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deals_pipeline_idx" ON "deals" USING btree ("pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "deals_contact_idx" ON "deals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "deals" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status","expected_close_on");--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE INDEX "pipelines_kind_idx" ON "pipelines" USING btree ("kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default_idx" ON "pipelines" USING btree ("kind") WHERE "pipelines"."is_default" and "pipelines"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "document_access_logs_document_idx" ON "document_access_logs" USING btree ("document_id","at");--> statement-breakpoint
CREATE INDEX "document_access_logs_contact_idx" ON "document_access_logs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "document_access_logs_share_idx" ON "document_access_logs" USING btree ("share_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_shares_token_idx" ON "document_shares" USING btree ("token_hash") WHERE "document_shares"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "document_shares_document_idx" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_shares_contact_idx" ON "document_shares" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_number_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_contact_idx" ON "documents" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "documents_subject_idx" ON "documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "event_registrations_session_idx" ON "event_registrations" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "event_registrations_contact_idx" ON "event_registrations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_sessions_event_starts_idx" ON "event_sessions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_tickets_event_idx" ON "event_tickets" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_status_updated_idx" ON "events" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_contact_idx" ON "form_submissions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "form_submissions_status_idx" ON "form_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_slug_idx" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "galleries_slug_idx" ON "galleries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "galleries_contact_idx" ON "galleries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "gallery_access_logs_gallery_idx" ON "gallery_access_logs" USING btree ("gallery_id","at");--> statement-breakpoint
CREATE INDEX "gallery_access_logs_contact_idx" ON "gallery_access_logs" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_archives_gallery_idx" ON "gallery_archives" USING btree ("gallery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_guests_person_idx" ON "gallery_guests" USING btree ("gallery_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_guests_token_idx" ON "gallery_guests" USING btree ("token_hash") WHERE "gallery_guests"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "gallery_guests_contact_idx" ON "gallery_guests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "gallery_guests_invited_by_contact_idx" ON "gallery_guests" USING btree ("invited_by_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_items_unique_idx" ON "gallery_items" USING btree ("gallery_id","asset_id");--> statement-breakpoint
CREATE INDEX "gallery_items_order_idx" ON "gallery_items" USING btree ("gallery_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_price_sheet_unique_idx" ON "gallery_price_sheet_items" USING btree ("gallery_id","variant_id");--> statement-breakpoint
CREATE INDEX "gallery_price_sheet_order_idx" ON "gallery_price_sheet_items" USING btree ("gallery_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_rounds_sequence_idx" ON "gallery_rounds" USING btree ("gallery_id","sequence");--> statement-breakpoint
CREATE INDEX "gallery_rounds_gallery_idx" ON "gallery_rounds" USING btree ("gallery_id","state");--> statement-breakpoint
CREATE INDEX "gallery_rounds_contact_idx" ON "gallery_rounds" USING btree ("submitted_by_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_selections_unique_idx" ON "gallery_selections" USING btree ("gallery_id","contact_id","asset_id");--> statement-breakpoint
CREATE INDEX "gallery_selections_gallery_idx" ON "gallery_selections" USING btree ("gallery_id","kind");--> statement-breakpoint
CREATE INDEX "gallery_selections_contact_idx" ON "gallery_selections" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_sessions_token_idx" ON "gallery_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "gallery_sessions_gallery_idx" ON "gallery_sessions" USING btree ("gallery_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_lines_position_idx" ON "credit_note_lines" USING btree ("credit_note_id","position");--> statement-breakpoint
CREATE INDEX "credit_note_lines_invoice_line_idx" ON "credit_note_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_number_idx" ON "credit_notes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_idempotency_idx" ON "credit_notes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_balance_accounts_contact_currency_idx" ON "customer_balance_accounts" USING btree ("contact_id","currency");--> statement-breakpoint
CREATE INDEX "customer_balance_accounts_contact_idx" ON "customer_balance_accounts" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_balance_entries_idempotency_idx" ON "customer_balance_entries" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_balance_entries_account_idx" ON "customer_balance_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_balance_entries_source_idx" ON "customer_balance_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexible_payments_invoice_idx" ON "flexible_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexible_payments_idempotency_idx" ON "flexible_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "flexible_payments_attached_idx" ON "flexible_payments" USING btree ("attached_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_position_idx" ON "invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_lines_source_idx" ON "invoice_lines" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_source_idx" ON "invoices" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idempotency_idx" ON "invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoices_contact_idx" ON "invoices" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "invoices_tax_zone_idx" ON "invoices" USING btree ("tax_zone_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_deposit_of_idx" ON "invoices" USING btree ("deposit_of_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "late_fee_assessments_fee_invoice_idx" ON "late_fee_assessments" USING btree ("fee_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "late_fee_assessments_idempotency_idx" ON "late_fee_assessments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "late_fee_assessments_source_idx" ON "late_fee_assessments" USING btree ("source_invoice_id","assessed_at");--> statement-breakpoint
CREATE INDEX "money_state_events_subject_idx" ON "money_state_events" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_installment_idx" ON "payment_allocations" USING btree ("payment_id","installment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_installment_idx" ON "payment_allocations" USING btree ("installment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_disputes_provider_ref_idx" ON "payment_disputes" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payment_disputes_payment_idx" ON "payment_disputes" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_disputes_invoice_idx" ON "payment_disputes" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_disputes_status_due_idx" ON "payment_disputes" USING btree ("status","evidence_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_ref_idx" ON "payment_methods" USING btree ("provider","provider_method_ref");--> statement-breakpoint
CREATE INDEX "payment_methods_contact_status_idx" ON "payment_methods" USING btree ("contact_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payment_methods_customer_ref_idx" ON "payment_methods" USING btree ("provider","provider_customer_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plan_installments_position_idx" ON "payment_plan_installments" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "payment_plan_installments_due_idx" ON "payment_plan_installments" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_invoice_idx" ON "payment_plans" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plans_idempotency_idx" ON "payment_plans" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_plans_status_idx" ON "payment_plans" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_provider_customers_contact_idx" ON "payment_provider_customers" USING btree ("contact_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_customers_ref_idx" ON "payment_provider_customers" USING btree ("provider","provider_customer_ref");--> statement-breakpoint
CREATE INDEX "payment_provider_customers_contact_created_idx" ON "payment_provider_customers" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_id_idx" ON "payment_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_status_received_idx" ON "payment_provider_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "payment_provider_events_object_idx" ON "payment_provider_events" USING btree ("provider","provider_object_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_idx" ON "payments" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_checkout_ref_idx" ON "payments" USING btree ("provider","provider_checkout_ref");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_balance_transactions_ref_idx" ON "provider_balance_transactions" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_source_idx" ON "provider_balance_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_available_idx" ON "provider_balance_transactions" USING btree ("provider","currency","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payout_items_transaction_idx" ON "provider_payout_items" USING btree ("balance_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payout_items_pair_idx" ON "provider_payout_items" USING btree ("payout_id","balance_transaction_id");--> statement-breakpoint
CREATE INDEX "provider_payout_items_payout_idx" ON "provider_payout_items" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_payouts_ref_idx" ON "provider_payouts" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "provider_payouts_status_idx" ON "provider_payouts" USING btree ("status","expected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_idx" ON "refunds" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_ref_idx" ON "refunds" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_invoice_idx" ON "refunds" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_categories_code_idx" ON "tax_categories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tax_exemptions_contact_idx" ON "tax_exemptions" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "tax_exemptions_zone_idx" ON "tax_exemptions" USING btree ("zone_id","status");--> statement-breakpoint
CREATE INDEX "tax_lines_invoice_idx" ON "tax_lines" USING btree ("invoice_id","priority");--> statement-breakpoint
CREATE INDEX "tax_lines_invoice_line_idx" ON "tax_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "tax_rates_zone_idx" ON "tax_rates" USING btree ("zone_id","active","priority");--> statement-breakpoint
CREATE INDEX "tax_rates_category_idx" ON "tax_rates" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tax_registrations_zone_idx" ON "tax_registrations" USING btree ("zone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_zones_template_idx" ON "tax_zones" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "tax_zones_match_idx" ON "tax_zones" USING btree ("country","active","priority");--> statement-breakpoint
CREATE INDEX "earn_rules_program_idx" ON "earn_rules" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "earn_rules_event_idx" ON "earn_rules" USING btree ("event_type","active");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_accounts_contact_program_idx" ON "loyalty_accounts" USING btree ("contact_id","program_id");--> statement-breakpoint
CREATE INDEX "loyalty_accounts_program_idx" ON "loyalty_accounts" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "loyalty_accounts_activity_idx" ON "loyalty_accounts" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "loyalty_programs_status_idx" ON "loyalty_programs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_tiers_program_position_idx" ON "loyalty_tiers" USING btree ("program_id","position");--> statement-breakpoint
CREATE INDEX "loyalty_tiers_program_idx" ON "loyalty_tiers" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "points_ledger_account_idx" ON "points_ledger" USING btree ("account_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_earn_once_idx" ON "points_ledger" USING btree ("rule_id","source_type","source_id") WHERE "points_ledger"."reason" = 'earn';--> statement-breakpoint
CREATE INDEX "points_ledger_reverses_idx" ON "points_ledger" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "points_ledger_expiry_idx" ON "points_ledger" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "redemptions_account_idx" ON "redemptions" USING btree ("account_id","at");--> statement-breakpoint
CREATE INDEX "redemptions_reward_idx" ON "redemptions" USING btree ("reward_id");--> statement-breakpoint
CREATE INDEX "rewards_program_status_idx" ON "rewards" USING btree ("program_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_issues_slug_idx" ON "newsletter_issues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "newsletter_issues_newsletter_idx" ON "newsletter_issues" USING btree ("newsletter_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_newsletter_contact_idx" ON "newsletter_subscriptions" USING btree ("newsletter_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_confirm_token_idx" ON "newsletter_subscriptions" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_unsubscribe_token_idx" ON "newsletter_subscriptions" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "newsletter_subscriptions_contact_idx" ON "newsletter_subscriptions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletters_slug_idx" ON "newsletters" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "popup_events_cap_idx" ON "popup_events" USING btree ("popup_id","visitor_key","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_report_idx" ON "popup_events" USING btree ("popup_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "popup_events_contact_idx" ON "popup_events" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "popups_slug_idx" ON "popups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "popups_status_idx" ON "popups" USING btree ("status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "project_collection_items_unique_idx" ON "project_collection_items" USING btree ("collection_id","project_id");--> statement-breakpoint
CREATE INDEX "project_collection_items_project_idx" ON "project_collection_items" USING btree ("project_id","collection_id");--> statement-breakpoint
CREATE INDEX "project_collection_items_order_idx" ON "project_collection_items" USING btree ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "project_collections_slug_idx" ON "project_collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_collections_public_idx" ON "project_collections" USING btree ("publication_status","position");--> statement-breakpoint
CREATE INDEX "project_files_project_idx" ON "project_files" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_unique_idx" ON "project_files" USING btree ("project_id","asset_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_pair_role_idx" ON "project_files" USING btree ("project_id","pair_key","role") WHERE "project_files"."pair_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_links_unique_idx" ON "project_links" USING btree ("project_id","kind","target_id");--> statement-breakpoint
CREATE INDEX "project_links_target_idx" ON "project_links" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "project_outcomes_project_idx" ON "project_outcomes" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_testimonials_project_idx" ON "project_testimonials" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "project_testimonials_contact_idx" ON "project_testimonials" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "projects_contact_idx" ON "projects" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status","occurred_on");--> statement-breakpoint
CREATE INDEX "projects_publication_idx" ON "projects" USING btree ("publication_status","published_at");--> statement-breakpoint
CREATE INDEX "projects_featured_idx" ON "projects" USING btree ("featured","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proof_notices_slug_idx" ON "proof_notices" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "proof_notices_published_idx" ON "proof_notices" USING btree ("published");--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id","version","sort_order");--> statement-breakpoint
CREATE INDEX "quote_messages_quote_idx" ON "quote_messages" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_partner_links_person_idx" ON "quote_partner_links" USING btree ("quote_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_partner_links_token_idx" ON "quote_partner_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quote_partner_links_invited_by_idx" ON "quote_partner_links" USING btree ("invited_by_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_reference_idx" ON "quotes" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "quotes_contact_idx" ON "quotes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_view_token_idx" ON "quotes" USING btree ("view_token") WHERE "quotes"."view_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_codes_code_idx" ON "affiliate_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliate_codes_program_idx" ON "affiliate_codes" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "affiliate_codes_contact_idx" ON "affiliate_codes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "affiliate_programs_status_idx" ON "affiliate_programs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_tax_profiles_contact_idx" ON "affiliate_tax_profiles" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "attribution_touches_contact_idx" ON "attribution_touches" USING btree ("contact_id","at");--> statement-breakpoint
CREATE INDEX "attribution_touches_anon_idx" ON "attribution_touches" USING btree ("anon_id","at");--> statement-breakpoint
CREATE INDEX "attribution_touches_code_idx" ON "attribution_touches" USING btree ("code_id");--> statement-breakpoint
CREATE INDEX "commission_events_affiliate_idx" ON "commission_events" USING btree ("affiliate_contact_id","status");--> statement-breakpoint
CREATE INDEX "commission_events_payable_idx" ON "commission_events" USING btree ("status","payable_at");--> statement-breakpoint
CREATE INDEX "commission_events_subject_idx" ON "commission_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "commission_events_program_idx" ON "commission_events" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_events_once_idx" ON "commission_events" USING btree ("code_id","subject_type","subject_id") WHERE "commission_events"."reverses_id" is null and "commission_events"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_batches_status_idx" ON "payout_batches" USING btree ("status","period_end");--> statement-breakpoint
CREATE INDEX "payout_lines_batch_idx" ON "payout_lines" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payout_lines_affiliate_idx" ON "payout_lines" USING btree ("affiliate_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_lines_once_idx" ON "payout_lines" USING btree ("batch_id","affiliate_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_invitations_token_idx" ON "referral_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "referral_invitations_referrer_idx" ON "referral_invitations" USING btree ("referrer_contact_id");--> statement-breakpoint
CREATE INDEX "referral_invitations_program_idx" ON "referral_invitations" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_contact_idx" ON "rental_agreements" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_variant_idx" ON "rental_agreements" USING btree ("variant_id","starts_at");--> statement-breakpoint
CREATE INDEX "rental_agreements_status_idx" ON "rental_agreements" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "rental_agreements_booking_idx" ON "rental_agreements" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_terms_variant_idx" ON "rental_terms" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "rental_terms_calendar_idx" ON "rental_terms" USING btree ("calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_views_name_idx" ON "report_views" USING btree ("name");--> statement-breakpoint
CREATE INDEX "report_views_key_idx" ON "report_views" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "review_media_unique_idx" ON "review_media" USING btree ("review_id","asset_id");--> statement-breakpoint
CREATE INDEX "review_media_review_idx" ON "review_media" USING btree ("review_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_idx" ON "review_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_subject_idx" ON "review_requests" USING btree ("contact_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_requests_contact_idx" ON "review_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_type","subject_id","status");--> statement-breakpoint
CREATE INDEX "reviews_contact_idx" ON "reviews" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "share_targets_path_idx" ON "share_targets" USING btree ("path","locale");--> statement-breakpoint
CREATE INDEX "share_targets_shareable_idx" ON "share_targets" USING btree ("shareable");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_links_ref_idx" ON "shared_links" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "shared_links_target_idx" ON "shared_links" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "shared_links_sharer_idx" ON "shared_links" USING btree ("sharer_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_gbp_reviews_ref_idx" ON "social_gbp_reviews" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "social_gbp_reviews_review_idx" ON "social_gbp_reviews" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "social_gbp_reviews_profile_idx" ON "social_gbp_reviews" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_interactions_ref_idx" ON "social_interactions" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "social_interactions_contact_idx" ON "social_interactions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "social_interactions_package_idx" ON "social_interactions" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_oauth_states_hash_idx" ON "social_oauth_states" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "social_oauth_states_expiry_idx" ON "social_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_package_assets_idx" ON "social_package_assets" USING btree ("package_id","asset_id");--> statement-breakpoint
CREATE INDEX "social_package_assets_asset_idx" ON "social_package_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_packages_source_idx" ON "social_packages" USING btree ("source_provider","source_ref") WHERE source_provider is not null and source_ref is not null;--> statement-breakpoint
CREATE INDEX "social_packages_digest_idx" ON "social_packages" USING btree ("content_digest");--> statement-breakpoint
CREATE INDEX "social_packages_parent_idx" ON "social_packages" USING btree ("parent_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_profile_locations_idx" ON "social_profile_locations" USING btree ("profile_id","location_id");--> statement-breakpoint
CREATE INDEX "social_profile_locations_location_idx" ON "social_profile_locations" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_profiles_provider_idx" ON "social_profiles" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "social_profiles_status_idx" ON "social_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_profiles_assignee_idx" ON "social_profiles" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_ref_idx" ON "social_publications" USING btree ("provider","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_idempotency_idx" ON "social_publications" USING btree ("idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "social_publications_package_idx" ON "social_publications" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "social_publications_scheduled_idx" ON "social_publications" USING btree ("scheduled_at","status");--> statement-breakpoint
CREATE INDEX "social_variants_package_idx" ON "social_variants" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "social_variants_profile_idx" ON "social_variants" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_policies_plan_idx" ON "dunning_policies" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plans_product_idx" ON "plans" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "plans_status_idx" ON "plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id","at");--> statement-breakpoint
CREATE INDEX "subscription_events_kind_idx" ON "subscription_events" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "subscriptions_contact_idx" ON "subscriptions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_dunning_idx" ON "subscriptions" USING btree ("status","dunning_next_at");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_ref_idx" ON "subscriptions" USING btree ("provider","provider_ref") WHERE "subscriptions"."provider_ref" is not null;--> statement-breakpoint
CREATE INDEX "invoice_reminders_due_idx" ON "invoice_reminders" USING btree ("status","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_reminders_unique_idx" ON "invoice_reminders" USING btree ("invoice_id","offset_days");--> statement-breakpoint
CREATE INDEX "invoice_schedules_due_idx" ON "invoice_schedules" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "invoice_schedules_contact_idx" ON "invoice_schedules" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_once_idx" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_pending_idx" ON "broadcast_recipients" USING btree ("broadcast_id","created_at") WHERE "broadcast_recipients"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "broadcast_recipients_contact_idx" ON "broadcast_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_delivery_idx" ON "broadcast_recipients" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "broadcasts_status_idx" ON "broadcasts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "broadcasts_template_idx" ON "broadcasts" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_slug_idx" ON "email_templates" USING btree ("slug") WHERE "email_templates"."slug" is not null;--> statement-breakpoint
CREATE INDEX "email_templates_kind_idx" ON "email_templates" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_booking_idx" ON "time_entries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "time_entries_contact_idx" ON "time_entries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_unbilled_idx" ON "time_entries" USING btree ("billable","started_at") WHERE "time_entries"."invoice_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_timer_idx" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "time_rates_scope_idx" ON "time_rates" USING btree ("scope","scope_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE UNIQUE INDEX "export_definitions_name_idx" ON "export_definitions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "export_definitions_scheduled_idx" ON "export_definitions" USING btree ("scheduled");--> statement-breakpoint
CREATE UNIQUE INDEX "export_run_deliveries_recipient_idx" ON "export_run_deliveries" USING btree ("run_id","attempt","recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "export_run_deliveries_mail_idx" ON "export_run_deliveries" USING btree ("mail_delivery_id") WHERE "export_run_deliveries"."mail_delivery_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "export_run_deliveries_token_idx" ON "export_run_deliveries" USING btree ("token_hash") WHERE "export_run_deliveries"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "export_run_deliveries_run_idx" ON "export_run_deliveries" USING btree ("run_id","attempt");--> statement-breakpoint
CREATE INDEX "export_runs_definition_idx" ON "export_runs" USING btree ("definition_id","started_at");--> statement-breakpoint
CREATE INDEX "export_runs_status_idx" ON "export_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "export_runs_period_idx" ON "export_runs" USING btree ("definition_id","period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_space_contact_idx" ON "community_members" USING btree ("space_id","contact_id");--> statement-breakpoint
CREATE INDEX "community_members_contact_idx" ON "community_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_spaces_slug_idx" ON "community_spaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_registries_slug_idx" ON "gift_registries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "gift_registries_contact_idx" ON "gift_registries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "gift_registry_items_registry_idx" ON "gift_registry_items" USING btree ("registry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_channels_provider_idx" ON "marketplace_channels" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "pod_jobs_status_idx" ON "pod_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "voice_video_artifacts_contact_idx" ON "voice_video_artifacts" USING btree ("contact_id");
--> statement-breakpoint
-- Expand leftover: 0102 copied rows into core tasks and stopped writing
-- here. A reviewed baseline still has to match the chain, so the table
-- stays until a later contract removes the table.
CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "status" text DEFAULT 'todo' NOT NULL,
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "due_on" date,
  "position" integer DEFAULT 0 NOT NULL,
  "done_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_tasks_status" CHECK (
    "status" in ('todo', 'doing', 'blocked', 'done')
  ),
  CONSTRAINT "project_tasks_title" CHECK (char_length("title") between 1 and 300),
  CONSTRAINT "project_tasks_done_has_time" CHECK (
    "status" <> 'done' or "done_at" is not null
  )
);

CREATE INDEX IF NOT EXISTS "project_tasks_project_idx"
  ON "project_tasks" ("project_id", "position");
CREATE INDEX IF NOT EXISTS "project_tasks_assignee_idx"
  ON "project_tasks" ("assignee_user_id", "status");
--> statement-breakpoint
CREATE FUNCTION freeholder_sync_asset_byte_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."byte_size" = 0 THEN
    NEW."byte_size" := NEW."bytes";
  ELSIF TG_OP = 'UPDATE'
    AND NEW."byte_size" IS NOT DISTINCT FROM OLD."byte_size"
    AND NEW."bytes" IS DISTINCT FROM OLD."bytes" THEN
    NEW."byte_size" := NEW."bytes";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "assets_sync_byte_size"
BEFORE INSERT OR UPDATE OF "bytes", "byte_size" ON "assets"
FOR EACH ROW EXECUTE FUNCTION freeholder_sync_asset_byte_size();--> statement-breakpoint
--> statement-breakpoint
-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- `Asset.variants` gained a `watermarked` key (§4.5, C8.04), and its value is
-- an object of format ladders rather than a ladder itself. The legacy-insert
-- inventory trigger walked every top-level value with jsonb_array_elements,
-- so the first watermarked asset inserted outside the service failed with
-- "cannot extract elements from an object".
--
-- The fix is not to special-case one key. The trigger now takes only values
-- that are arrays, and descends into `watermarked` for the marked ladder, so
-- a future non-array key is inert here instead of fatal.
CREATE FUNCTION freeholder_inventory_legacy_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "media_objects" (
    "key", "asset_id", "role", "state", "bytes", "content_type"
  ) VALUES (
    NEW."storage_key", NEW."id", 'original', 'attached', NEW."byte_size", NEW."mime"
  ) ON CONFLICT ("key") DO NOTHING;

  INSERT INTO "media_objects" (
    "key", "asset_id", "role", "state", "bytes", "content_type"
  )
  SELECT
    rendition.value->>'key',
    NEW."id",
    'variant',
    'attached',
    NULLIF(rendition.value->>'bytes', '')::bigint,
    'image/' || ladder.key
  FROM (
    SELECT key, value
    FROM jsonb_each(COALESCE(NEW."variants", '{}'::jsonb))
    WHERE jsonb_typeof(value) = 'array'
    UNION ALL
    SELECT key, value
    FROM jsonb_each(COALESCE(NEW."variants"->'watermarked', '{}'::jsonb))
    WHERE jsonb_typeof(value) = 'array'
  ) ladder
  CROSS JOIN LATERAL jsonb_array_elements(ladder.value) rendition
  WHERE rendition.value ? 'key'
  ON CONFLICT ("key") DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "assets_inventory_legacy_insert"
AFTER INSERT ON "assets"
FOR EACH ROW EXECUTE FUNCTION freeholder_inventory_legacy_asset();--> statement-breakpoint
--> statement-breakpoint
-- Drizzle has no EXCLUDE USING gist expression; §4.4 requires it in the database.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "calendar_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("exclusive" AND "status" IN ('requested', 'confirmed', 'in_progress'));
--> statement-breakpoint
-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Finding a conversation by what was said in it (C7.09).
--
-- A trigram index rather than full text, and deliberately: an owner searching
-- their inbox types a fragment they half remember — "kitch", a partial
-- postcode, the start of a reference — and full-text search matches whole words
-- after stemming, so none of those find anything. Trigrams match the fragment.
-- The same choice `contacts` already made for name and email search.
CREATE INDEX IF NOT EXISTS "messages_body_search_idx"
  ON "messages" USING gin ("body" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_playbooks_due_idx" ON "agent_playbooks" ("next_run_at") WHERE "enabled" AND "trigger" = 'schedule';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_playbooks_briefing_idx" ON "agent_playbooks" ("reports_to_briefing") WHERE "reports_to_briefing";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendars_ics_token_idx" ON "calendars" ("ics_token") WHERE "ics_token" is not null;
--> statement-breakpoint
CREATE INDEX "subscriptions_payment_method_idx" ON "subscriptions" USING btree ("payment_method_id");
--> statement-breakpoint
-- CHECKs the TypeScript schema expresses as enums; the chain enforced them in SQL.
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_tone" CHECK ((tone = ANY (ARRAY['professional'::text, 'friendly'::text, 'brief'::text])));
--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_channel" CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text])));
--> statement-breakpoint
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_status" CHECK ((status = ANY (ARRAY['scheduled'::text, 'sent'::text, 'skipped'::text, 'failed'::text])));
--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_status" CHECK ((status = ANY (ARRAY['waiting'::text, 'offered'::text, 'booked'::text, 'expired'::text, 'withdrawn'::text])));
--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_kind" CHECK ((kind = ANY (ARRAY['waiver'::text, 'agreement'::text])));
--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_status" CHECK ((status = ANY (ARRAY['issued'::text, 'signed'::text, 'declined'::text, 'void'::text])));
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_kind" CHECK ((kind = ANY (ARRAY['waiver'::text, 'agreement'::text])));
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_status" CHECK ((status = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])));
--> statement-breakpoint
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_basis_valid" CHECK ((basis = ANY (ARRAY['paid'::text, 'issued'::text])));
--> statement-breakpoint
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_date_format_valid" CHECK ((date_format = ANY (ARRAY['iso'::text, 'dmy'::text, 'mdy'::text])));
--> statement-breakpoint
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_period_valid" CHECK ((period = ANY (ARRAY['previous_week'::text, 'previous_month'::text, 'previous_quarter'::text])));
--> statement-breakpoint
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_shape_valid" CHECK ((shape = ANY (ARRAY['csv'::text, 'quickbooks'::text, 'xero'::text])));
--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_basis_valid" CHECK ((basis = ANY (ARRAY['paid'::text, 'issued'::text])));
--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_shape_valid" CHECK ((shape = ANY (ARRAY['csv'::text, 'quickbooks'::text, 'xero'::text])));
--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_status_valid" CHECK ((status = ANY (ARRAY['pending'::text, 'built'::text, 'delivered'::text, 'failed'::text])));
--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_trigger_valid" CHECK ((trigger = ANY (ARRAY['schedule'::text, 'manual'::text])));
--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_status" CHECK ((status = ANY (ARRAY['scheduled'::text, 'sent'::text, 'skipped'::text, 'failed'::text])));
--> statement-breakpoint
ALTER TABLE "invoice_schedules" ADD CONSTRAINT "invoice_schedules_cadence" CHECK ((cadence = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])));
--> statement-breakpoint
ALTER TABLE "invoice_schedules" ADD CONSTRAINT "invoice_schedules_status" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text])));
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_lifecycle" CHECK (((lifecycle_stage IS NULL) OR (lifecycle_stage = ANY (ARRAY['lead'::text, 'prospect'::text, 'customer'::text, 'repeat'::text]))));
--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_kind" CHECK ((kind = ANY (ARRAY['lifecycle'::text, 'deal'::text])));
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_role" CHECK ((role = ANY (ARRAY['hero'::text, 'gallery'::text, 'before'::text, 'after'::text, 'process'::text, 'detail'::text, 'document'::text])));
--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_kind" CHECK ((kind = ANY (ARRAY['quote'::text, 'contract'::text, 'booking'::text, 'invoice'::text, 'rental'::text, 'form_submission'::text])));
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status" CHECK ((status = ANY (ARRAY['enquiry'::text, 'quoted'::text, 'active'::text, 'on_hold'::text, 'complete'::text, 'cancelled'::text])));
--> statement-breakpoint
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_author" CHECK ((author = ANY (ARRAY['owner'::text, 'contact'::text])));
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'viewed'::text, 'negotiating'::text, 'accepted'::text, 'declined'::text, 'expired'::text])));
--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_condition" CHECK (((return_condition IS NULL) OR (return_condition = ANY (ARRAY['fine'::text, 'damaged'::text, 'lost'::text]))));
--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_status" CHECK ((status = ANY (ARRAY['reserved'::text, 'out'::text, 'overdue'::text, 'returned'::text, 'closed'::text, 'cancelled'::text])));
--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_unit" CHECK ((unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text])));
--> statement-breakpoint
ALTER TABLE "rental_terms" ADD CONSTRAINT "rental_terms_damage_policy" CHECK ((damage_policy = ANY (ARRAY['deposit_only'::text, 'repair_cost'::text, 'replacement'::text])));
--> statement-breakpoint
ALTER TABLE "rental_terms" ADD CONSTRAINT "rental_terms_unit" CHECK ((unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text])));
--> statement-breakpoint
ALTER TABLE "time_rates" ADD CONSTRAINT "time_rates_scope" CHECK ((scope = ANY (ARRAY['business'::text, 'user'::text, 'project'::text])));
--> statement-breakpoint
-- Catalogue defaults a fresh instance must have; ON CONFLICT keeps restore-safe.
INSERT INTO "roles" ("key", "name", "description", "is_system", "assignable") VALUES
	('owner', 'Owner', 'The business owner. Full access, stored as an ordinary grant.', true, false),
	('administrator', 'Administrator', 'Runs the instance and manages every currently installed area.', true, true),
	('editor', 'Editor', 'Publishes the site, forms, media, translations, and SEO.', true, true),
	('bookkeeper', 'Bookkeeper', 'Reads business, contact, activity, and reporting information.', true, true),
	('service-provider', 'Service provider', 'Works with customers and day-to-day service information.', true, true),
	('customer', 'Customer', 'Uses their own account and customer portal only.', true, true),
	('staff', 'Legacy staff', 'Compatibility role for accounts created before named roles.', true, false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_grants" ("role_key", "module", "access") VALUES
	('owner', '*', 'manage'),
	('administrator', 'admin', 'manage'),
	('administrator', 'agents', 'manage'),
	('administrator', 'analytics', 'manage'),
	('administrator', 'apikeys', 'manage'),
	('administrator', 'cms', 'manage'),
	('administrator', 'connections', 'manage'),
	('administrator', 'contacts', 'manage'),
	('administrator', 'demo', 'manage'),
	('administrator', 'events', 'manage'),
	('administrator', 'forms', 'manage'),
	('administrator', 'i18n', 'manage'),
	('administrator', 'locations', 'manage'),
	('administrator', 'media', 'manage'),
	('administrator', 'platform', 'manage'),
	('administrator', 'roles', 'manage'),
	('administrator', 'seo', 'manage'),
	('administrator', 'settings', 'manage'),
	('administrator', 'webhooks', 'manage'),
	('editor', 'admin', 'view'),
	('editor', 'analytics', 'view'),
	('editor', 'settings', 'view'),
	('editor', 'cms', 'manage'),
	('editor', 'forms', 'manage'),
	('editor', 'i18n', 'manage'),
	('editor', 'media', 'manage'),
	('editor', 'seo', 'manage'),
	('bookkeeper', 'admin', 'view'),
	('bookkeeper', 'analytics', 'view'),
	('bookkeeper', 'contacts', 'view'),
	('bookkeeper', 'events', 'view'),
	('bookkeeper', 'settings', 'view'),
	('service-provider', 'admin', 'view'),
	('service-provider', 'events', 'view'),
	('service-provider', 'forms', 'view'),
	('service-provider', 'locations', 'view'),
	('service-provider', 'media', 'view'),
	('service-provider', 'settings', 'view'),
	('service-provider', 'contacts', 'manage'),
	('staff', 'admin', 'view'),
	('staff', 'agents', 'view'),
	('staff', 'analytics', 'view'),
	('staff', 'apikeys', 'view'),
	('staff', 'cms', 'view'),
	('staff', 'connections', 'view'),
	('staff', 'contacts', 'view'),
	('staff', 'demo', 'view'),
	('staff', 'events', 'view'),
	('staff', 'forms', 'view'),
	('staff', 'i18n', 'view'),
	('staff', 'locations', 'view'),
	('staff', 'media', 'view'),
	('staff', 'platform', 'view'),
	('staff', 'roles', 'view'),
	('staff', 'seo', 'view'),
	('staff', 'settings', 'view'),
	('staff', 'webhooks', 'view')
ON CONFLICT ("role_key", "module") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_grants" ("role_key", "module", "access") VALUES
	('administrator', 'invitations', 'manage'),
	('staff', 'invitations', 'view')
ON CONFLICT ("role_key", "module") DO NOTHING;
--> statement-breakpoint
INSERT INTO "guidance_flows" (
	"key", "version", "title_key", "description_key",
	"audience_roles", "required_capabilities", "steps", "status"
) VALUES
(
	'core.owner-first-win', 1,
	'guidance.flow.owner.title', 'guidance.flow.owner.description',
	ARRAY['owner']::text[], ARRAY['*:manage']::text[],
	$$[
		{"key":"publish-page","titleKey":"guidance.step.publishPage.title","descriptionKey":"guidance.step.publishPage.description","href":"/admin/pages","requiredCapabilities":["cms:manage"],"outcome":{"type":"audit","actions":["cms.publishPage"]}},
		{"key":"capture-enquiry","titleKey":"guidance.step.captureEnquiry.title","descriptionKey":"guidance.step.captureEnquiry.description","href":"/admin/forms","requiredCapabilities":["forms:view"],"outcome":{"type":"form-submission"}},
		{"key":"move-customer-forward","titleKey":"guidance.step.moveCustomer.title","descriptionKey":"guidance.step.moveCustomer.description","href":"/admin/contacts","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.administrator-first-win', 1,
	'guidance.flow.administrator.title', 'guidance.flow.administrator.description',
	ARRAY['administrator']::text[], ARRAY['admin:manage','invitations:manage','platform:view']::text[],
	$$[
		{"key":"invite-collaborator","titleKey":"guidance.step.inviteCollaborator.title","descriptionKey":"guidance.step.inviteCollaborator.description","href":"/admin/invitations","requiredCapabilities":["invitations:manage"],"outcome":{"type":"audit","actions":["invitations.create"]}},
		{"key":"schedule-digest","titleKey":"guidance.step.scheduleDigest.title","descriptionKey":"guidance.step.scheduleDigest.description","href":"/admin/notifications#notification-schedule","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updateSettings"]}}
	]$$::jsonb, 'active'
),
(
	'core.editor-first-win', 1,
	'guidance.flow.editor.title', 'guidance.flow.editor.description',
	ARRAY['editor']::text[], ARRAY['cms:manage']::text[],
	$$[
		{"key":"publish-page","titleKey":"guidance.step.publishPage.title","descriptionKey":"guidance.step.publishPage.description","href":"/admin/pages","requiredCapabilities":["cms:manage"],"outcome":{"type":"audit","actions":["cms.publishPage"]}},
		{"key":"upload-media","titleKey":"guidance.step.uploadMedia.title","descriptionKey":"guidance.step.uploadMedia.description","href":"/admin/media","requiredCapabilities":["media:manage"],"outcome":{"type":"audit","actions":["media.upload","media.completeUpload"]}},
		{"key":"launch-form","titleKey":"guidance.step.launchForm.title","descriptionKey":"guidance.step.launchForm.description","href":"/admin/forms","requiredCapabilities":["forms:manage"],"outcome":{"type":"audit","actions":["forms.create","forms.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.bookkeeper-first-win', 1,
	'guidance.flow.bookkeeper.title', 'guidance.flow.bookkeeper.description',
	ARRAY['bookkeeper']::text[], ARRAY['analytics:view','contacts:view','events:view','settings:view']::text[],
	$$[
		{"key":"choose-alerts","titleKey":"guidance.step.chooseAlerts.title","descriptionKey":"guidance.step.chooseAlerts.description","href":"/admin/notifications#notification-preferences-heading","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updatePreference","notifications.updatePreferences"]}},
		{"key":"schedule-digest","titleKey":"guidance.step.scheduleDigest.title","descriptionKey":"guidance.step.scheduleDigest.description","href":"/admin/notifications#notification-schedule","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updateSettings"]}}
	]$$::jsonb, 'active'
),
(
	'core.service-provider-first-win', 1,
	'guidance.flow.serviceProvider.title', 'guidance.flow.serviceProvider.description',
	ARRAY['service-provider']::text[], ARRAY['contacts:manage']::text[],
	$$[
		{"key":"add-customer","titleKey":"guidance.step.addCustomer.title","descriptionKey":"guidance.step.addCustomer.description","href":"/admin/contacts/new","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.create"]}},
		{"key":"move-customer-forward","titleKey":"guidance.step.moveCustomer.title","descriptionKey":"guidance.step.moveCustomer.description","href":"/admin/contacts","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.customer-first-win', 1,
	'guidance.flow.customer.title', 'guidance.flow.customer.description',
	ARRAY['customer']::text[], ARRAY[]::text[],
	$$[
		{"key":"open-private-account","titleKey":"guidance.step.openPrivateAccount.title","descriptionKey":"guidance.step.openPrivateAccount.description","href":"/portal/privacy","requiredCapabilities":[],"outcome":{"type":"portal-account-linked"}},
		{"key":"choose-contact-preference","titleKey":"guidance.step.chooseContactPreference.title","descriptionKey":"guidance.step.chooseContactPreference.description","href":"/portal/privacy#privacy-preferences","requiredCapabilities":[],"outcome":{"type":"audit","actions":["privacy.setMyMarketingPreference"]}}
	]$$::jsonb, 'active'
)
ON CONFLICT ("key", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "demo_scenarios" (
	"key", "version", "title_key", "description_key", "preset",
	"required_modules", "required_capabilities", "fixture_manifest",
	"default_locale", "supported_locales", "tour_flow_key", "status"
) VALUES (
	'seed.current-modules', 1,
	'demo.scenario.currentModules.title',
	'demo.scenario.currentModules.description',
	'foundation',
	ARRAY['core','cms','forms','seed']::text[],
	ARRAY['demo:manage','cms:view','forms:view']::text[],
	$$[
		{
			"key":"cms.current-modules","version":1,
			"scenarioKeys":["seed.current-modules"],"dependsOn":[],
			"requiredModules":["cms"],"requiredCapabilities":["cms:view"],
			"localeVariants":["en","fr","es"],
			"records":[{"key":"project-page","subjectType":"page"}],
			"expectedOutcomes":[{"key":"cms.current-modules.visible","labelKey":"demo.outcome.pageVisible","targetKey":"core.admin-pages"}],
			"loadService":"cms.loadDemoFixture","purgeService":"cms.purgeDemoFixture","verifyService":"cms.verifyDemoFixture"
		},
		{
			"key":"forms.current-modules","version":1,
			"scenarioKeys":["seed.current-modules"],"dependsOn":[],
			"requiredModules":["forms"],"requiredCapabilities":["forms:view"],
			"localeVariants":["en","fr","es"],
			"records":[{"key":"enquiry-form","subjectType":"form"}],
			"expectedOutcomes":[{"key":"forms.current-modules.visible","labelKey":"demo.outcome.formVisible","targetKey":"core.admin-forms"}],
			"loadService":"forms.loadDemoFixture","purgeService":"forms.purgeDemoFixture","verifyService":"forms.verifyDemoFixture"
		}
	]$$::jsonb,
	'en', ARRAY['en','fr','es']::text[], 'core.owner-first-win', 'active'
)
ON CONFLICT ("key", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "messaging_windows" (
  "id", "code", "name", "scope", "quiet_from", "quiet_to",
  "timezone_source", "applies_to"
) VALUES (
  '00000000-0000-4000-8000-000000000713',
  'recipient-local-quiet-hours',
  'Recipient-local quiet hours',
  'global',
  '21:00',
  '08:00',
  'contact',
  'all'
) ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "messaging_windows" (
  "id", "code", "name", "scope", "max_per_day", "max_per_week",
  "timezone_source", "applies_to"
) VALUES (
  '00000000-0000-4000-8000-000000000714',
  'marketing-frequency-cap',
  'Marketing frequency cap',
  'global',
  3,
  10,
  'contact',
  'marketing'
) ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "update_settings" ("id") VALUES (1);

