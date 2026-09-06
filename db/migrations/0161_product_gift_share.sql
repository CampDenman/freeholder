-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- Gift-card and registry-style product sharing (MASTER.md §34, C9.35).
--
-- A wishlist becomes a public registry through a hashed token, not a contact
-- id in the URL. A gift card is sent as a claim link; the bearer code is not
-- the address.
ALTER TABLE "wishlists" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_share_token_idx" ON "wishlists" USING btree ("share_token_hash") WHERE "share_token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_share_token_idx" ON "gift_cards" USING btree ("share_token_hash") WHERE "share_token_hash" is not null;
