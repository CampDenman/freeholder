ALTER TABLE "media_capture_sessions" ADD COLUMN "focal_x" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD COLUMN "focal_y" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD COLUMN "staged_key" text;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD COLUMN "staged_bytes" bigint;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD COLUMN "staged_mime" text;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD COLUMN "staged_filename" text;--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_focal_x_range" CHECK ("media_capture_sessions"."focal_x" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "media_capture_sessions" ADD CONSTRAINT "media_capture_sessions_focal_y_range" CHECK ("media_capture_sessions"."focal_y" between 0 and 10000);