CREATE TABLE "csp_violations" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"document_path" text NOT NULL,
	"effective_directive" text NOT NULL,
	"blocked_source" text NOT NULL,
	"source_path" text,
	"disposition" text DEFAULT 'enforce' NOT NULL,
	"status_code" integer,
	"line_number" integer,
	"column_number" integer,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	CONSTRAINT "csp_violations_occurrences_positive" CHECK ("csp_violations"."occurrences" > 0),
	CONSTRAINT "csp_violations_disposition_valid" CHECK ("csp_violations"."disposition" in ('enforce', 'report'))
);
--> statement-breakpoint
CREATE INDEX "csp_violations_last_at_idx" ON "csp_violations" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "csp_violations_expires_at_idx" ON "csp_violations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "csp_violations_directive_idx" ON "csp_violations" USING btree ("effective_directive","last_at");