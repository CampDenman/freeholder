CREATE TABLE "galleries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'client_delivery' NOT NULL,
	"cover_asset_id" uuid,
	"access" text NOT NULL,
	"secret_hash" text,
	"expires_at" timestamp with time zone,
	"download_policy" text DEFAULT 'none' NOT NULL,
	"download_limit" integer,
	"watermark" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "galleries_title" CHECK (char_length("galleries"."title") between 1 and 160),
	CONSTRAINT "galleries_slug" CHECK ("galleries"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "galleries_kind" CHECK ("galleries"."kind" in ('portfolio', 'client_delivery')),
	CONSTRAINT "galleries_access" CHECK ("galleries"."access" in ('password', 'pin', 'login')),
	CONSTRAINT "galleries_download_policy" CHECK ("galleries"."download_policy" in ('none', 'web_res', 'full_res', 'limit_n')),
	CONSTRAINT "galleries_secret" CHECK (("galleries"."access" = 'login' and "galleries"."secret_hash" is null) or ("galleries"."access" in ('password', 'pin') and "galleries"."secret_hash" is not null)),
	CONSTRAINT "galleries_download_limit" CHECK (("galleries"."download_policy" = 'limit_n' and "galleries"."download_limit" is not null and "galleries"."download_limit" > 0) or ("galleries"."download_policy" <> 'limit_n' and "galleries"."download_limit" is null))
);--> statement-breakpoint

CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "gallery_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"token_hash" text,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_download" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_guests_role" CHECK ("gallery_guests"."role" in ('client', 'partner'))
);--> statement-breakpoint

CREATE TABLE "gallery_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"contact_id" uuid,
	"guest_id" uuid,
	"downloads_used" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "gallery_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"contact_id" uuid,
	"action" text NOT NULL,
	"asset_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_access_logs_action" CHECK ("gallery_access_logs"."action" in ('view', 'download', 'denied'))
);--> statement-breakpoint

ALTER TABLE "galleries" ADD CONSTRAINT "galleries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_guests" ADD CONSTRAINT "gallery_guests_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_sessions" ADD CONSTRAINT "gallery_sessions_guest_id_gallery_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."gallery_guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_access_logs" ADD CONSTRAINT "gallery_access_logs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "galleries_slug_idx" ON "galleries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "galleries_contact_idx" ON "galleries" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_items_unique_idx" ON "gallery_items" USING btree ("gallery_id","asset_id");--> statement-breakpoint
CREATE INDEX "gallery_items_order_idx" ON "gallery_items" USING btree ("gallery_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_guests_person_idx" ON "gallery_guests" USING btree ("gallery_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_guests_token_idx" ON "gallery_guests" USING btree ("token_hash") WHERE "token_hash" is not null;--> statement-breakpoint
CREATE INDEX "gallery_guests_contact_idx" ON "gallery_guests" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_sessions_token_idx" ON "gallery_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "gallery_sessions_gallery_idx" ON "gallery_sessions" USING btree ("gallery_id","expires_at");--> statement-breakpoint
CREATE INDEX "gallery_access_logs_gallery_idx" ON "gallery_access_logs" USING btree ("gallery_id","at");--> statement-breakpoint
CREATE INDEX "gallery_access_logs_contact_idx" ON "gallery_access_logs" USING btree ("contact_id");
