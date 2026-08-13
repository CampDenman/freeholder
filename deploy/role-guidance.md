# Role guidance operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder gives each signed-in person a short first-win guide derived from
their effective capabilities. The role name chooses the most useful guide;
capabilities authorize the flow and every individual task. A custom role can
therefore receive a useful subset without inheriting controls it cannot use.
Customers receive their separate portal guide and never an admin guide.

Progress is evidence-based. Opening or clicking a task does not complete it.
Freeholder reconciles each step from durable product facts recorded after the
guide started, such as publishing a page, receiving a form submission, saving
notification settings, changing a contact, or linking the customer's portal
account. A person can skip a guide for now, resume it later, or reset its
progress. A newly granted capability reactivates a completed or dismissed flow
when it makes another task available.

## What operators should expect

The admin overview shows the preferred eligible guide. **Guided help** in the
admin header relaunches the best eligible guide for the current screen, and
**Admin → Guides for your work** shows every eligible staff flow. The portal
privacy centre contains the customer guide and its contextual relaunch link.

Freeholder ships these version-1 curricula:

| Audience | First useful outcomes |
|---|---|
| Owner | Publish a page, capture an enquiry, move a customer forward |
| Administrator | Invite a collaborator, schedule attention digests |
| Editor | Publish a page, upload media, put a form into service |
| Bookkeeper | Choose alerts, schedule attention digests |
| Service provider | Add and update a customer |
| Customer | Open the linked private account, choose a contact preference |

Forbidden tasks and navigation are omitted, not disabled. If role grants
change, revisit both the overview and the contextual guide as that person; the
surface should immediately reflect the new effective capabilities.

## Migration, versioning and recovery

Migration `0040_curved_purple_man.sql` creates `guidance_flows` and
`guidance_progress` and inserts the six immutable core definitions. Run normal
database migrations before starting the new application image. Progress is
keyed by user, flow key and version, and is deleted with its user. Do not edit a
shipped version in place: add a higher version so existing progress continues
to describe the lesson the person actually saw.

The previous application image ignores these additive tables, so rollback is
an image swap. Leave both tables in place during rollback; removing them would
unnecessarily destroy resumable progress. First-owner recovery and the test
reset paths idempotently restore missing core definitions.

If one person wants a fresh run, use **Reset guide** in their own session. Do
not manually update `guidance_progress`: completion must remain attributable
to real domain or audit evidence and progress is intentionally isolated per
user.

## Post-deploy verification

1. Run migrations and `pnpm doctor`, then sign in as the owner. Confirm the
   overview renders **Your first wins** and the header renders **Guided help**.
2. Start the owner guide. Perform one named task through the product, return to
   the overview, and confirm the native progress indicator advances. Merely
   opening a task must not advance it.
3. Skip, resume and reset a guide. Refresh between each action and confirm the
   state persists.
4. Sign in as a restricted staff role. Confirm its preferred guide is useful
   and that links, cards and navigation outside its effective capabilities are
   absent.
5. Sign in through a linked customer magic link. Confirm `/admin` is denied,
   `/portal/privacy` shows only the customer guide, and saving a real contact
   preference completes its second task.
6. Run the browser acceptance specifications documented in
   `deploy/browser-journeys.md` when validating a release candidate.

