---
"freeholder": patch
---

Keep calendar, booking, subscription, contract, analytics and briefing work in
one transaction when those services read shared business or module settings.
Add a repository gate that prevents nested services from silently opening a
second transaction in future changes. Harden social imports so provider-supplied
media URLs cannot receive account credentials, follow redirects, reach private
networks, or exhaust memory with an unbounded response.
Escape owner-authored JSON-LD, ad-provider values and translated preview copy
before placing them in script elements so content cannot break out into
executable markup. Parse custom HTML with a real HTML parser and rebuild it
from an element, attribute, and URL-scheme allowlist. Restrict owner-supplied
font stacks to declaration-safe font-family characters.
Update the cron expression engine to its current supported 5.x release so
scheduled playbooks receive the upstream iteration and occurrence fixes.
Enforce streaming request-body limits across HTTP API, MCP, analytics, chat,
consent, upload, payment and SMS callback routes instead of checking only after
an unbounded allocation. Pin and bound remote catalogue, ICS, contribution and
social-media connections, and disable provider redirects that could carry
credentials to a different endpoint.
