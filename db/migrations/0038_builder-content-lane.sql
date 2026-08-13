CREATE TABLE "builder_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief" text NOT NULL,
	"lane" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"base_snapshot" jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"apply_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_by_actor" text NOT NULL,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "builder_proposals_status_idx" ON "builder_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "builder_proposals_created_idx" ON "builder_proposals" USING btree ("created_at");