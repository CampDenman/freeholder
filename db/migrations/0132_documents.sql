-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Documents shared with a client, and their history (MASTER.md §4.5, C8.13).
--
-- "A document is revised, not replaced." There is no asset_id on `documents`:
-- the bytes live on a version, the document is the name and the thread, and
-- "which version did they actually sign" stays answerable because nothing here
-- can overwrite an answer. `document_versions` has no updated_at for the same
-- reason — a version that could be edited afterwards answers "what did we send
-- them in March" with whatever somebody typed last, which is worse than not
-- answering.
--
-- "Documents reuse the gallery access vocabulary deliberately": link/password/
-- login, a stated expires_at, an append-only log. One model an owner has to
-- learn once, and one place it can be audited.
--
-- `subject_type` + `subject_id` carry no foreign key, the shape ContentUnlock
-- uses in §4.3. That is what lets a document hang off a project or a quote
-- while the module requires only core.
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
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_contact_idx" ON "documents" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "documents_subject_idx" ON "documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status","updated_at");--> statement-breakpoint

-- `asset_id` is ON DELETE restrict, not cascade. Deleting the file out from
-- under a version somebody was sent would leave a history claiming a delivery
-- that can no longer be produced; the media console has to deal with the
-- document first, which is the correct order.
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
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One row per version number per document. Two clients told about different
-- "version 2" documents is the failure this forecloses, and under concurrent
-- uploads only the index can.
CREATE UNIQUE INDEX "document_versions_number_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","created_at");--> statement-breakpoint

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
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_pinned_version_id_document_versions_id_fk" FOREIGN KEY ("pinned_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_shares_token_idx" ON "document_shares" USING btree ("token_hash") WHERE "document_shares"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "document_shares_document_idx" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_shares_contact_idx" ON "document_shares" USING btree ("contact_id");--> statement-breakpoint

-- Append-only, and contact_id is ON DELETE set null rather than cascade: merge
-- repoints who it was, it does not delete that a view happened. §4.5 — "a
-- document history that vanishes the first time two duplicates are merged is
-- not an audit."
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
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_share_id_document_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."document_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_access_logs_document_idx" ON "document_access_logs" USING btree ("document_id","at");--> statement-breakpoint
CREATE INDEX "document_access_logs_contact_idx" ON "document_access_logs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "document_access_logs_share_idx" ON "document_access_logs" USING btree ("share_id");
