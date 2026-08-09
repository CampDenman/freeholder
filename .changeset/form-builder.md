---
"freeholder": minor
---

You can now build a form in the admin. Forms → New form asks for a name and a
web address, and then you add questions: the wording, what kind of answer it
takes, whether it is required, an example and a hint. Questions can be
reordered or removed, a dropdown takes its choices as a comma-separated list,
and everything is saved in one go rather than question by question. Until now
a form could only be created through the API, which meant the module was
finished and the screen for it was not.

Each question is stored under a short key, worked out from its wording — "What
is your name?" becomes `name`. You can change that key while you are writing
the question. Once somebody has answered it, you cannot: answers are stored
under the key, so renaming it would leave every past answer stranded under a
name nothing looks for any more. The field is locked at that point and says
why. The web address is fixed for the same reason, once the form exists, since
pages point at it.

Editing a form no longer fails to open. The screen was asking for a form by
its id through the lookup that takes a web address, so it returned nothing and
errored; forms now have a lookup of their own for the admin to use. Validation
problems on this screen also read as sentences now — "The field ... is a
dropdown with no options" — instead of carrying the internal name of the
service that rejected them.
