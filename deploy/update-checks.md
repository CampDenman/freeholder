# Daily update checks

This instance checks for updates once a day. The check reads public release metadata and GETs its signed
static feed. It sends no instance identifier and reports nothing upstream.

Checking is on unless `FREEHOLDER_UPDATE_CHECK=off`. Turn it off if you would
rather watch a mailing list. Filing a bug or a patch is `contribute.submit`;
that write is not this check.

The default endpoint is GitHub’s public release list:

`https://api.github.com/repos/CampDenman/freeholder/releases`

The updater selects the most recently published version carrying `releases.json`,
including a beta, then GETs that tag’s asset from the fixed upstream repository.
The feed must verify against embedded keys before channel/version selection.
A newer beta feed retains signed history; stable policy still refuses edge releases.
This works before the first stable release, when GitHub’s `/latest` is unavailable.

Override with `FREEHOLDER_UPDATE_FEED_URL` if you pin a mirror. The URL must
be a public http(s) origin and must not carry query parameters.

Jitter is a deterministic 15-minute UTC slot derived from this instance's
`APP_URL`, used only locally so a fleet does not stampede one endpoint. The
URL is not sent with the request.

This is not unattended self-update. Applying a release is C10.06.
