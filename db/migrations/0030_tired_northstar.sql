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
ALTER TABLE "media_alt_text_suggestions" ADD CONSTRAINT "media_alt_text_suggestions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_alt_text_asset_created_idx" ON "media_alt_text_suggestions" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_alt_text_one_ready_per_asset" ON "media_alt_text_suggestions" USING btree ("asset_id") WHERE "media_alt_text_suggestions"."status" = 'ready';
