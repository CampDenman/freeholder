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
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_session_id_media_capture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."media_capture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_capture_items" ADD CONSTRAINT "media_capture_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_capture_items_session_idx" ON "media_capture_items" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_items_staged_key_idx" ON "media_capture_items" USING btree ("staged_key");