CREATE TABLE "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_id" uuid,
	"block_id" text,
	"parent_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text DEFAULT 'comment' NOT NULL,
	"reviewer" text,
	"review_state" text DEFAULT 'none' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"editing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "content_comments_page_idx" ON "content_comments" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "content_comments_parent_idx" ON "content_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "content_comments_review_idx" ON "content_comments" USING btree ("page_id","review_state");--> statement-breakpoint
CREATE UNIQUE INDEX "content_presence_page_actor_idx" ON "content_presence" USING btree ("page_id","actor");--> statement-breakpoint
CREATE INDEX "content_presence_page_seen_idx" ON "content_presence" USING btree ("page_id","last_seen_at");