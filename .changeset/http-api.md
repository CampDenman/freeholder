---
"freeholder": minor
---

Your site now has an API, and it covers everything. Anything you can do in the
admin, a script or an AI agent can do with a key: every one of the platform's
capabilities is reachable at `/api/v1/<name>` — `contacts.create`,
`locations.list`, `cms.publishPage` — with the same permission checks, the same
validation and the same activity log as the buttons in your admin.

There is no separate list of what the API supports, which is the point. The API
is generated from the platform's own capabilities, so a feature that exists is
a feature the API has. Nothing can be built and then forgotten about here.

Your instance also publishes its own documentation at `/api/openapi.json`,
generated the same way. It describes exactly what *your* site can do — your
modules, your plugins, this version — rather than what some generic
documentation page says a Freeholder can do. Point a developer or an AI agent
at it and they get current, accurate ground truth, including which key access
each call needs.

Anything that changes data has to be sent as a POST, so nothing on your site
can be altered by a link, a page preview or an image tag.
