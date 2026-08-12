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
ALTER TABLE "assets" ADD COLUMN "byte_size" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scan_status" text DEFAULT 'not_configured' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scan_engine" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scan_message" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "checksum_sha256" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "focal_x" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "focal_y" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
UPDATE "assets" SET "byte_size" = "bytes";--> statement-breakpoint
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
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "assets"
SET "source" = 'migration',
    "provenance" = jsonb_build_object(
      'source', 'migration',
      'migratedAt', now()
    )
WHERE "provenance" = '{}'::jsonb;--> statement-breakpoint
INSERT INTO "media_objects" (
  "key", "asset_id", "role", "state", "bytes", "content_type"
)
SELECT "storage_key", "id", 'original', 'attached', "byte_size", "mime"
FROM "assets"
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "media_objects" (
  "key", "asset_id", "role", "state", "bytes", "content_type"
)
SELECT
  rendition.value->>'key',
  asset."id",
  'variant',
  'attached',
  NULLIF(rendition.value->>'bytes', '')::bigint,
  'image/' || variants.key
FROM "assets" asset
CROSS JOIN LATERAL jsonb_each(asset."variants") variants
CROSS JOIN LATERAL jsonb_array_elements(variants.value) rendition
WHERE rendition.value ? 'key'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
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
    'image/' || variants.key
  FROM jsonb_each(COALESCE(NEW."variants", '{}'::jsonb)) variants
  CROSS JOIN LATERAL jsonb_array_elements(variants.value) rendition
  WHERE rendition.value ? 'key'
  ON CONFLICT ("key") DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "assets_inventory_legacy_insert"
AFTER INSERT ON "assets"
FOR EACH ROW EXECUTE FUNCTION freeholder_inventory_legacy_asset();--> statement-breakpoint
CREATE INDEX "media_objects_asset_idx" ON "media_objects" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "media_objects_pending_idx" ON "media_objects" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "media_objects_upload_idx" ON "media_objects" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_uploads_storage_key_unique" ON "media_uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_uploads_state_expiry_idx" ON "media_uploads" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "media_uploads_asset_idx" ON "media_uploads" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_key_unique" ON "assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "assets_status_created_at_idx" ON "assets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assets_purge_after_idx" ON "assets" USING btree ("purge_after");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_bytes_nonnegative" CHECK ("assets"."byte_size" >= 0);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_legacy_bytes_nonnegative" CHECK ("assets"."bytes" >= 0);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_focal_x_range" CHECK ("assets"."focal_x" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_focal_y_range" CHECK ("assets"."focal_y" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_trash_dates_consistent" CHECK (("assets"."status" = 'trashed' and "assets"."deleted_at" is not null and "assets"."purge_after" is not null) or ("assets"."status" <> 'trashed' and "assets"."deleted_at" is null and "assets"."purge_after" is null));
