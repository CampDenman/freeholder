-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Finding a conversation by what was said in it (C7.09).
--
-- A trigram index rather than full text, and deliberately: an owner searching
-- their inbox types a fragment they half remember — "kitch", a partial
-- postcode, the start of a reference — and full-text search matches whole words
-- after stemming, so none of those find anything. Trigrams match the fragment.
-- The same choice `contacts` already made for name and email search.
CREATE INDEX IF NOT EXISTS "messages_body_search_idx"
  ON "messages" USING gin ("body" gin_trgm_ops);
