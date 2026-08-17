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
	"upload_id" uuid,
	"asset_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_capture_sessions_source_valid" CHECK ("media_capture_sessions"."source" in ('camera','microphone','screen','share_sheet','camera_roll','upload_link','import','social')),
	CONSTRAINT "media_capture_sessions_status_valid" CHECK ("media_capture_sessions"."status" in ('pending','live','preview','confirmed','discarded','expired')),
	CONSTRAINT "media_capture_sessions_trim_start_nonneg" CHECK ("media_capture_sessions"."trim_start_ms" >= 0),
	CONSTRAINT "media_capture_sessions_trim_window" CHECK ("media_capture_sessions"."trim_end_ms" is null or "media_capture_sessions"."trim_end_ms" >= "media_capture_sessions"."trim_start_ms")
);
--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_sessions_token_idx" ON "media_capture_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "media_capture_sessions_status_expiry_idx" ON "media_capture_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "media_capture_sessions_created_by_idx" ON "media_capture_sessions" USING btree ("created_by","created_at");