<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Launch template and private preview (C3.35, C3.36)

A launch spec turns an empty Freeholder instance into a working one-offer
site. Private preview mode keeps that site visible to signed links only, so
an owner can review it before anything is published. Both are configuration:
one deploy is still one business, with its own database and secrets.

## The launch spec

A JSON file, validated by `launchSpecSchema` in `src/modules/seed/launch.ts`.
`seed/launch/example.json` is a complete example. Version 1 holds:

| Field | What it becomes |
|---|---|
| `business` | the business profile (name, tagline, schema.org type, country, currency, time zone) |
| `brand` | light-scheme `paper`, `ink` and `accent` tokens. A pairing that fails WCAG AA is refused by the design service, and the site keeps the accessible defaults (`brandApplied: false`). |
| `status` | **required.** `banner` appears in the announcement bar and footer of every page; `summary`, `ready` and `planned` make up `/status`. |
| `home` | the home page: headline, promise, problem, steps, reasons to switch |
| `offer` | the offer page at `/<slug>`: price label, who it is for, what is included, FAQ, and an `offer-request` form |
| `intro` | optional: `/intro-call` with a `call-request` form. It is a request the owner answers by email, not a calendar booking; the booking flow prices every bookable service. |
| `contact`, `about` | `/contact` with a `contact` form, and `/about` |

Every form submission goes through `forms.submit`, so the person lands on the
contact spine and the owner sees it in the admin. The platform's own
`robots.txt`, sitemap, `llms.txt`, OG images, manifest and skip link apply
unchanged.

Install it in one of two ways:

- **At boot:** set `FREEHOLDER_LAUNCH_SPEC=/absolute/path/spec.json`. It
  installs once into an empty site, like `FREEHOLDER_SEED_DEMO`, and a restart
  does nothing. Do not set it together with the demo seed.
- **As a service:** `launch.install` with the spec as input, through the
  admin API or MCP, as the owner.

The installer refuses a site that already has pages.

## Intake and delivery (C3.37)

The `offer-request` form is installed as an **intake** whenever the projects
module is installed (`launch.install` reports it in `intakeForms`). The spec
does not change, so every version 1 spec installs as before.

- **Intake.** Each accepted submission of an intake form opens a project for
  the person who sent it, in the same transaction: status `enquiry`, linked
  to the submission, its summary the answers. Suspected spam opens nothing;
  rescuing it from the spam queue opens its project once. Any form can be an
  intake: set "Open a project titled" in the form builder, or `intake:
  { projectTitle }` on `forms.create` / `forms.update`. `{name}`, any other
  field key and `{form}` are filled from the submission.
- **Working it.** On `/admin/projects/<id>`, **Start work** moves the project
  to `active`. **Deliver** takes a file from the media library (upload it in
  Media first) and/or a note. The file becomes a document for the project's
  contact with that file as its version, shared to their sign-in; the project
  completes and the customer is notified. Delivering the same file again
  changes nothing and notifies nobody twice. A project with no contact, or one
  reassigned since the page was opened, is refused.
- **The customer's view.** In My Account → Projects the customer reads New,
  In progress or Delivered (`enquiry`, `active`, `complete`; quoted, on hold
  and cancelled have their own words). The project page shows the delivery
  note and a download link for each delivered file, served by
  `/portal/files/<document>` only to that customer's session.
- **Agents.** `projects.deliver` is the same service over the API and MCP; an
  agent credential needs the `projects.deliver` (or `projects.*`) scope.

Customers reach My Account through the portal sign-in at `/portal/login`.
On a private preview, sign-in links depend on preview mail (C3.36).

## Version 2: a working preview (C3.39)

A version 2 spec has `"version": 2` and three more fields. Version 1 specs
install unchanged. `seed/launch/example-v2.json` is a complete example.

| Field | What it becomes |
|---|---|
| `accounts` | "My account" (`/portal`) in the navigation. Customers sign up and sign in with an email link through the portal's one email door. On a preview, that mail follows the preview mail rules (C3.36). |
| `intake` | `/start`, which has three steps. **1. Your account** links to sign-in. **2. Tell us what you need** is the `onboarding` form: name, email, then the spec's questions. Questions may be text, email, multiline, a choice with options, or a C3.38 file question with `accept` and `maxMb`. **3. Payment** carries the `payments.note`. The form is an intake (C3.37), so each accepted submission opens a project titled `projectTitle` that the customer follows in My Account and the owner delivers to. |
| `payments` | `mode: "test"` and the note shown only on the payment step, for example "Test payments are not connected yet." It never appears in a site-wide banner. |

