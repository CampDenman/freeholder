-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C6.18: the weekly window when a service area receives deliveries.
--
-- The coverage check can now answer not only "do we come there" but "when".
-- All three columns are nullable and travel together: null means the owner
-- named no window, and the check constraint refuses a half-window (days
-- without times, times without days, closes before opens) because a window
-- that is half stated is worse than none — a reader will guess the missing
-- half. Weekdays follow opening_hours.weekday: 0 = Sunday.
ALTER TABLE "service_areas" ADD COLUMN "delivery_weekdays" smallint[];
--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "delivery_opens" time;
--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "delivery_closes" time;
--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_delivery_window" CHECK (("service_areas"."delivery_weekdays" is null and "service_areas"."delivery_opens" is null and "service_areas"."delivery_closes" is null) or ("service_areas"."delivery_weekdays" is not null and array_length("service_areas"."delivery_weekdays", 1) is not null and "service_areas"."delivery_opens" is not null and "service_areas"."delivery_closes" is not null and "service_areas"."delivery_opens" < "service_areas"."delivery_closes" and 0 <= all("service_areas"."delivery_weekdays") and 6 >= all("service_areas"."delivery_weekdays")));
