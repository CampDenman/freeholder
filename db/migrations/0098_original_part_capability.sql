-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C1.12/C11.08: authority only within the current compiled durable-part issuer.
CREATE FUNCTION freeholder_media_original_part_capability_v1() RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF NOT freeholder_media_original_part_runtime_eligible() THEN RETURN 'unavailable'; END IF;
 RETURN 'verified-original-multipart-part-authority-v1';
END $$;
