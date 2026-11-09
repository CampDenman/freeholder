-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C10.32. Empty tables are deliberately NOT an initialized inventory.
CREATE TABLE storage_quota_state (
 namespace text PRIMARY KEY CHECK(namespace ~ '^[a-f0-9]{64}$'),
 max_bytes bigint NOT NULL CHECK(max_bytes > 0 AND max_bytes <= 9007199254740991),
 inventory_sha256 text NOT NULL CHECK(inventory_sha256 ~ '^[a-f0-9]{64}$'),
 initialized_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE storage_quota_objects (
 namespace text NOT NULL REFERENCES storage_quota_state(namespace) ON DELETE RESTRICT,
 object_key text NOT NULL CHECK(length(object_key) BETWEEN 1 AND 2048),
 bytes bigint NOT NULL CHECK(bytes >= 0 AND bytes <= 9007199254740991),
 pending_token uuid,
 PRIMARY KEY(namespace,object_key)
);
