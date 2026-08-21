---
"freeholder": minor
---

The builder can write code now, and it still never runs any on your site.

Ask it for something that needs real code — a new block type, an integration —
and it proposes a plugin: a set of files, checked, and handed to you as a pull
request against your own repository, or as a patch if you have not connected
one. Your CI builds it. Your merge deploys it. Nothing is compiled or executed
on the machine serving your visitors.

Before a proposal can leave, it has to get past a set of checks, and it is told
all of them at once rather than one at a time. Everything must live inside its
own plugin folder — it cannot touch Freeholder's core, another plugin, or your
deploy setup. No credentials in files. No migrations that drop or delete data.
A licence header on every file. Small enough that a person can actually read it
before merging.

If a proposal fails a check, it is kept along with the reason, so you can see
what it tried to do.

Building code stays a separate permission from everything else. A key you give
an assistant to read your calendar cannot change your site, and no key at all
can write code — that stays with you, signed in.
