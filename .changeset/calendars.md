---
"freeholder": minor
---

Calendars exist now, at /admin/calendars — the groundwork the booking engine
sits on.

A calendar is anything whose time can be spent. The business itself has one.
Each person who works there has one. So does every room, chair, kiln, van or
piece of equipment that can only be in one place at a time. They are all the
same kind of thing, which is what will let a service say "this needs a
therapist *and* the treatment room" and have both checked at once.

If you work alone, you will have two calendars — yours and the business's — and
never think about it again. The day you hire someone or buy a second chair,
nothing has to be rebuilt.

Each calendar carries its own timezone, so a second location in another country
keeps its own hours. It also carries how far ahead people can book, how much
notice you need, and an optional cap on how many bookings a day it will take,
because being overbooked is a scheduling problem and not a personality flaw.

Calendars are archived, never deleted. An archived calendar stops taking new
work and keeps everything already on it.

Opening hours, exceptions and the availability engine itself come next.
