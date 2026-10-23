---
"freeholder": patch
---
The booking page (/book, the embedded booking form and "Reschedule" from an appointment) now opens on the first day in the next 60 days that has a free time, instead of opening on a day with nothing free and saying "No times available on this date". "Today" is now today in the business's time zone, so an evening visitor in a zone behind UTC no longer lands on tomorrow, and a visitor in a zone ahead of UTC no longer lands on yesterday. A date chosen in the form or given in the address is always kept. When several people or rooms take the same service, the earliest times are now always offered first, even when one calendar has many later openings.
