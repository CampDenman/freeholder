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
ALTER TABLE "contribution_assets" ADD CONSTRAINT "contribution_assets_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_assets" ADD CONSTRAINT "contribution_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_assets_unique_idx" ON "contribution_assets" USING btree ("contribution_id","asset_id");--> statement-breakpoint
CREATE INDEX "contribution_assets_contribution_idx" ON "contribution_assets" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_events_contribution_idx" ON "contribution_events" USING btree ("contribution_id","created_at");--> statement-breakpoint
CREATE INDEX "contributions_contact_idx" ON "contributions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contributions_status_idx" ON "contributions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contributions_kind_idx" ON "contributions" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "contributions_hash_idx" ON "contributions" USING btree ("content_hash");