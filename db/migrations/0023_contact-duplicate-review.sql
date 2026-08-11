CREATE TABLE "contact_merge_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"surviving_contact_id" uuid NOT NULL,
	"duplicate_contact_id" uuid NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"duplicate_before" jsonb NOT NULL,
	"survivor_after" jsonb NOT NULL,
	"reference_state" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"undoable" boolean DEFAULT true NOT NULL,
	"undo_blockers" text[] DEFAULT '{}' NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_a_id" uuid,
	"contact_b_id" uuid,
	"contact_a_name" text NOT NULL,
	"contact_a_email" text,
	"contact_b_name" text NOT NULL,
	"contact_b_email" text,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_merge_operations" ADD CONSTRAINT "contact_merge_operations_candidate_id_merge_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."merge_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_contact_a_id_contacts_id_fk" FOREIGN KEY ("contact_a_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_contact_b_id_contacts_id_fk" FOREIGN KEY ("contact_b_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_merge_operations_candidate_idx" ON "contact_merge_operations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "contact_merge_operations_survivor_idx" ON "contact_merge_operations" USING btree ("surviving_contact_id","merged_at");--> statement-breakpoint
CREATE INDEX "contact_merge_operations_merged_at_idx" ON "contact_merge_operations" USING btree ("merged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_candidates_pair_idx" ON "merge_candidates" USING btree ("contact_a_id","contact_b_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_a_idx" ON "merge_candidates" USING btree ("contact_a_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_b_idx" ON "merge_candidates" USING btree ("contact_b_id");--> statement-breakpoint
CREATE INDEX "merge_candidates_status_score_idx" ON "merge_candidates" USING btree ("status","score");--> statement-breakpoint
CREATE INDEX "contacts_normalized_name_idx" ON "contacts" USING btree (regexp_replace(lower(trim("name")), '[[:space:]]+', ' ', 'g'));--> statement-breakpoint
CREATE INDEX "contacts_normalized_phone_idx" ON "contacts" USING btree ((case
        when regexp_replace("phone", '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
          then substring(regexp_replace("phone", '[^0-9]', '', 'g') from 2)
        else regexp_replace("phone", '[^0-9]', '', 'g')
      end));