-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Packaged gallery delivery (MASTER.md §4.5, C8.07).
--
-- One row per gallery, replaced when rebuilt: a client wants "the download",
-- not every version the owner ever produced. What was agreed is kept by
-- gallery_rounds; this is only the bytes.
--
-- Built by a job rather than in the request, because a wedding gallery is
-- gigabytes and the client asking for it must not hold an HTTP connection
-- open while it is assembled.
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
ALTER TABLE "gallery_archives" ADD CONSTRAINT "gallery_archives_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_archives_gallery_idx" ON "gallery_archives" USING btree ("gallery_id");
