CREATE TABLE "job_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"job_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_idempotency_keys_key_not_blank" CHECK (length(trim("job_idempotency_keys"."idempotency_key")) > 0),
	CONSTRAINT "job_idempotency_keys_payload_hash_length" CHECK (length("job_idempotency_keys"."payload_hash") = 64),
	CONSTRAINT "job_idempotency_keys_expiry_after_creation" CHECK ("job_idempotency_keys"."expires_at" > "job_idempotency_keys"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_keys_name_key_idx" ON "job_idempotency_keys" USING btree ("job_name","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_keys_job_id_idx" ON "job_idempotency_keys" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_idempotency_keys_expiry_idx" ON "job_idempotency_keys" USING btree ("expires_at");