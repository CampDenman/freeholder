---
"freeholder": patch
---
The demo site is now a working business instead of an empty shell. It ships a shop you can buy from (prints with sizes, a calendar, a gift card and a session voucher, each priced, taxed for BC and in stock), three services you can book online with real open times, and upcoming free and paid events. Product pages now show the product's picture and description. The public playground also fills in six months of sample customers, invoices, quotes, bookings, journal posts, reviews, newsletters, inbox conversations and website traffic, all fictional and dated relative to each hourly reset; set `FREEHOLDER_SEED_DEMO=busy` to get the same on your own demo.

Fixes that apply to every site: a menu kept in the header is no longer dropped when the site's Navigation section already has a link (the demo's menu showed only "Locations"); page titles that already name the business no longer repeat it ("About Aurora Coast Photography · Aurora Coast Photography"); the booking and memberships pages now have a description, a canonical address and the business name in their title; and site search now finds pages and journal posts by title and summary as well as products.
