-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C4.05 (owner decision 2026-10-22): provider choices carry neutral names.
-- Paradise Modern's hosted gateway, one optional workforce provider, was
-- stored under its old product name `pm_brain`; it is now `paradise`. The
-- adapter, its defaults and its PARADISEMODERN_API_KEY credential are
-- unchanged, and the code still reads `pm_brain` on any row this misses
-- (for example, one restored from an older export).
UPDATE "agent_connections" SET "adapter" = 'paradise' WHERE "adapter" = 'pm_brain';
