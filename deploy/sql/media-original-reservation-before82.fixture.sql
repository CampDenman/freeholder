-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- PREPARE ONLY. Root's sole native lease, genuinely new disposable database:
-- ordinary0-81 verified first, run this before the owned82 migration, preserve
-- its actual SELECT output with all0-81 journal/source hashes and drain.
-- This is a fictional logical reservation, not fabricated physical/provider
-- history. No writer birth, provider result, finish or stop is invented.
BEGIN;
SELECT set_config('freeholder.media_writes_v1','1',true);
INSERT INTO media_objects(key,role,state,bytes,content_type)
VALUES('upgrade/original-media-birth-before82.bin','original','pending',6,'application/octet-stream');
SELECT current_database() AS database_name,to_jsonb(original) AS original_before
FROM media_objects original WHERE original.key='upgrade/original-media-birth-before82.bin';
COMMIT;
-- Apply the final owned82 in the SAME genuinely new database, then run only
-- the named upgrade control with FREEHOLDER_TEST_MEDIA_LEGACY_BEFORE82=true.
-- Never seed this row after82, disable guards, backdate it or reuse/reset a
-- preserved failure database. Missing prerequisite is a declared native skip.
