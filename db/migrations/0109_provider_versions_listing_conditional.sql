-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C3.47/C11.08: require a provider versions listing only where the bucket keeps versions.
--
-- Both inventory-completeness guards derived one set of listings and used it for
-- two different questions: which listings MUST be complete, and which pages are
-- allowed to exist at all. That made a versions listing mandatory on every
-- provider, so an S3-compatible store which simply does not retain versions
-- could never satisfy a recorded media write -- it is refused before any object
-- moves. Freeholder supports S3-compatible storage generally, not one vendor's,
-- so the demand is wrong.
--
-- The two questions are now separate CTEs:
--
--   admissible  every listing this binding can produce. Unchanged, and still
--               the ceiling: a page of any other kind remains a conflict.
--   required    admissible, minus `versions` where the inventory's own
--               configuration page for that pass reports versioning neither
--               Enabled nor Suspended.
--
-- Suspended counts because a suspended bucket still holds the versions it took
-- while enabled. A missing or unreadable configuration answer does NOT count:
-- the listing is required only on positive evidence that versions can exist.
--
-- Keeping `admissible` as the ceiling is what makes this change safe on a live
-- instance. Inventories captured before it hold versions pages on buckets that
-- report no versioning, because the old code demanded them; had the ceiling
-- become conditional too, every one of those would have turned from complete
-- into a conflict on upgrade. They stay valid, and new captures may omit the
-- listing. src/core/media/transfer-inventory.ts holds the same split
-- (admissibleKinds vs kinds) and the two MUST agree: a listing skipped by the
-- capture but demanded here reads as "inventory is still truncated".
DO $migration$
DECLARE item record; source_body text; successor_body text;
 listing_needle text:=$needle$ ), required AS (
  SELECT pass_number,kind FROM header CROSS JOIN generate_series(0,1) passes(pass_number) CROSS JOIN LATERAL unnest(CASE WHEN header.binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
 )$needle$;
 listing_replacement text:=$replacement$ ), admissible AS (
  SELECT pass_number,kind FROM header CROSS JOIN generate_series(0,1) passes(pass_number) CROSS JOIN LATERAL unnest(CASE WHEN header.binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
 ), required AS (
  SELECT admissible.pass_number,admissible.kind FROM admissible WHERE admissible.kind<>'versions' OR EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages policy_page WHERE policy_page.inventory_id=original_inventory AND policy_page.pass=admissible.pass_number AND policy_page.kind='configuration' AND policy_page.configuration->>'versioning' IN ('Enabled','Suspended'))
 )$replacement$;
 ceiling_needle text:=$needle$OR NOT EXISTS(SELECT 1 FROM required WHERE required.pass_number=page.pass AND required.kind=page.kind)$needle$;
 ceiling_replacement text:=$replacement$OR NOT EXISTS(SELECT 1 FROM admissible WHERE admissible.pass_number=page.pass AND admissible.kind=page.kind)$replacement$;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('freeholder_media_original_absence_inventory_complete(uuid)','freeholder_media_original_absence_inventory_complete(original_inventory uuid)','6f3d4eab6f7d919d7cbe5a0d1aa7ac2887c6186b123dc7a5dbd164e4c259f9d8','098ca7a125185dc591c0e5fd25f2a7a0376168e4f0ca8e5f8eb159b0edb02873'),
  ('freeholder_media_original_positive_inventory_complete(uuid)','freeholder_media_original_positive_inventory_complete(original_inventory uuid)','58685505f5612255a16c1761aafd43bf8edaff77892447d312d067ca8bb40fcd','881cf8aec77e3bf6d23695d961dbbdeed3b55cdd4fdd82778d76c178fb931e72')
 ) AS specifications(signature,declaration,predecessor,successor)
 LOOP
  SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure(item.signature);
  IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>item.predecessor THEN
   RAISE EXCEPTION 'Unexpected provider inventory completeness predecessor: %',item.signature USING ERRCODE='23514';
  END IF;
  successor_body:=replace(replace(source_body,listing_needle,listing_replacement),ceiling_needle,ceiling_replacement);
  IF successor_body=source_body OR position(listing_needle in successor_body)<>0 OR position(ceiling_needle in successor_body)<>0
   OR position($floor$FROM required WHERE NOT EXISTS$floor$ in successor_body)=0
   OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>item.successor THEN
   RAISE EXCEPTION 'Conditional provider versions listing composition failed: %',item.signature USING ERRCODE='23514';
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %s RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',item.declaration,successor_body);
 END LOOP;
END $migration$;
--> statement-breakpoint
-- The same rule for the applied-review authority, which demands a complete page
-- chain per listing before an affirmative PUT review may close. It carries no
-- ceiling clause -- its only use of `required` is the floor -- so the set is
-- filtered in place rather than split in two. Its neighbouring count check is
-- over `configuration` pages alone (exactly two, one per pass) and is unaffected.
--
-- `freeholder_media_multipart_*` hold the same array in four further shapes and
-- are deliberately NOT changed here. Multipart capture builds its own listing
-- set, so those guards still agree with it; measured 2026-11-18, the multipart
-- suites stay green across this migration. Loosening them without a capture
-- side that skips the listing would widen what the database accepts while
-- nothing yet writes it -- a guard relaxed for no reader.
DO $migration$
DECLARE source_body text; successor_body text;
 listing_needle text:=$needle$ ), required AS (
  SELECT authority.*,pass_number,kind FROM authority CROSS JOIN generate_series(0,1) passes(pass_number)
   CROSS JOIN LATERAL unnest(CASE WHEN binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
 )$needle$;
 listing_replacement text:=$replacement$ ), required AS (
  SELECT authority.*,pass_number,kind FROM authority CROSS JOIN generate_series(0,1) passes(pass_number)
   CROSS JOIN LATERAL unnest(CASE WHEN binding->>'kind'='s3' THEN ARRAY['configuration','objects','versions','sessions'] ELSE ARRAY['configuration','objects','versions','retained'] END) kinds(kind)
  WHERE kinds.kind<>'versions' OR EXISTS(SELECT 1 FROM media_storage_provider_inventory_pages policy_page WHERE policy_page.inventory_id=authority.inventory_id AND policy_page.pass=passes.pass_number AND policy_page.kind='configuration' AND policy_page.configuration->>'versioning' IN ('Enabled','Suspended'))
 )$replacement$;
BEGIN
 SELECT prosrc INTO source_body FROM pg_proc WHERE oid=to_regprocedure('freeholder_media_original_applied_review(uuid)');
 IF source_body IS NULL OR encode(sha256(convert_to(source_body,'UTF8')),'hex')<>'1940df0492fdbf0a92cc48c032ae5e89efd2f3a0bc408b9a563bcb805fbe4f33' THEN
  RAISE EXCEPTION 'Unexpected original applied review predecessor' USING ERRCODE='23514';
 END IF;
 successor_body:=replace(source_body,listing_needle,listing_replacement);
 IF successor_body=source_body OR position(listing_needle in successor_body)<>0
  OR encode(sha256(convert_to(successor_body,'UTF8')),'hex')<>'64d8321d83730ee86d064b19911607019517e4a3b91158841ef6210f5229a316' THEN
  RAISE EXCEPTION 'Conditional applied review versions listing composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_media_original_applied_review(original_call uuid) RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',successor_body);
END $migration$;
