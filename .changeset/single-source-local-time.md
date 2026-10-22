---
"freeholder": patch
---
Times and day boundaries now come from one source. Revenue and cohort months, the traffic chart, the anonymized analytics export and the period a scheduled accounting export covers are all worked out from the same time zone data the site uses to print times, so a payment or visit near midnight is counted on the day and in the month the page shows. Previously the database did part of that sum with its own copy of the time zone rules, which can lag behind and put things an hour — sometimes a day — out. A report asked for a time zone the site does not recognise now says so instead of failing.

Admin → Health has a new "Time zone data" check. It warns, without failing, when the database's time zone rules disagree with the site's for your business's time zone, and names both versions so you know which one to update.
