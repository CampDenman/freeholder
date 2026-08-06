---
"freeholder": minor
---

You can now give a script, an app or an AI agent its own key, instead of
sharing your password. Settings → API keys mints one, and you choose what it
can reach area by area: no access, read only, or read and change. Most keys
should be small — a reporting script needs to read your contacts and nothing
else — and the picker makes that the easy choice rather than the diligent one.

A key is shown exactly once, when you create it. Only a fingerprint of it is
kept, so nobody who gets into your database gets a working key, and nobody
including us can show it to you again. If you lose one, revoke it and make
another. Each key records when it was last used, which is the only question
that matters about an old one: is anything still using it?

Keys cannot create or revoke keys. A key that could would be a way to turn a
small key into a big one, which would make choosing its access pointless.
Issuing credentials stays something a person does while signed in.
