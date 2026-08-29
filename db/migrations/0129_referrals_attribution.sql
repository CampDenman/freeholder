-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Referral programmes, codes, touches and invitations
-- (MASTER.md §4.3, §4.13, C9.09).
--
-- Nothing here stores a winner. §4.13: "AttributionTouch keeps the whole chain
-- regardless, so changing the model does not require re-running history — it
-- re-reads it." The touches are the record, the model is a column on the
-- programme, and who earned the credit is computed at read time.
--
-- And structurally: "One hop only … Multi-level structures are refused by the
-- data model, not by policy — there is no parent link on AffiliateCode — and
-- that is deliberate." There is no parent column below, and the test suite
-- asserts its absence so a later well-meaning change has to argue with a test.
CREATE TABLE "affiliate_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"conversion_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_discount" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commission" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cookie_window_days" integer DEFAULT 30 NOT NULL,
	"attribution_model" text DEFAULT 'last_touch' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_programs_status_idx" ON "affiliate_programs" USING btree ("status");--> statement-breakpoint

CREATE TABLE "affiliate_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"code" text NOT NULL,
	"landing_path" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_codes" ADD CONSTRAINT "affiliate_codes_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The referrer is "a Contact like everyone else" (§4.3), which is the spine
-- rule applied to somebody who happens to also send business.
ALTER TABLE "affiliate_codes" ADD CONSTRAINT "affiliate_codes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One code string, globally. A code is typed at a checkout by somebody reading
-- it off a card, and two meanings for one word is not a conflict anybody can
-- resolve at that moment.
CREATE UNIQUE INDEX "affiliate_codes_code_idx" ON "affiliate_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliate_codes_program_idx" ON "affiliate_codes" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "affiliate_codes_contact_idx" ON "affiliate_codes" USING btree ("contact_id");--> statement-breakpoint

-- One table for every way a code reaches somebody (§4.13): "A code on a
-- session, a scanned QR at a market stall, a code typed at checkout, and an
-- invitation accepted by link all land in the same table." Four tables would
-- be four answers to "where did this customer come from".
CREATE TABLE "attribution_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_id" text,
	"contact_id" uuid,
	"code_id" uuid NOT NULL,
	"kind" text DEFAULT 'click' NOT NULL,
	"landing_path" text,
	"referrer_url" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Nullable: the touch usually happens before we know who they are, and that
-- is exactly what "attribution survives the cookie" means.
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_touches_contact_idx" ON "attribution_touches" USING btree ("contact_id","at");--> statement-breakpoint
CREATE INDEX "attribution_touches_anon_idx" ON "attribution_touches" USING btree ("anon_id","at");--> statement-breakpoint
CREATE INDEX "attribution_touches_code_idx" ON "attribution_touches" USING btree ("code_id");--> statement-breakpoint

CREATE TABLE "referral_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_contact_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"channel" text DEFAULT 'link' NOT NULL,
	"invitee_email" text,
	"invitee_phone" text,
	"token_hash" text NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"reward_state" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_referrer_contact_id_contacts_id_fk" FOREIGN KEY ("referrer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_program_id_affiliate_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."affiliate_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_invitations" ADD CONSTRAINT "referral_invitations_code_id_affiliate_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."affiliate_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Only the hash is stored; the token is returned once, when the invitation is
-- created. The same rule gallery guests and quote links follow.
CREATE UNIQUE INDEX "referral_invitations_token_idx" ON "referral_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "referral_invitations_referrer_idx" ON "referral_invitations" USING btree ("referrer_contact_id");--> statement-breakpoint
CREATE INDEX "referral_invitations_program_idx" ON "referral_invitations" USING btree ("program_id");
