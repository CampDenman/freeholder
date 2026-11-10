---
"freeholder": patch
---

Moved page and blog archive addresses now resolve through the application's local listener. A network-isolated deployment can return the intended single 301 without reaching its own public hostname over the internet. Redirect destinations keep the configured public address, and the internal request carries no visitor credentials.
