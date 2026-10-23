---
"freeholder": patch
---
The site builder and managed agents work again when Paradise Modern is the chosen model gateway: they now send the gateway project from the new `PARADISEMODERN_PROJECT` setting, which that gateway requires, and only to that gateway. A gateway address that already ends in `/v1` (for any gateway) no longer produces a broken `/v1/v1/…` request, and a gateway that answers with a redirect is refused instead of followed, so a key is only ever sent to the address you configured. A Paradise Modern workforce connection pointed at a different host now needs a key of its own, and `PARADISEMODERN_URL` must be an https:// address.
