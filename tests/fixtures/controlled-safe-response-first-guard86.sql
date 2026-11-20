-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C11.10/C1.08 SOURCE ONLY, UNAPPLIED. A NEW forward migration AFTER frozen85.
-- This guard must be FIRST in its own actual migration transaction; never
-- concatenate it after prior definitions inside the old85 transaction.
--
-- What this guard can and cannot promise, corrected 2026-11-18.
--
-- ACCESS EXCLUSIVE conflicts with every lock mode, ACCESS SHARE included, so
-- holding it is what actually stops any other session reading or writing these
-- tables for the rest of this transaction, and NOWAIT refuses at once rather
-- than queueing an exclusive request in front of live traffic. That is the
-- whole guarantee, and PostgreSQL enforces it.
--
-- A census of pg_stat_activity stood here and vetoed that lock. It promised
-- nothing on top of it: it cannot tell a connection that will touch these
-- tables from an idle one that never will, and a backend may arrive the moment
-- after it passes -- which the previous version of this header conceded in the
-- same breath as requiring it. What it did do was make every packaged deploy
-- unbootable. Freeholder applies migrations in-process at boot
-- (src/core/migrate.ts, deploy/linux/share/systemd/freeholder.service) while
-- the web server is already answering readiness probes, so the migrating
-- instance's own pool was always "another backend", and the failure was not a
-- refused write but an instance that never became ready. A second replica is
-- still refused -- by the lock, which can see what it holds.
--
-- The prepared-transaction check stays. NOWAIT would refuse such a holder
-- anyway, but by name here rather than as an unexplained lock failure. Its
-- post-lock repetition is gone: once ACCESS EXCLUSIVE is held, no new prepared
-- transaction can reach these tables, so a second look could only refuse a
-- rollout over a prepared transaction that has nothing to do with it.
-- lock_timeout is deliberately not set: NOWAIT does not wait, so it is moot.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
  RAISE EXCEPTION 'Resolve the actual original prepared transactions before safe-response rollout' USING ERRCODE='55006';END IF;
 LOCK TABLE subscription_controlled_calls,subscription_controlled_charge_origins,subscription_controlled_closures,
  subscription_controlled_facts,subscription_controlled_finishes,subscription_controlled_operations,
  subscription_controlled_resources,subscription_controlled_stops,subscription_controlled_verifications IN ACCESS EXCLUSIVE MODE NOWAIT;
END $$;

