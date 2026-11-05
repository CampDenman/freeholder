---
"freeholder": patch
---
Sign-in links and a few other redirects now always send people to the site's own address. Behind a proxy or load balancer they could point at the server's internal address, so customer sign-in from an emailed link failed.
