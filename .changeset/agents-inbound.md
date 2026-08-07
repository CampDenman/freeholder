---
"freeholder": minor
---

Your agents can now actually do the work. An agent you already run — your own
Claude, an assistant, a script — connects with the key you gave it, asks for
the next task, reports what it did as it goes, and says how it turned out.

You do not have to host anything new for this. The agent runs wherever it
already runs; your site is what holds the queue, decides who gets what, and
keeps the record.

Work is handed out one task at a time, highest priority first, and never to two
agents at once. A task waits for anything it depends on. Each agent takes only
as much at a time as you allow, and stops entirely once it has spent the budget
you set — an agent with no budget cannot spend anything at all, which is the
default.

If an agent disappears mid-task — its machine sleeps, its process dies — your
site notices within about ten minutes, takes the work back, and offers it to
somebody else. A task that fails three times stops being retried and moves to
"needs attention", so work never quietly stops without you finding out.

When a task involves something a customer wrote, the agent is told plainly to
treat it as material to act on rather than instructions to follow, and to
propose rather than act.

One thing worth knowing: what an agent *can* do is set by the access you gave
its key, and that is enforced on every single action. The independence level
you choose shapes how it behaves within that. So give an agent the access you
would be comfortable with it having unsupervised.
