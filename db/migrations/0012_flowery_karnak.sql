CREATE TABLE "business_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"schema_type" text,
	"street" text,
	"unit" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"phone" text,
	"email" text,
	"google_business_profile_url" text,
	"same_as" text[] DEFAULT '{}' NOT NULL,
	"price_range" text,
	"timezone" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_locations_country_alpha2" CHECK ("business_locations"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "business_locations_latitude" CHECK ("business_locations"."latitude" is null or "business_locations"."latitude" between -90 and 90),
	CONSTRAINT "business_locations_longitude" CHECK ("business_locations"."longitude" is null or "business_locations"."longitude" between -180 and 180),
	CONSTRAINT "business_locations_geo_pair" CHECK (("business_locations"."latitude" is null) = ("business_locations"."longitude" is null))
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"weekday" smallint,
	"on_date" date,
	"opens" time,
	"closes" time,
	"closed" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_hours_weekly_or_dated" CHECK (("opening_hours"."weekday" is null) != ("opening_hours"."on_date" is null)),
	CONSTRAINT "opening_hours_weekday_range" CHECK ("opening_hours"."weekday" is null or "opening_hours"."weekday" between 0 and 6),
	CONSTRAINT "opening_hours_times_present" CHECK (case when "opening_hours"."closed" then "opening_hours"."opens" is null and "opening_hours"."closes" is null
           else "opening_hours"."opens" is not null and "opening_hours"."closes" is not null end)
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"center_latitude" numeric(9, 6),
	"center_longitude" numeric(9, 6),
	"radius_km" numeric(8, 2),
	"regions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_shape" CHECK (case "service_areas"."kind"
            when 'radius' then "service_areas"."center_latitude" is not null and "service_areas"."center_longitude" is not null and "service_areas"."radius_km" is not null
            when 'regions' then array_length("service_areas"."regions", 1) is not null
            else false
          end)
);
--> statement-breakpoint
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_location_id_business_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_locations_slug" ON "business_locations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "business_locations_one_primary" ON "business_locations" USING btree ("is_primary") WHERE "business_locations"."is_primary";--> statement-breakpoint
CREATE INDEX "opening_hours_location" ON "opening_hours" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_location" ON "service_areas" USING btree ("location_id");