`/start` and the account pages are part of the private preview, behind the
same signed link.

## Private preview mode

Set `FREEHOLDER_PREVIEW_KEY` to an independent random value of at least 32
characters. Then:

- every public path is refused with `401` unless the browser holds a current
  `fh_preview` cookie. That covers pages, media, `/og`, `llms.txt`, the
  sitemap and the anonymous API. A request with its own `Authorization`
  header is left to the API's own authentication;
- `/admin`, sign-in, `/setup` and `/api/health` stay open, so the owner can
  claim the site and the host can check health;
- every response carries `X-Robots-Tag: noindex, nofollow, noarchive`,
  `robots.txt` is `Disallow: /`, and IndexNow never pings.

Mint a link with the key in the environment. The key is never printed:

```sh
FREEHOLDER_PREVIEW_KEY=… node scripts/preview-link.mjs --url https://preview-host --days 7
```

Opening the link exchanges the token for an HttpOnly cookie and lands on the
site. A link lasts at most 30 days. Rotating the key revokes every link at
once.

## Preview mail (C3.36)

A preview has no public domain, but its customers still need sign-in links
and its owner still needs notifications. While `FREEHOLDER_PREVIEW_KEY` is
set, transactional mail follows a preview policy:

| Setting | Meaning |
|---|---|
| `FREEHOLDER_PREVIEW_MAIL_ALLOW` | Owner addresses that may receive preview mail, comma-separated. |
| `FREEHOLDER_PREVIEW_MAIL_DAILY_CAP` | Messages the preview may deliver in any rolling 24 hours. Default `100`. |

- A message is **delivered** only when its recipient is on the allow-list or
  is already a contact of this site, a delivering mail adapter is configured
  (`MAIL_ADAPTER`, or a verified default sender), and the daily cap has room.
  Paradise Modern is the intended adapter (`deploy/paradise-modern.md`). The
  site is unreachable without the signed link, so every contact on a preview
  arrived through the preview itself or was entered by the owner.
- Every other message is **held**, and so is every message while no adapter
  delivers. A held message is never sent: its delivery row says `held` with
  the reason (`recipient`, `cap` or `no_adapter`) and its body stays
  encrypted in the outbox for 30 days.
- The owner reads held mail at **Admin → Mail** (`/admin/mail`, linked from
  Settings while the site is a preview). Opening a message shows its text with
  links you can follow, so you can try a customer's sign-in yourself. Listing
  needs mail view access (`mail.listHeld`). Opening needs mail manage access
  (`mail.openHeld`), is written to the audit log, and is refused to API keys
  and MCP clients because the body can be a sign-in credential. Customers and
  the public never see a held message.
- Campaign and bulk mail are refused on a preview with a clear message.

Customer sign-in therefore works on a preview with no adapter at all. The
link is held, and the owner opens it from the outbox. To test real delivery,
configure the adapter and put your own address on the allow-list. When you
publish and unset `FREEHOLDER_PREVIEW_KEY`, mail returns to the ordinary
rules. Messages held during the preview stay listed until they expire.

## Publishing

Publishing is the owner's decision. To publish an approved preview:

1. Point the final domain at the instance.
2. Set `APP_URL` to that domain.
3. Unset `FREEHOLDER_PREVIEW_KEY` and restart.

Then run `deploy/agent-launch.md`'s acceptance on the published URL. Before
asking the owner, replace the status copy with what is now actually live.

## Several previews on one host

Run each preview as its own container from the same published image, with:

- its own database and role;
- its own `SESSION_SECRET`, `BOOTSTRAP_SECRET`, `CREDENTIAL_KEY` and
  `FREEHOLDER_PREVIEW_KEY`;
- its own `APP_URL`;
- no published database port.

Put one reverse proxy in front. These are separate single-business
deployments that share a machine, not tenants of one deployment.
