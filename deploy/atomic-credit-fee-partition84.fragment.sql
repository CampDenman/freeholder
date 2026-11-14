-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
-- C12.38/C9.33: PRIVATE UNFINISHED SOURCE, UNAPPLIED. Full guards/readiness
-- follow before this can be assembled; no old table column or historical row changes.
CREATE TABLE invoice_credit_funding_atomic_fee_partitions (
 funding_id uuid PRIMARY KEY,source_payment_id uuid NOT NULL,source_application_id uuid,source_invoice_id uuid NOT NULL,
 credit_note_id uuid NOT NULL,credit_note_line_id uuid NOT NULL,original_charge_receipt_id uuid NOT NULL,bank_inspection_id uuid NOT NULL,bank_observation_id uuid NOT NULL,
 protocol text NOT NULL,parent_fingerprint text NOT NULL,economics jsonb NOT NULL,before_entries jsonb NOT NULL,
 admission_transaction_id text NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT credit_atomic_fee_funding_fk FOREIGN KEY(funding_id) REFERENCES invoice_credit_funding(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_payment_fk FOREIGN KEY(source_payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_source_application_fk FOREIGN KEY(source_application_id) REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_source_invoice_fk FOREIGN KEY(source_invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_note_fk FOREIGN KEY(credit_note_id) REFERENCES credit_notes(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_line_fk FOREIGN KEY(credit_note_line_id) REFERENCES credit_note_lines(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_receipt_fk FOREIGN KEY(original_charge_receipt_id) REFERENCES subscription_provider_charge_receipts(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_inspection_fk FOREIGN KEY(bank_inspection_id) REFERENCES merchant_cash_return_inspections(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_observation_fk FOREIGN KEY(bank_observation_id) REFERENCES merchant_cash_return_observations(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_fee_protocol CHECK(protocol='freeholder.atomic-credit-fee-partition.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT credit_atomic_fee_fingerprints CHECK(parent_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT credit_atomic_fee_economics CHECK((jsonb_typeof(economics)='object' AND economics->'plan'->>'protocol'='freeholder.atomic-credit-fee-partition.v1'
  AND(economics->'plan'->>'originalPrincipalMinor')::numeric between 1 and 9007199254740991
  AND(economics->'plan'->>'originalFeeMinor')::numeric between 0 and(economics->'plan'->>'originalPrincipalMinor')::numeric
  AND(economics->'plan'->>'takeNominalFeeMinor')::numeric=(economics->'plan'->>'takeRetiredFeeMinor')::numeric+(economics->'plan'->>'takeAssignedFeeMinor')::numeric
  AND(economics->'plan'->>'takeAssignedFeeMinor')::numeric=(economics->'plan'->>'takeProvenCollectedMinor')::numeric+(economics->'plan'->>'takeOwedFeeMinor')::numeric) IS TRUE),
 CONSTRAINT credit_atomic_fee_before_entries CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries)<=5000)
);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_payment ON invoice_credit_funding_atomic_fee_partitions(source_payment_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_parent_source ON invoice_credit_funding_atomic_fee_partitions(source_payment_id,source_application_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_note ON invoice_credit_funding_atomic_fee_partitions(credit_note_id,credit_note_line_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_receipt ON invoice_credit_funding_atomic_fee_partitions(original_charge_receipt_id,funding_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_fee_inspection ON invoice_credit_funding_atomic_fee_partitions(bank_inspection_id,funding_id);
--> statement-breakpoint
CREATE TABLE invoice_credit_reservation_atomic_fee_partitions (
 reservation_id uuid PRIMARY KEY,funding_id uuid NOT NULL,root_funding_id uuid NOT NULL,source_payment_id uuid NOT NULL,source_application_id uuid,
 protocol text NOT NULL,parent_fingerprint text NOT NULL,funding_partition_fingerprint text NOT NULL,economics jsonb NOT NULL,before_entries jsonb NOT NULL,
 admission_transaction_id text NOT NULL,digest text NOT NULL,authentication text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT credit_atomic_reservation_parent_fk FOREIGN KEY(reservation_id) REFERENCES invoice_credit_reservations(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_funding_fk FOREIGN KEY(funding_id) REFERENCES invoice_credit_funding_atomic_fee_partitions(funding_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_root_fk FOREIGN KEY(root_funding_id) REFERENCES invoice_credit_funding_atomic_fee_partitions(funding_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_payment_fk FOREIGN KEY(source_payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_application_fk FOREIGN KEY(source_application_id) REFERENCES invoice_credit_applications(reservation_id) ON DELETE RESTRICT,
 CONSTRAINT credit_atomic_reservation_protocol CHECK(protocol='freeholder.atomic-credit-fee-reservation.v1' AND admission_transaction_id ~ '^[0-9]+$'),
 CONSTRAINT credit_atomic_reservation_fingerprints CHECK(parent_fingerprint ~ '^[a-f0-9]{64}$' AND funding_partition_fingerprint ~ '^[a-f0-9]{64}$' AND digest ~ '^[a-f0-9]{64}$' AND authentication ~ '^[a-f0-9]{64}$'),
 CONSTRAINT credit_atomic_reservation_economics CHECK((jsonb_typeof(economics)='object' AND economics->>'protocol'='freeholder.atomic-credit-fee-reservation.v1'
  AND jsonb_typeof(economics->'segments')='array' AND jsonb_array_length(economics->'segments') between 1 and 5000
  AND(economics->>'originalPrincipalMinor')::numeric between 1 and 9007199254740991
  AND(economics->>'originalFeeMinor')::numeric between 0 and(economics->>'originalPrincipalMinor')::numeric
  AND(economics->>'amountMinor')::numeric between 1 and(economics->>'originalPrincipalMinor')::numeric
  AND(economics->>'nominalFeeMinor')::numeric=(economics->>'retiredFeeMinor')::numeric+(economics->>'assignedFeeMinor')::numeric
  AND(economics->>'assignedFeeMinor')::numeric=(economics->>'provenCollectedMinor')::numeric+(economics->>'owedFeeMinor')::numeric) IS TRUE),
 CONSTRAINT credit_atomic_reservation_before_entries CHECK(jsonb_typeof(before_entries)='array' AND jsonb_array_length(before_entries)<=5000)
);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_funding ON invoice_credit_reservation_atomic_fee_partitions(funding_id,reservation_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_root ON invoice_credit_reservation_atomic_fee_partitions(source_payment_id,root_funding_id,reservation_id);
--> statement-breakpoint
CREATE INDEX credit_atomic_reservation_application ON invoice_credit_reservation_atomic_fee_partitions(source_application_id,reservation_id);
