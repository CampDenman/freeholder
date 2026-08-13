# Analytics governance

Freeholder analytics stays on the instance. It does not store IP addresses,
user-agent strings, fingerprints, full referrer URLs, advertising click IDs or
third-party identifiers, and it sends no audience data to an analytics vendor.

## Collection policy

An owner chooses the policy under **Traffic → Collection and retention**:

- **Privacy-first with opt-out** is the default. The first request may record a
  page view against a five-minute bootstrap identifier; the browser then
  promotes that identifier to first-party analytics cookies or lets the visitor
  turn collection off. No banner blocks the page.
- **Explicit opt-in** stores no page view or performance measurement until the
  visitor grants permission. The choice works through native forms when
  JavaScript is unavailable.
- **Collection disabled** refuses new analytics and clears analytics identity
  when a browser next reconciles with the site.

`fh_ac` stores the choice, `fh_v` is the random first-party visitor identifier,
`fh_s` is the sliding 30-minute visit, and `fh_ab` is the short bootstrap. They
are `SameSite=Lax`, path-scoped to `/`, and HTTP-only. The visitor cookie never
outlives the configured retention period or 180 days, whichever is shorter.

Changing policy takes effect on the server immediately. A stale browser choice
is reconciled through `/api/analytics/consent`; cross-site posts are refused.

## Retention and pruning

Person-level events and campaign projections may be retained for 30–730 days;
the default is 180. `core.pruneAnalytics` runs daily at 04:49 and deletes events
older than the current boundary plus attribution projections whose latest touch
is older than it. If only the first touch expired, the recent latest touch is
rebased as the earliest retained touch. Backups must follow the same expiry
policy; database pruning cannot remove rows from an already-created backup.

To verify after changing retention, let the scheduler run or invoke the job
through the normal job runner, then confirm that `analytics_events.at` and
`analytics_attributions.last_at` contain no rows older than the boundary.

## Traffic quality and attribution

The original human/bot/suspected classifier verdict and reasons are immutable
evidence. An analytics manager can apply an owner correction; reports use the
override, the original verdict remains visible, and **Restore automatic**
removes the override.

Campaign collection keeps normalized UTM source, medium, campaign, term and
content plus first/latest landing paths. `gclid`, `msclkid` and `fbclid` values
are discarded; they may only infer a generic paid source. First- and last-touch
reporting joins conversions through the first-party visitor identifier.

Core Web Vitals are accepted only for a visitor/session with a server-observed
page view. Metric IDs are idempotency keys, classification comes from that
trusted page view, and reporting uses the 75th percentile.

## Anonymized export

**Download anonymized export** returns aggregate JSON for the selected traffic
policy. It contains daily totals, pages, campaigns and Web Vitals, and never
contains visitor, session or contact identifiers. A group is omitted unless it
contains at least three visitors/samples. The download is private, non-cacheable
and carries a SHA-256 digest in `x-freeholder-content-sha256`.

The export is suitable for aggregate analysis, not as a data-subject export.
Use the privacy-rights workflow for a person's access, correction or erasure.

## Verification checklist

1. Select each collection policy and verify a new private browser receives the
   expected choice UI and cookies.
2. Opt out and confirm subsequent public navigation sends no analytics identity.
3. Send a known crawler request, correct it to human, confirm every report
   changes, then restore automatic classification.
4. Open the site in a real browser and confirm Core Web Vitals appear after a
   consented page view.
5. Visit with UTM parameters and confirm campaign reports retain UTM values but
   no advertising click identifier.
6. Download an export and search it for `anonId`, `sessionId`, `contactId` and a
   known visitor identifier; none should occur.
