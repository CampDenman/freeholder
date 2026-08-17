CREATE TABLE "cart_coupons" (
	"cart_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"coupon_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"cart_id" uuid,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_discount" CHECK ("coupon_redemptions"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_off_ppm" integer,
	"amount_minor" bigint,
	"currency" text,
	"min_subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"max_redemptions" integer,
	"per_contact_limit" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"recovery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_valid" CHECK ("coupons"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
	CONSTRAINT "coupons_kind_valid" CHECK ("coupons"."kind" in ('percent','fixed','free_shipping')),
	CONSTRAINT "coupons_percent" CHECK ("coupons"."percent_off_ppm" is null or ("coupons"."percent_off_ppm" > 0 and "coupons"."percent_off_ppm" <= 1000000)),
	CONSTRAINT "coupons_amount" CHECK ("coupons"."amount_minor" is null or "coupons"."amount_minor" > 0),
	CONSTRAINT "coupons_currency" CHECK ("coupons"."currency" is null or "coupons"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "coupons_min" CHECK ("coupons"."min_subtotal_minor" >= 0),
	CONSTRAINT "coupons_limits" CHECK (("coupons"."max_redemptions" is null or "coupons"."max_redemptions" > 0) and "coupons"."per_contact_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_card_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_redemptions_amount" CHECK ("gift_card_redemptions"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"currency" text NOT NULL,
	"issued_minor" bigint NOT NULL,
	"remaining_minor" bigint NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_valid" CHECK ("gift_cards"."code" ~ '^[A-Z0-9][A-Z0-9-]{7,31}$'),
	CONSTRAINT "gift_cards_currency" CHECK ("gift_cards"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gift_cards_status_valid" CHECK ("gift_cards"."status" in ('active','redeemed','void')),
	CONSTRAINT "gift_cards_amounts" CHECK ("gift_cards"."issued_minor" > 0 and "gift_cards"."remaining_minor" >= 0 and "gift_cards"."remaining_minor" <= "gift_cards"."issued_minor")
);
--> statement-breakpoint
CREATE TABLE "offer_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"trigger_variant_id" uuid,
	"offer_variant_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_rules_kind_valid" CHECK ("offer_rules"."kind" in ('bump','post_add')),
	CONSTRAINT "offer_rules_name_valid" CHECK (char_length("offer_rules"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_totals";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "cart_coupons" ADD CONSTRAINT "cart_coupons_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_coupons" ADD CONSTRAINT "cart_coupons_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recoveries" ADD CONSTRAINT "cart_recoveries_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recoveries" ADD CONSTRAINT "cart_recoveries_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_rules" ADD CONSTRAINT "offer_rules_trigger_variant_id_product_variants_id_fk" FOREIGN KEY ("trigger_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_rules" ADD CONSTRAINT "offer_rules_offer_variant_id_product_variants_id_fk" FOREIGN KEY ("offer_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_coupons_pk" ON "cart_coupons" USING btree ("cart_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_recoveries_cart_idx" ON "cart_recoveries" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id","created_at");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_contact_idx" ON "coupon_redemptions" USING btree ("contact_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "gift_card_redemptions_card_idx" ON "gift_card_redemptions" USING btree ("gift_card_id");--> statement-breakpoint
CREATE INDEX "gift_card_redemptions_contact_idx" ON "gift_card_redemptions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_code_idx" ON "gift_cards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "gift_cards_contact_idx" ON "gift_cards" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "offer_rules_kind_idx" ON "offer_rules" USING btree ("kind","active");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals" CHECK ("orders"."subtotal_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."shipping_minor" >= 0 and "orders"."tax_minor" >= 0 and "orders"."total_minor" >= 0);