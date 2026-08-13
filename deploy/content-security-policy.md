# Content Security Policy

Freeholder sends a fresh nonce-based Content Security Policy on every HTML
request. The same policy is forwarded to Next for framework rendering and sent
to the browser for enforcement, so framework scripts and Freeholder's small
handwritten inline elements receive the one-request nonce.

The policy does not apply to API, media, privacy-artifact, sitemap or ordinary
file responses. Those routes set their own content type, caching and download
controls and are not executable documents.

## Enforced boundary

The document policy starts from `default-src 'self'` and denies plugins,
inline script attributes and unexpected embedding. In production it also
upgrades insecure subrequests. Its deliberate exceptions are narrow:

- `script-src` uses a nonce and `strict-dynamic`; development alone permits
  `unsafe-eval` for the Next development runtime. Inline script is never
  broadly allowed.
- `style-src` requires the nonce for style elements. `style-src-attr` permits
  inline values because React uses bounded style attributes for crop anchors
  and visual bars.
- `/preview` and its descendants permit only same-origin frame ancestors, so
  the editor can embed its canvas. Every other page denies framing.
- S3 media origins are available to images and media only when S3 is the active
  storage adapter. Direct S3 connections are available only under `/admin`,
  where multipart uploads run.
- Same-origin frames and workers remain available to the application. Objects
  are denied and forms may submit only to the instance.

## Third-party creatives

Set `CSP_THIRD_PARTY_ORIGINS` to a comma- or space-separated list of exact HTTPS
origins, for example:

```env
CSP_THIRD_PARTY_ORIGINS=https://creative.example https://player.example
```

Paths, credentials and wildcards are rejected. HTTP is accepted only for a
localhost development origin. Declaring an origin does not activate it: the
browser must separately carry `fh_tc=granted`, the explicit third-party
creative consent state. Analytics consent never grants this permission.

Future creative renderers must read `x-nonce` from the request and apply it to
every script element they create. The configured host remains in the policy as
a fallback for older CSP implementations, while `strict-dynamic` browsers
authorize the nonce rather than trusting an entire host.

## Violation reports

Browsers send legacy CSP reports and Reporting API batches to
`/api/security/csp-report`. Intake is limited to 64 KiB, 20 reports per request
and a global 5,000-request minute. It accepts reports only for the instance
origin and never derives or stores an IP address.

Raw reports do not reach the database. The collector discards user agents,
referrers, query strings, fragments, script samples, original policies and raw
payloads. Entity IDs and opaque path segments are redacted; cross-origin URLs
are reduced to origins. Equivalent normalized reports share a SHA-256
fingerprint and occurrence count. At most 10,000 unique fingerprints are kept,
their expiry slides for 30 days, and `core.pruneCspViolations` removes expired
evidence daily at 04:59.

Owners can review the last seven days under **Admin → Health → Content security
reports**. An empty card is normal. When a report appears, use its directive,
redacted document route and blocked origin to reproduce the page in a browser;
do not broaden the policy before identifying the resource. A blocked expected
creative usually means its exact origin is absent, consent was not granted, or
the renderer omitted the request nonce.

## Verification checklist

1. Open a public page, an admin page and the editor preview in a real browser;
   confirm there are no CSP errors and the preview remains interactive.
2. Upload an asset through an S3-backed instance and confirm multipart requests
   to the configured endpoint succeed only from an admin route.
3. Configure a test creative origin. Confirm it is absent without `fh_tc`, then
   grant consent and confirm a nonce-bearing creative can load.
4. Deliberately request a blocked script, then confirm a redacted, deduplicated
   entry appears on Health without its query string or browser identity.
5. Confirm an expired row is removed by the scheduled prune job and that backup
   retention does not preserve security diagnostics longer than policy allows.
