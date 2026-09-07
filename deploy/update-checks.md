# Daily update checks

This instance checks for updates once a day. The check is a GET of a signed
static file. It sends no instance identifier and reports nothing upstream.

Checking is on unless `FREEHOLDER_UPDATE_CHECK=off`. Turn it off if you would
rather watch a mailing list. Filing a bug or a patch is `contribute.submit`;
that write is not this check.

The feed URL defaults to the GitHub release asset published by C10.03:

`https://github.com/CampDenman/freeholder/releases/latest/download/releases.json`

Override with `FREEHOLDER_UPDATE_FEED_URL` if you pin a mirror. The URL must
be a public http(s) origin and must not carry query parameters.

Jitter is a deterministic 15-minute UTC slot derived from this instance's
`APP_URL`, used only locally so a fleet does not stampede one endpoint. The
URL is not sent with the request.

This is not unattended self-update. Applying a release is C10.06.
