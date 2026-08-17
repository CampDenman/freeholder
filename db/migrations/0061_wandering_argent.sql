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
ALTER TABLE "media_capture_chunks" ADD CONSTRAINT "media_capture_chunks_session_id_media_capture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."media_capture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_chunks_session_seq_idx" ON "media_capture_chunks" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "media_capture_chunks_session_idx" ON "media_capture_chunks" USING btree ("session_id");