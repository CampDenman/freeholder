-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: admit only the genuine same-transaction proration credit confirmation.
DO $migration$
DECLARE
 funding text;reservation text;ready text;
 marker text:=$marker$   ELSIF physical_row.family='subscription_proration_credit_uses' THEN$marker$;
 receipt_case text:=$case$   ELSIF physical_row.family='subscription_proration_credit_confirmations' THEN
    SELECT EXISTS(SELECT 1 FROM subscription_proration_credit_confirmations actual_confirmation
     JOIN invoice_credit_applications original_application ON original_application.reservation_id=actual_confirmation.application_id
     JOIN invoice_credit_reservations original_reservation ON original_reservation.id=original_application.reservation_id
     JOIN invoice_credit_funding original_funding ON original_funding.id=original_reservation.funding_id
     WHERE actual_confirmation.application_id::text=physical_row.identity AND actual_confirmation.proration_id=owner_proration AND actual_confirmation.invoice_id=target_invoice
      AND original_application.invoice_id=target_invoice AND original_funding.proration_id=owner_proration AND original_funding.credit_note_id=accepted.credit_note_id
      AND actual_confirmation.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text
      AND actual_confirmation.original_evidence_digest=encode(sha256(convert_to(jsonb_build_object('application',to_jsonb(original_application),'reservation',to_jsonb(original_reservation))::text,'UTF8')),'hex')) INTO allowed_birth;
$case$;
BEGIN
 SELECT prosrc INTO funding FROM pg_proc WHERE oid=to_regprocedure('freeholder_credit_atomic_fee_birth_guard()');
 SELECT prosrc INTO reservation FROM pg_proc WHERE oid=to_regprocedure('freeholder_credit_atomic_reservation_birth_guard()');
 IF funding IS NULL OR encode(sha256(convert_to(funding,'UTF8')),'hex')<>'7a508b1cde77159052a617a40e51ac8bfd3af4cb5e44c600a1153b15bb16f2a0' OR cardinality(string_to_array(funding,marker))<>2 THEN
  RAISE EXCEPTION 'Unexpected atomic funding birth predecessor' USING ERRCODE='23514';
 END IF;
 IF reservation IS NULL OR encode(sha256(convert_to(reservation,'UTF8')),'hex')<>'39ffcc33555d04a651375a6c2022f99903baa40cecc1ccdb4d562f1907631aeb' OR cardinality(string_to_array(reservation,marker))<>2 THEN
  RAISE EXCEPTION 'Unexpected atomic reservation birth predecessor' USING ERRCODE='23514';
 END IF;
 funding:=replace(funding,marker,receipt_case||marker);reservation:=replace(reservation,marker,receipt_case||marker);
 IF encode(sha256(convert_to(funding,'UTF8')),'hex')<>'5a727d45ec5ab73658816423da8c3e4e34924e25f052bd2903b2d2ad8c2899ef'
  OR encode(sha256(convert_to(reservation,'UTF8')),'hex')<>'57e86220dad8671c29d4894560f603d1f4300fb77cbfa390cc6e0b65d2a34407' THEN
  RAISE EXCEPTION 'Atomic confirmation birth composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_credit_atomic_fee_birth_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $body$%s$body$',funding);
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_credit_atomic_reservation_birth_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $body$%s$body$',reservation);
 SELECT prosrc INTO ready FROM pg_proc WHERE oid=to_regprocedure('freeholder_credit_atomic_fee_ready()');
 IF ready IS NULL OR encode(sha256(convert_to(ready,'UTF8')),'hex')<>'fa5338dd568a084d60a777e53245c7c7ffd894d55c84433d239c924afe1a30a0'
  OR cardinality(string_to_array(ready,'7a508b1cde77159052a617a40e51ac8bfd3af4cb5e44c600a1153b15bb16f2a0'))<>2
  OR cardinality(string_to_array(ready,'39ffcc33555d04a651375a6c2022f99903baa40cecc1ccdb4d562f1907631aeb'))<>2 THEN
  RAISE EXCEPTION 'Unexpected atomic credit readiness predecessor' USING ERRCODE='23514';
 END IF;
 ready:=replace(ready,'7a508b1cde77159052a617a40e51ac8bfd3af4cb5e44c600a1153b15bb16f2a0','5a727d45ec5ab73658816423da8c3e4e34924e25f052bd2903b2d2ad8c2899ef');
 ready:=replace(ready,'39ffcc33555d04a651375a6c2022f99903baa40cecc1ccdb4d562f1907631aeb','57e86220dad8671c29d4894560f603d1f4300fb77cbfa390cc6e0b65d2a34407');
 IF encode(sha256(convert_to(ready,'UTF8')),'hex')<>'e34d9d62a18172c8b0a4c9565bc775906115204677ee422b258e547ed0497b12' THEN
  RAISE EXCEPTION 'Atomic credit readiness composition failed' USING ERRCODE='23514';
 END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION freeholder_credit_atomic_fee_ready() RETURNS boolean LANGUAGE sql STABLE AS $body$%s$body$',ready);
 IF NOT freeholder_credit_atomic_fee_ready() THEN RAISE EXCEPTION 'Atomic confirmation birth readiness did not install' USING ERRCODE='23514';END IF;
END $migration$;
--> statement-breakpoint
ALTER TABLE subscription_prorations DROP CONSTRAINT subscription_prorations_acceptance;
--> statement-breakpoint
ALTER TABLE subscription_prorations ADD CONSTRAINT subscription_prorations_acceptance CHECK(
 accepted_quote_digest ~ '^[a-f0-9]{64}$' AND source_revision ~ '^[a-f0-9]{64}$'
 AND accepted_by ~ '^(user:|agent:|plugin:|system$)' AND operation_revision>=0
);
