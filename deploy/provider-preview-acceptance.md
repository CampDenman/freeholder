<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Provider and hosted-preview acceptance

`MASTER.md` §43 owns status. The owner requested the full current specification
before stable, so none of C3.31–C3.39 is deferred. This worksheet separates
located implementation, current local qualification and the required actual
provider/hosted evidence. Local fixtures and owner-browser tests do not replace
that actual acceptance or independent security review.

| Item | Located implementation and local evidence | Required actual acceptance |
| --- | --- | --- |
| C3.31 mail carrier | `src/adapters/mail/paradise.ts`, `src/core/mail/{permission,carrier-operations,carrier-services,carrier-retention,carrier-recovery}.ts`; final composed26 native controls, all4 locale owner-browser journeys including minimized-address review, fresh/populated contiguous0–76 upgrades, own production artifact and all source gates qualified. Protected qualification remains required. | A transactional message with its reason/event and a permissioned campaign against the selected original provider account; retained consent/withdrawal proof, site unsubscribe and verified sender. With an owned test identity, prove the operator can identify the exact original provider grant after local address minimization and reconcile a later consent outcome using final withdrawal/stopped-caller evidence. Local fixture prose does not prove that provider lookup. |
| C3.32 measurement | `src/adapters/measurement/`, `src/modules/analytics/measurement.ts`, `src/modules/forms/conversion.ts`; existing consent/CSP/conversion controls are listed in MASTER and were not requalified by the mail increment. | A real browser and live edge host: only explicit allow under a collecting policy loads scripts/opens CSP; sensitive paths remain excluded; one accepted-submission conversion is deduplicated by submission ID. |
| C3.33 screening | `src/adapters/form-screening/`, `src/modules/forms/screening.ts`; existing sealed-verdict/trap controls are listed in MASTER and were not requalified by the mail increment. | Live assessment with the four-second bound and required minimal payload; sealed verdict cannot remove local quarantine reasons; provider failure falls back to local traps. |
| C3.34 lead sink | `src/adapters/lead-sink/`, `src/modules/forms/lead-sink.ts`. A genuine local before control copied a screening-only submission into a subsequently enabled replacement lead account: specific notice/original-destination binding still needs repair. | After source repair, copy an accepted submission after commit into its evidenced original destination, preserve it locally, and prove quarantine/refusal handling and the enabled notice in every locale. |
| C3.35 hosted preview | `src/modules/seed/launch.ts`, `src/core/preview/`; launch/private-preview fixture controls are listed in MASTER. | Host a real-plan preview, follow its signed expiring access link, and prove an unauthenticated request is refused across the required surfaces. Owner claim steps remain the owner's. |
| C3.36 preview mail | `src/core/mail/preview.ts`; the mail increment reproduced/fixed unknown-send quota bypass and retained the existing preview controls. | Deliver a real sign-in link on the hosted preview through its configured delivering adapter, respecting involved recipients and the preview-wide cap. |
| C3.37 intake/delivery | `src/modules/forms/service.ts`, `src/modules/projects/`; existing service-intake-delivery controls are listed in MASTER. | On the hosted preview, submit intake, open the customer's project, deliver a file as owner, and show its download in that customer's portal. |
| C3.38 file fields | `src/modules/forms/{FileField,fields,service}`, private media upload and submission-file routes; existing form-file and owner-project controls are listed in MASTER. Media original-resource qualification remains part of the launch boundary. | On the hosted preview, accept the permitted upload and refuse wrong type and oversize input; preserve private owner/customer attachment access. |
| C3.39 launch spec v2 | `src/modules/seed/launch.ts`, `seed/launch/example-v2.json`; existing launch-template controls are listed in MASTER. | Install the v2 hosted preview and complete sign-up, intake, owner delivery and customer download, with the required account navigation and test-payment copy. |

For each actual acceptance, retain the instance origin, exact deployment/image,
provider category and non-secret original resource identity, date and redacted
result evidence. Keep credentials, claim links, passwords and recovery codes out
of reports. Record unresolved or refused results explicitly. The current mail
increment performs no live provider acceptance, hosting, outreach or publication.
