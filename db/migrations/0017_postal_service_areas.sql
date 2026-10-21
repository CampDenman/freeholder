-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C6.18: a service area that can actually be checked (MASTER.md 4.18).
--
-- `radius` and `regions` describe coverage to a reader; neither can answer
-- "do you come to L4C 2K1?" without a geocoder or a gazetteer, and guessing is
-- the invented coverage 4.18 forbids. So a third kind: the postal codes the
-- owner actually named, which is checkable exactly and wrong never.
--
-- The other two kinds are not removed and not downgraded. An owner who has
-- described a radius has told the truth about where they work; the coverage
-- check simply answers "cannot confirm" for that shape rather than pretending.
ALTER TABLE "service_areas" ADD COLUMN "postal_codes" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_areas" DROP CONSTRAINT "service_areas_shape";
--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_shape" CHECK (case "service_areas"."kind"
        when 'radius' then "service_areas"."center_latitude" is not null and "service_areas"."center_longitude" is not null and "service_areas"."radius_km" is not null
        when 'regions' then array_length("service_areas"."regions", 1) is not null
        when 'postal_codes' then array_length("service_areas"."postal_codes", 1) is not null
        else false
      end);
