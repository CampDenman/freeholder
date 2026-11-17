-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C11.10/C1.08 SOURCE ONLY, UNAPPLIED. A NEW forward migration AFTER frozen85.
-- This guard must be FIRST in its own actual migration transaction; never
-- concatenate it after prior definitions inside the old85 transaction.
-- External closed-set OS/DB runtime stop/drain is ALSO mandatory. These checks
-- do not close the new-backend race and never claim that rejected raw was retained.
DO $$
BEGIN
 PERFORM pg_stat_clear_snapshot();
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
  AND(datname=current_database() OR datname IS NULL) AND(backend_type='client backend' OR backend_type IS NULL)) THEN
  RAISE EXCEPTION 'Stop and drain the complete original runtime and database backend set before safe-response rollout' USING ERRCODE='55006';END IF;
 PERFORM pg_stat_clear_snapshot();
 IF EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
  RAISE EXCEPTION 'Resolve the actual original prepared transactions before safe-response rollout' USING ERRCODE='55006';END IF;
 LOCK TABLE subscription_controlled_calls,subscription_controlled_charge_origins,subscription_controlled_closures,
  subscription_controlled_facts,subscription_controlled_finishes,subscription_controlled_operations,
  subscription_controlled_resources,subscription_controlled_stops,subscription_controlled_verifications IN ACCESS EXCLUSIVE MODE NOWAIT;
 PERFORM pg_stat_clear_snapshot();
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
  AND(datname=current_database() OR datname IS NULL) AND(backend_type='client backend' OR backend_type IS NULL)) THEN
  RAISE EXCEPTION 'The original closed backend inventory changed during safe-response rollout' USING ERRCODE='55006';END IF;
 PERFORM pg_stat_clear_snapshot();
 IF EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
  RAISE EXCEPTION 'An original prepared transaction remains during safe-response rollout' USING ERRCODE='55006';END IF;
END $$;
