CREATE TABLE "customer_magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_magic_links" ADD CONSTRAINT "customer_magic_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_magic_links_token_idx" ON "customer_magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_magic_links_contact_expiry_idx" ON "customer_magic_links" USING btree ("contact_id","expires_at");