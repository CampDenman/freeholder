CREATE TABLE "role_grants" (
	"role_key" text NOT NULL,
	"module" text NOT NULL,
	"access" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_role_module_pk" PRIMARY KEY("role_key","module")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"assignable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Defaults are data, not branches in the permission engine. Owners may tune
-- these grants after migration; ON CONFLICT preserves any restored catalogue.
INSERT INTO "roles" ("key", "name", "description", "is_system", "assignable") VALUES
	('owner', 'Owner', 'The business owner. Full access, stored as an ordinary grant.', true, false),
	('administrator', 'Administrator', 'Runs the instance and manages every currently installed area.', true, true),
	('editor', 'Editor', 'Publishes the site, forms, media, translations, and SEO.', true, true),
	('bookkeeper', 'Bookkeeper', 'Reads business, contact, activity, and reporting information.', true, true),
	('service-provider', 'Service provider', 'Works with customers and day-to-day service information.', true, true),
	('customer', 'Customer', 'Uses their own account and customer portal only.', true, true),
	('staff', 'Legacy staff', 'Compatibility role for accounts created before named roles.', true, false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- The old column was text despite its TypeScript enum. Preserve an unusual
-- pre-existing value as a non-assignable role so adding the FK never strands
-- a legitimate restored database.
INSERT INTO "roles" ("key", "name", "description", "is_system", "assignable")
SELECT DISTINCT "role", "role", 'Imported from the legacy role column.', false, false
FROM "users"
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_grants" ("role_key", "module", "access") VALUES
	('owner', '*', 'manage'),
	('administrator', 'admin', 'manage'),
	('administrator', 'agents', 'manage'),
	('administrator', 'analytics', 'manage'),
	('administrator', 'apikeys', 'manage'),
	('administrator', 'cms', 'manage'),
	('administrator', 'connections', 'manage'),
	('administrator', 'contacts', 'manage'),
	('administrator', 'demo', 'manage'),
	('administrator', 'events', 'manage'),
	('administrator', 'forms', 'manage'),
	('administrator', 'i18n', 'manage'),
	('administrator', 'locations', 'manage'),
	('administrator', 'media', 'manage'),
	('administrator', 'platform', 'manage'),
	('administrator', 'roles', 'manage'),
	('administrator', 'seo', 'manage'),
	('administrator', 'settings', 'manage'),
	('administrator', 'webhooks', 'manage'),
	('editor', 'admin', 'view'),
	('editor', 'analytics', 'view'),
	('editor', 'settings', 'view'),
	('editor', 'cms', 'manage'),
	('editor', 'forms', 'manage'),
	('editor', 'i18n', 'manage'),
	('editor', 'media', 'manage'),
	('editor', 'seo', 'manage'),
	('bookkeeper', 'admin', 'view'),
	('bookkeeper', 'analytics', 'view'),
	('bookkeeper', 'contacts', 'view'),
	('bookkeeper', 'events', 'view'),
	('bookkeeper', 'settings', 'view'),
	('service-provider', 'admin', 'view'),
	('service-provider', 'events', 'view'),
	('service-provider', 'forms', 'view'),
	('service-provider', 'locations', 'view'),
	('service-provider', 'media', 'view'),
	('service-provider', 'settings', 'view'),
	('service-provider', 'contacts', 'manage'),
	('staff', 'admin', 'view'),
	('staff', 'agents', 'view'),
	('staff', 'analytics', 'view'),
	('staff', 'apikeys', 'view'),
	('staff', 'cms', 'view'),
	('staff', 'connections', 'view'),
	('staff', 'contacts', 'view'),
	('staff', 'demo', 'view'),
	('staff', 'events', 'view'),
	('staff', 'forms', 'view'),
	('staff', 'i18n', 'view'),
	('staff', 'locations', 'view'),
	('staff', 'media', 'view'),
	('staff', 'platform', 'view'),
	('staff', 'roles', 'view'),
	('staff', 'seo', 'view'),
	('staff', 'settings', 'view'),
	('staff', 'webhooks', 'view')
ON CONFLICT ("role_key", "module") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_grants_module_idx" ON "role_grants" USING btree ("module");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;
