-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C2.29: public moderated reader comments, distinct from editorial annotations.
ALTER TABLE blog_settings ADD COLUMN comments_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE blog_reader_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES blog_reader_comments(id) ON DELETE SET NULL,
 contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 author_name text NOT NULL,
 body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CONSTRAINT blog_reader_comments_status_allowed CHECK(status IN ('pending','approved','spam','trash')),
 source text NOT NULL DEFAULT 'reader',
 external_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX blog_reader_comments_page_status_idx ON blog_reader_comments(page_id,status,created_at);
--> statement-breakpoint
CREATE INDEX blog_reader_comments_contact_idx ON blog_reader_comments(contact_id);
--> statement-breakpoint
CREATE UNIQUE INDEX blog_reader_comments_source_external_idx ON blog_reader_comments(source,external_id) WHERE external_id IS NOT NULL;
