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
ALTER TABLE "design_settings" ADD CONSTRAINT "design_settings_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;