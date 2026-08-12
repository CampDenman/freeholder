ALTER TABLE "notification_digests" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
UPDATE "notifications" AS "notification"
SET "locale" = COALESCE(
	(
		SELECT "contact"."preferred_locale"
		FROM "contacts" AS "contact"
		JOIN "business_profile" AS "business" ON true
		WHERE
			("contact"."id" = "notification"."recipient_contact_id"
				OR "contact"."user_id" = "notification"."recipient_user_id")
			AND "contact"."preferred_locale" = ANY("business"."enabled_locales")
		LIMIT 1
	),
	(SELECT "default_locale" FROM "business_profile" LIMIT 1),
	'en'
);--> statement-breakpoint
UPDATE "sections"
SET
	"blocks" = "blocks" || '[{"id":"header-locales-c1-16","type":"locales","props":{"separator":"·"}}]'::jsonb,
	"updated_at" = now()
WHERE
	"key" = 'header'
	AND NOT jsonb_path_exists("blocks", '$.** ? (@.type == "locales")');
