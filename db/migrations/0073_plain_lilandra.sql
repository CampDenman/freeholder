CREATE TABLE "proof_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "proof_notices_slug_idx" ON "proof_notices" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "proof_notices_published_idx" ON "proof_notices" USING btree ("published");